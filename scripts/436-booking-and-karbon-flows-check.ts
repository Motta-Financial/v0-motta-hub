/**
 * Calendly booking pipeline + Karbon post-create step — offline check.
 *
 * No network, no database, no credentials. An in-memory stand-in for the
 * Supabase client and a scripted `fetch` for Karbon let the real code
 * paths run end to end:
 *
 *   Karbon   lib/karbon/finalize-work-item.ts
 *            • which PATCHes go out after a work item is created, in what
 *              order, with what body (status by NAME, dates 12/31 → filing
 *              date), and what happens when Karbon refuses one;
 *            • which statuses a later booking may advance to "Lead |
 *              Meeting Schd", and which it must leave alone.
 *
 *   Calendly lib/calendly/booking-pipeline.ts, lib/calendly/notify.ts
 *            • the Webhooks v2 payload shape (the bug that silently
 *              dropped every delivery for months);
 *            • host attribution for calendars with no Hub connection;
 *            • intake → booking attribution;
 *            • the backstop sweep's guards (it must never email the firm
 *              about historical meetings);
 *            • the atomic claim that makes "one email per booking" true.
 *
 * Exits 1 when any check fails.
 *
 *   npx tsx scripts/436-booking-and-karbon-flows-check.ts
 *   npx tsx scripts/436-booking-and-karbon-flows-check.ts --html out.html   # also write a sample email
 */
import { writeFileSync } from "node:fs"
import {
  advanceLeadWorkItemsOnBooking,
  detectLeadMeeting,
  finalizeKarbonWorkItem,
} from "../lib/karbon/finalize-work-item"
import {
  announceUnnotifiedBookings,
  attributeBookingToIntake,
  backfillIntakeAttribution,
  intakeIdFromTracking,
  normalizeInviteeWebhookPayload,
  resolveEventHost,
  type HostDirectory,
} from "../lib/calendly/booking-pipeline"
import {
  buildMeetingBookedEmailHtml,
  buildMeetingBookedSubject,
  notifyTeamOfNewBooking,
  type MeetingBookedEmailModel,
} from "../lib/calendly/notify"
import {
  buildFallbackBrief,
  businessDomainFromEmail,
  flattenBookingAnswers,
  type BookingForResearch,
  type MeetingResearch,
} from "../lib/calendly/research"
import { hasActiveBookingSince } from "../lib/calendly/has-booking"

/* ─────────────────────────────────────────────────────────────────────────
 * Tiny assertion helpers
 * ─────────────────────────────────────────────────────────────────────── */

let failures = 0
let passes = 0
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passes += 1
  else {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}
function ok(label: string, cond: unknown) {
  check(label, !!cond, true)
}

/* ─────────────────────────────────────────────────────────────────────────
 * In-memory Supabase stand-in (just the PostgREST surface this code uses)
 * ─────────────────────────────────────────────────────────────────────── */

type Row = Record<string, any>
type Tables = Record<string, Row[]>

function readPath(row: Row, col: string): any {
  // "tracking->>salesforce_uuid" style JSON paths.
  if (col.includes("->>")) {
    const [base, key] = col.split("->>")
    return row[base]?.[key] ?? null
  }
  return row[col] ?? null
}

function likeToRegex(pattern: string): RegExp {
  let out = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "\\" && i + 1 < pattern.length) {
      out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    } else if (c === "%") out += ".*"
    else if (c === "_") out += "."
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${out}$`, "i")
}

function cmp(a: any, b: any): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  return a < b ? -1 : 1
}

type Pred = (row: Row) => boolean

function parseOr(expr: string): Pred {
  // Split on top-level commas (not the ones inside `in.(a,b)`).
  const parts: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of expr) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      parts.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur) parts.push(cur)
  const preds = parts.map((part): Pred => {
    const [col, op, ...rest] = part.split(".")
    const value = rest.join(".")
    if (op === "eq") return (r) => String(readPath(r, col)) === value
    if (op === "is" && value === "null") return (r) => readPath(r, col) === null
    if (op === "in") {
      const list = value.replace(/^\(|\)$/g, "").split(",")
      return (r) => list.includes(String(readPath(r, col)))
    }
    if (op === "like" || op === "ilike") return (r) => likeToRegex(value).test(String(readPath(r, col) ?? ""))
    throw new Error(`fake supabase: unsupported or() clause "${part}"`)
  })
  return (r) => preds.some((p) => p(r))
}

class Query implements PromiseLike<{ data: any; error: any }> {
  private preds: Pred[] = []
  private orders: Array<{ col: string; asc: boolean }> = []
  private max: number | null = null
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select"
  private payload: any = null
  private conflict: string | null = null
  private returning = false
  private single: "none" | "maybe" | "one" = "none"

  constructor(
    private tables: Tables,
    private table: string,
    private log: string[],
  ) {}

  select(_cols?: string) {
    if (this.mode !== "select") this.returning = true
    return this
  }
  insert(payload: any) {
    this.mode = "insert"
    this.payload = payload
    return this
  }
  update(payload: any) {
    this.mode = "update"
    this.payload = payload
    return this
  }
  upsert(payload: any, opts?: { onConflict?: string }) {
    this.mode = "upsert"
    this.payload = payload
    this.conflict = opts?.onConflict ?? "id"
    return this
  }
  delete() {
    this.mode = "delete"
    return this
  }
  eq(col: string, v: any) {
    this.preds.push((r) => readPath(r, col) === v)
    return this
  }
  neq(col: string, v: any) {
    this.preds.push((r) => readPath(r, col) !== v)
    return this
  }
  is(col: string, v: any) {
    this.preds.push((r) => (v === null ? readPath(r, col) === null : readPath(r, col) === v))
    return this
  }
  not(col: string, op: string, v: any) {
    if (op === "is" && v === null) this.preds.push((r) => readPath(r, col) !== null)
    else if (op === "eq") this.preds.push((r) => readPath(r, col) !== v)
    else throw new Error(`fake supabase: unsupported not(${op})`)
    return this
  }
  in(col: string, list: any[]) {
    this.preds.push((r) => list.includes(readPath(r, col)))
    return this
  }
  gt(col: string, v: any) {
    this.preds.push((r) => readPath(r, col) !== null && cmp(readPath(r, col), v) > 0)
    return this
  }
  gte(col: string, v: any) {
    this.preds.push((r) => readPath(r, col) !== null && cmp(readPath(r, col), v) >= 0)
    return this
  }
  lt(col: string, v: any) {
    this.preds.push((r) => readPath(r, col) !== null && cmp(readPath(r, col), v) < 0)
    return this
  }
  lte(col: string, v: any) {
    this.preds.push((r) => readPath(r, col) !== null && cmp(readPath(r, col), v) <= 0)
    return this
  }
  ilike(col: string, pattern: string) {
    const re = likeToRegex(pattern)
    this.preds.push((r) => re.test(String(readPath(r, col) ?? "")))
    return this
  }
  or(expr: string) {
    this.preds.push(parseOr(expr))
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false })
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }
  maybeSingle() {
    this.single = "maybe"
    return this
  }

  private run(): { data: any; error: any } {
    const rows = (this.tables[this.table] ??= [])
    const match = (r: Row) => this.preds.every((p) => p(r))

    if (this.mode === "insert") {
      const list: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload]
      for (const r of list) rows.push({ id: r.id ?? `gen-${rows.length + 1}`, ...r })
      this.log.push(`insert ${this.table} x${list.length}`)
      return { data: this.returning ? list : null, error: null }
    }
    if (this.mode === "upsert") {
      const key = this.conflict as string
      const existing = rows.find((r) => r[key] === this.payload[key])
      if (existing) Object.assign(existing, this.payload)
      else rows.push({ id: this.payload.id ?? `gen-${rows.length + 1}`, ...this.payload })
      this.log.push(`upsert ${this.table}`)
      return { data: this.returning ? [existing ?? rows[rows.length - 1]] : null, error: null }
    }
    if (this.mode === "update") {
      const hit = rows.filter(match)
      for (const r of hit) Object.assign(r, this.payload)
      this.log.push(`update ${this.table} x${hit.length} ${JSON.stringify(this.payload)}`)
      return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null }
    }
    if (this.mode === "delete") {
      const keep = rows.filter((r) => !match(r))
      this.tables[this.table] = keep
      return { data: null, error: null }
    }

    let out = rows.filter(match).map((r) => ({ ...r }))
    for (const o of [...this.orders].reverse()) {
      out.sort((a, b) => (o.asc ? 1 : -1) * cmp(readPath(a, o.col), readPath(b, o.col)))
    }
    if (this.max !== null) out = out.slice(0, this.max)
    if (this.single === "maybe") return { data: out[0] ?? null, error: null }
    return { data: out, error: null }
  }

  then<T1 = { data: any; error: any }, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    let value: { data: any; error: any }
    try {
      value = this.run()
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected)
    }
    return Promise.resolve(value).then(onfulfilled, onrejected)
  }
}

function fakeSupabase(tables: Tables) {
  const log: string[] = []
  return {
    tables,
    log,
    client: { from: (table: string) => new Query(tables, table, log) } as any,
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scripted Karbon API
 * ─────────────────────────────────────────────────────────────────────── */

interface KarbonCall {
  method: string
  path: string
  body: any
}

function fakeKarbon(script: {
  /** Per-call PATCH outcomes, consumed in order; default 204. */
  patch?: Array<{ status: number; body?: string }>
  /** Live work items by key, for GET. */
  workItems?: Record<string, Row>
}) {
  const calls: KarbonCall[] = []
  const patchQueue = [...(script.patch ?? [])]
  const original = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input)
    const method = (init?.method ?? "GET").toUpperCase()
    const path = url.replace("https://api.karbonhq.com/v3", "")
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ method, path, body })
    if (method === "PATCH") {
      const next = patchQueue.shift() ?? { status: 204 }
      const text = next.body ?? ""
      // A 204 must carry no body at all (the Response constructor enforces it).
      return new Response(next.status === 204 ? null : text, {
        status: next.status,
        statusText: next.status === 204 ? "No Content" : next.status === 409 ? "Conflict" : "Bad Request",
      })
    }
    if (method === "GET") {
      const key = decodeURIComponent(path.split("/").pop() ?? "")
      const item = script.workItems?.[key]
      if (!item) return new Response('{"error":"not found"}', { status: 404, statusText: "Not Found" })
      return new Response(JSON.stringify(item), { status: 200 })
    }
    return new Response("{}", { status: 200 })
  }) as typeof fetch
  return {
    calls,
    patches: () => calls.filter((c) => c.method === "PATCH"),
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const CREDS = { accessKey: "test", bearerToken: "test" }

/* ─────────────────────────────────────────────────────────────────────────
 * Fixtures — work type and status NAMES as the firm's Karbon tenant spells
 * them; every key, person and email address is made up
 * ─────────────────────────────────────────────────────────────────────── */

const WT_1040 = "wt-1040"
const WT_1065 = "wt-1065"
const WT_990 = "wt-990"
const WT_BOOKS = "bk-0001"

const NOW = new Date("2026-11-25T18:00:00Z")
const iso = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString()

const INTAKE_ID = "11111111-1111-4111-8111-111111111111"
const INTAKE_OTHER = "22222222-2222-4222-8222-222222222222"

function karbonTables(extra: Tables = {}): Tables {
  return {
    work_types: [
      { karbon_work_type_key: WT_1040, name: "TAX | Individual (1040)" },
      { karbon_work_type_key: WT_1065, name: "TAX | Partnership (1065)" },
      { karbon_work_type_key: WT_990, name: "TAX | Non-Profit & Exempt (990)" },
      { karbon_work_type_key: WT_BOOKS, name: "ACCT | Bookkeeping" },
    ],
    work_templates: [
      { karbon_work_template_key: "4lgMRtcGXwDl", karbon_work_type_key: WT_1040 },
      { karbon_work_template_key: "tpl-1065", karbon_work_type_key: WT_1065 },
    ],
    work_status: [
      { karbon_status_key: "s-meet", primary_status_name: "InProgress", secondary_status_name: "Lead | Meeting Schd", work_type_keys: [WT_1040, WT_1065, WT_990], is_active: true },
      { karbon_status_key: "s-await", primary_status_name: "InProgress", secondary_status_name: "Lead | Awaiting Intake", work_type_keys: [WT_1040, WT_1065], is_active: true },
      { karbon_status_key: "s-disc", primary_status_name: "InProgress", secondary_status_name: "Lead | Discovery (Sent)", work_type_keys: [WT_1040], is_active: true },
      // Exists in the tenant but is not a LEAD status — must never be picked.
      { karbon_status_key: "s-client-meet", primary_status_name: "InProgress", secondary_status_name: "Client Meeting Scheduled", work_type_keys: [WT_1040], is_active: true },
      { karbon_status_key: "s-prop", primary_status_name: "InProgress", secondary_status_name: "Proposal | Sent", work_type_keys: [WT_1040, WT_BOOKS], is_active: true },
      { karbon_status_key: "s-books", primary_status_name: "ReadyToStart", secondary_status_name: "Send Client Requests", work_type_keys: [WT_BOOKS], is_active: true },
    ],
    jotform_intake_submissions: [],
    prospect_submissions: [],
    calendly_invitees: [],
    calendly_events: [],
    ...extra,
  }
}

async function main() {
  /* ═══════════════════════════════════════════════════════════════════
   * KARBON — post-create status + dates
   * ═════════════════════════════════════════════════════════════════ */

  // 1. The headline case: prospect took the intake AND booked a meeting.
  {
    const db = fakeSupabase(
      karbonTables({
        jotform_intake_submissions: [
          { id: INTAKE_ID, calendly_event_id: "ev-1", contact_id: "c-1", submitter_email: "jane@example.com" },
        ],
        calendly_events: [{ id: "ev-1", status: "active", start_time: iso(48) }],
      }),
    )
    const karbon = fakeKarbon({})
    const r = await finalizeKarbonWorkItem(
      {
        workItemKey: "WI1",
        workTypeName: "TAX | Individual (1040)",
        title: "TAX | Individual (1040) | Doe, Jane | 2026",
        fiscalYear: "2026",
        lead: { intakeSubmissionId: INTAKE_ID },
      },
      { supabase: db.client, credentials: CREDS },
    )
    karbon.restore()
    const p = karbon.patches()
    check("1040 + meeting: two PATCHes, dates first then status", p.map((c) => Object.keys(c.body).join(",")), [
      "StartDate,DueDate,DeadlineDate",
      "PrimaryStatus,SecondaryStatus",
    ])
    check("1040 + meeting: PATCH path", p[0]?.path, "/WorkItems/WI1")
    check("1040 + meeting: dates", p[0]?.body, {
      StartDate: "2026-12-31T00:00:00Z",
      DueDate: "2027-04-15T00:00:00Z",
      DeadlineDate: "2027-04-15T00:00:00Z",
    })
    check("1040 + meeting: status by NAME", p[1]?.body, {
      PrimaryStatus: "InProgress",
      SecondaryStatus: "Lead | Meeting Schd",
    })
    check("1040 + meeting: result", [r.ok, r.attempted, r.meetingScheduled, r.taxYear, r.taxReturnKind], [true, true, true, 2026, "1040"])
    ok("1040 + meeting: never sends WorkStatusKey", !JSON.stringify(karbon.calls).includes("WorkStatusKey"))
  }

  // 2. Intake taken, no meeting yet → Lead | Awaiting Intake.
  {
    const db = fakeSupabase(
      karbonTables({
        jotform_intake_submissions: [{ id: INTAKE_ID, calendly_event_id: null, contact_id: "c-1", submitter_email: "jane@example.com" }],
      }),
    )
    const karbon = fakeKarbon({})
    const r = await finalizeKarbonWorkItem(
      { workItemKey: "WI2", workTypeName: "TAX | Individual (1040)", fiscalYear: "2026", lead: { intakeSubmissionId: INTAKE_ID } },
      { supabase: db.client, credentials: CREDS },
    )
    karbon.restore()
    check("no meeting: status", karbon.patches()[1]?.body, { PrimaryStatus: "InProgress", SecondaryStatus: "Lead | Awaiting Intake" })
    check("no meeting: meetingScheduled", r.meetingScheduled, false)
  }

  // 3. Meeting found through the contact / email rather than attribution.
  {
    const db = fakeSupabase(
      karbonTables({
        calendly_invitees: [
          { calendly_event_id: "ev-by-contact", contact_id: "c-9", email: "other@example.com", status: "active", created_at: iso(-5) },
          { calendly_event_id: "ev-by-email", contact_id: null, email: "Jane_Doe@Example.com", status: "active", created_at: iso(-4) },
          { calendly_event_id: "ev-wildcard", contact_id: null, email: "janeXdoe@example.com", status: "active", created_at: iso(-3) },
        ],
        calendly_events: [
          { id: "ev-by-contact", status: "active", start_time: iso(72) },
          { id: "ev-by-email", status: "active", start_time: iso(24) },
          { id: "ev-wildcard", status: "active", start_time: iso(1) },
        ],
      }),
    )
    check("meeting via contact", (await detectLeadMeeting(db.client, { contactId: "c-9" }, NOW)).via, "contact")
    const byEmail = await detectLeadMeeting(db.client, { email: "jane_doe@example.com" }, NOW)
    check("meeting via email (case-insensitive)", [byEmail.booked, byEmail.eventId], [true, "ev-by-email"])
    ok("email match is exact — `_` is not a wildcard", byEmail.eventId !== "ev-wildcard")
    check("nobody to look for", (await detectLeadMeeting(db.client, {}, NOW)).booked, false)
  }

  // 4. A meeting that already happened, or was cancelled, is not "scheduled".
  {
    const db = fakeSupabase(
      karbonTables({
        jotform_intake_submissions: [{ id: INTAKE_ID, calendly_event_id: "ev-past", contact_id: "c-1", submitter_email: "j@example.com" }],
        calendly_invitees: [
          { calendly_event_id: "ev-past", contact_id: "c-1", email: "j@example.com", status: "active", created_at: iso(-200) },
          { calendly_event_id: "ev-cancelled", contact_id: "c-1", email: "j@example.com", status: "canceled", created_at: iso(-10) },
          { calendly_event_id: "ev-cancelled-event", contact_id: "c-1", email: "j@example.com", status: "active", created_at: iso(-9) },
        ],
        calendly_events: [
          { id: "ev-past", status: "active", start_time: iso(-72) },
          { id: "ev-cancelled", status: "active", start_time: iso(48) },
          { id: "ev-cancelled-event", status: "canceled", start_time: iso(48) },
        ],
      }),
    )
    check("past + cancelled meetings do not count", (await detectLeadMeeting(db.client, { intakeSubmissionId: INTAKE_ID }, NOW)).booked, false)
    db.tables.calendly_invitees.push({ calendly_event_id: "ev-rebooked", contact_id: "c-1", email: "j@example.com", status: "active", created_at: iso(-1) })
    db.tables.calendly_events.push({ id: "ev-rebooked", status: "active", start_time: iso(96) })
    const rebooked = await detectLeadMeeting(db.client, { intakeSubmissionId: INTAKE_ID }, NOW)
    check("…but a rebooked upcoming meeting does", [rebooked.booked, rebooked.eventId], [true, "ev-rebooked"])
  }

  // 5. What the teammate chose always wins.
  {
    const db = fakeSupabase(karbonTables())
    const karbon = fakeKarbon({})
    await finalizeKarbonWorkItem(
      {
        workItemKey: "WI5",
        workTemplateKey: "tpl-1065",
        title: "TAX | Partnership (1065) | Acme LLC | 2025",
        explicitStartDate: "2026-01-10",
        explicitWorkStatusKey: "s-prop",
        lead: { contactId: "c-1" },
      },
      { supabase: db.client, credentials: CREDS },
    )
    karbon.restore()
    const p = karbon.patches()
    check("explicit start kept, 1065 due/deadline 3/15 of the next year", p[0]?.body, {
      StartDate: "2026-01-10T00:00:00Z",
      DueDate: "2026-03-15T00:00:00Z",
      DeadlineDate: "2026-03-15T00:00:00Z",
    })
    check("explicit status wins over the lead default", p[1]?.body, { PrimaryStatus: "InProgress", SecondaryStatus: "Proposal | Sent" })
  }

  // 6. No lead context (existing client, e.g. from a debrief): dates only.
  {
    const db = fakeSupabase(karbonTables())
    const karbon = fakeKarbon({})
    const r = await finalizeKarbonWorkItem(
      { workItemKey: "WI6", workTypeKey: WT_1040, title: "TAX | Individual (1040) | Smith, Al | 2025" },
      { supabase: db.client, credentials: CREDS },
    )
    karbon.restore()
    check("existing client: one PATCH (dates), no lead status", karbon.patches().map((c) => Object.keys(c.body).join(",")), ["StartDate,DueDate,DeadlineDate"])
    check("existing client: TY2025 dates", karbon.patches()[0]?.body.DueDate, "2026-04-15T00:00:00Z")
    check("existing client: meetingScheduled not evaluated", r.meetingScheduled, null)
  }

  // 7. Not tax preparation → nothing is touched; with an explicit status → status only.
  {
    const db = fakeSupabase(karbonTables())
    const karbon = fakeKarbon({})
    const none = await finalizeKarbonWorkItem(
      { workItemKey: "WI7", workTypeKey: WT_BOOKS, title: "ACCT | Bookkeeping | Acme | 2026", lead: { contactId: "c-1" } },
      { supabase: db.client, credentials: CREDS },
    )
    check("bookkeeping: no PATCH at all", [karbon.patches().length, none.attempted, none.ok], [0, false, true])
    await finalizeKarbonWorkItem(
      { workItemKey: "WI7b", workTypeKey: WT_BOOKS, title: "ACCT | Bookkeeping | Acme | 2026", explicitWorkStatusKey: "s-books" },
      { supabase: db.client, credentials: CREDS },
    )
    karbon.restore()
    check("bookkeeping + chosen status: status only, enum-form primary", karbon.patches().map((c) => c.body), [
      { PrimaryStatus: "ReadyToStart", SecondaryStatus: "Send Client Requests" },
    ])
  }

  // 8. Form 990: no automatic dates (fiscal-year filers); lead status only if enabled.
  {
    const db = fakeSupabase(
      karbonTables({
        calendly_invitees: [{ calendly_event_id: "ev-1", contact_id: "c-1", email: "x@example.org", status: "active", created_at: iso(-1) }],
        calendly_events: [{ id: "ev-1", status: "active", start_time: iso(48) }],
      }),
    )
    const karbon = fakeKarbon({})
    const r = await finalizeKarbonWorkItem(
      { workItemKey: "WI8", workTypeKey: WT_990, title: "TAX | Non-Profit & Exempt (990) | Org | 2026", lead: { contactId: "c-1" } },
      { supabase: db.client, credentials: CREDS },
    )
    check("990 + meeting: status only, no dates", karbon.patches().map((c) => Object.keys(c.body).join(",")), ["PrimaryStatus,SecondaryStatus"])
    ok("990: note explains why dates were left", r.notes.some((n) => /no single filing date/.test(n)))

    // "Awaiting Intake" is not enabled for 990 in the fixture → must not be sent.
    const karbon2 = fakeKarbon({})
    const db2 = fakeSupabase(karbonTables())
    const r2 = await finalizeKarbonWorkItem(
      { workItemKey: "WI8b", workTypeKey: WT_990, title: "TAX | Non-Profit & Exempt (990) | Org | 2026", lead: { contactId: "c-1" } },
      { supabase: db2.client, credentials: CREDS },
    )
    karbon2.restore()
    karbon.restore()
    check("990 without meeting: status not enabled for the work type → nothing sent", [karbon2.patches().length, r2.attempted], [0, false])
    ok("…and the note says why", r2.notes.some((n) => /not enabled for this work type/.test(n)))
  }

  // 9. Karbon refuses the status → the dates still land, and the result says so.
  {
    const db = fakeSupabase(karbonTables())
    const karbon = fakeKarbon({ patch: [{ status: 204 }, { status: 400, body: '{"error":"SecondaryStatus is not valid for this WorkType"}' }] })
    const r = await finalizeKarbonWorkItem(
      { workItemKey: "WI9", workTypeName: "TAX | Individual (1040)", fiscalYear: "2026", lead: { contactId: "c-1" } },
      { supabase: db.client, credentials: CREDS },
    )
    karbon.restore()
    check("status refused: dates applied, status not", [r.ok, !!r.applied.StartDate, r.applied.SecondaryStatus ?? null], [false, true, null])
    ok("status refused: error carries Karbon's message", /status: 400/.test(r.error ?? "") && /not valid/.test(r.error ?? ""))
  }

  // 10. 409 (Karbon still applying the template) is retried.
  {
    const db = fakeSupabase(karbonTables())
    const karbon = fakeKarbon({ patch: [{ status: 409, body: '{"error":{"code":"4020"}}' }, { status: 204 }] })
    const r = await finalizeKarbonWorkItem(
      { workItemKey: "WI10", workTypeName: "TAX | Individual (1040)", fiscalYear: "2025" },
      { supabase: db.client, credentials: CREDS },
    )
    karbon.restore()
    check("409 then 204: retried and succeeded", [karbon.patches().length, r.ok, r.applied.DueDate], [2, true, "2026-04-15T00:00:00Z"])
  }

  // 11. Fiscal year typed as "LEAD" → seasonal default tax year, never NaN dates.
  {
    const db = fakeSupabase(karbonTables())
    const karbon = fakeKarbon({})
    const r = await finalizeKarbonWorkItem(
      { workItemKey: "WI11", workTypeName: "TAX | Individual (1040)", fiscalYear: "LEAD", title: "TAX | Individual (1040) | Doe, Jane | LEAD" },
      { supabase: db.client, credentials: CREDS },
    )
    karbon.restore()
    ok("LEAD: start is 12/31 of a real year", /^20\d{2}-12-31T00:00:00Z$/.test(karbon.patches()[0]?.body.StartDate ?? ""))
    ok("LEAD: due is 4/15 of the following year", karbon.patches()[0]?.body.DueDate === `${(r.taxYear ?? 0) + 1}-04-15T00:00:00Z`)
  }

  // 12. A booking that lands AFTER the work item exists.
  {
    const liveItems: Record<string, Row> = {
      "WI-await": { WorkType: "TAX | Individual (1040)", PrimaryStatus: "InProgress", SecondaryStatus: "Lead | Awaiting Intake" },
      "WI-default": { WorkType: "TAX | Individual (1040)", PrimaryStatus: "Planned", SecondaryStatus: null },
      "WI-prospect": { WorkType: "TAX | Individual (1040)", PrimaryStatus: "In Progress", SecondaryStatus: "LEAD | Prospect" },
      "WI-discovery": { WorkType: "TAX | Individual (1040)", PrimaryStatus: "InProgress", SecondaryStatus: "Lead | Discovery (Sent)" },
      "WI-proposal": { WorkType: "TAX | Individual (1040)", PrimaryStatus: "InProgress", SecondaryStatus: "Proposal | Sent" },
      "WI-done": { WorkType: "TAX | Individual (1040)", PrimaryStatus: "Completed", SecondaryStatus: null },
      "WI-books": { WorkType: "ACCT | Bookkeeping", PrimaryStatus: "Planned", SecondaryStatus: null },
      "WI-already": { WorkType: "TAX | Individual (1040)", PrimaryStatus: "InProgress", SecondaryStatus: "Lead | Meeting Schd" },
    }
    const db = fakeSupabase(
      karbonTables({
        jotform_intake_submissions: Object.keys(liveItems)
          .slice(0, 4)
          .map((k, i) => ({ id: `in-${i}`, contact_id: "c-1", karbon_work_item_key: k })),
        prospect_submissions: Object.keys(liveItems)
          .slice(4)
          .map((k, i) => ({ id: `pr-${i}`, contact_id: "c-1", karbon_work_item_key: k })),
      }),
    )
    const karbon = fakeKarbon({ workItems: liveItems })
    const out = await advanceLeadWorkItemsOnBooking(db.client, { contactId: "c-1" }, { credentials: CREDS })
    karbon.restore()
    check("booking advances only pre-meeting leads", out.advanced.sort(), ["WI-await", "WI-default", "WI-prospect"])
    check("…and reads each item's LIVE status first", out.checked, 8)
    ok(
      "discovery / proposal / completed / non-tax / already-scheduled are left alone",
      ["WI-discovery", "WI-proposal", "WI-done", "WI-books", "WI-already"].every((k) => out.skipped.some((s) => s.workItemKey === k)),
    )
    check("advance PATCH body", karbon.patches()[0]?.body, { PrimaryStatus: "InProgress", SecondaryStatus: "Lead | Meeting Schd" })
    check("no contact and no intake → nothing happens", (await advanceLeadWorkItemsOnBooking(db.client, {}, { credentials: CREDS })).checked, 0)
  }

  /* ═══════════════════════════════════════════════════════════════════
   * CALENDLY — payload shape, hosts, attribution, sweep, one email
   * ═════════════════════════════════════════════════════════════════ */

  // 13. The Webhooks v2 payload: the invitee IS the payload, `event` is a URI string.
  const v2Payload = {
    uri: "https://api.calendly.com/scheduled_events/EV123/invitees/INV456",
    email: "jane@example.com",
    name: "Jane Doe",
    status: "active",
    event: "https://api.calendly.com/scheduled_events/EV123",
    questions_and_answers: [{ question: "What would you like to discuss?", answer: "S-corp election" }],
    tracking: { salesforce_uuid: INTAKE_ID, utm_source: "hub_intake" },
    old_invitee: null,
    rescheduled: false,
    scheduled_event: {
      uri: "https://api.calendly.com/scheduled_events/EV123",
      name: "Discovery Meeting",
      status: "active",
      start_time: iso(48),
      end_time: iso(48.5),
      created_at: iso(-0.1),
      event_memberships: [{ user: "https://api.calendly.com/users/U-AVERY", user_email: "Avery@Firm.Example", user_name: "Avery Stone" }],
      location: { type: "zoom", join_url: "https://zoom.us/j/123" },
    },
  }
  {
    const b = normalizeInviteeWebhookPayload(v2Payload)
    check("v2: scheduled event extracted", b?.scheduledEvent.uri, "https://api.calendly.com/scheduled_events/EV123")
    check("v2: invitee extracted", [b?.invitee?.uri, b?.invitee?.email], [v2Payload.uri, "jane@example.com"])
    ok("v2: invitee copy does not drag the event along", b?.invitee && !("scheduled_event" in b.invitee))
    check("v2: tracking survives", intakeIdFromTracking(b?.invitee?.tracking), INTAKE_ID)

    const legacy = normalizeInviteeWebhookPayload({ event: { uri: "u-ev", name: "x" }, invitee: { uri: "u-inv", email: "a@b.co" } })
    check("legacy nested shape still accepted", [legacy?.scheduledEvent.uri, legacy?.invitee?.uri], ["u-ev", "u-inv"])
    check("event as bare URI and nothing else → rejected", normalizeInviteeWebhookPayload({ event: "https://api.calendly.com/scheduled_events/EV123" }), null)
    check("junk → rejected", [normalizeInviteeWebhookPayload(null), normalizeInviteeWebhookPayload("x"), normalizeInviteeWebhookPayload({})], [null, null, null])
  }

  // 14. Host attribution — the host need not have a Hub connection.
  {
    const directory: HostDirectory = {
      connectionsByUri: new Map<string, any>([
        ["https://api.calendly.com/users/U-JORDAN", { id: "conn-jordan", team_member_id: "tm-jordan", calendly_user_uri: "https://api.calendly.com/users/U-JORDAN", is_active: true }],
        ["https://api.calendly.com/users/U-RILEY", { id: "conn-riley", team_member_id: "tm-riley", calendly_user_uri: "https://api.calendly.com/users/U-RILEY", is_active: false }],
      ]),
      teamMemberIdByEmail: new Map([["avery@firm.example", "tm-avery"]]),
    }
    const host = (memberships: any[]) => resolveEventHost({ event_memberships: memberships }, directory)

    const connected = host([{ user: "https://api.calendly.com/users/U-JORDAN", user_name: "Jordan Kim", user_email: "jordan@x.com" }])
    check("connected host", [connected.connection?.id, connected.teamMemberId, connected.userName], ["conn-jordan", "tm-jordan", "Jordan Kim"])

    const lapsed = host([{ user: "https://api.calendly.com/users/U-RILEY", user_name: "Riley Park", user_email: "riley@x.com" }])
    check("lapsed connection: teammate still known, no usable token", [lapsed.connection, lapsed.teamMemberId], [null, "tm-riley"])

    const neverConnected = host(v2Payload.scheduled_event.event_memberships)
    check("never connected: placed by email, case-insensitively", [neverConnected.connection, neverConnected.teamMemberId, neverConnected.userName], [null, "tm-avery", "Avery Stone"])

    const stranger = host([{ user: "https://api.calendly.com/users/U-NEW", user_name: "New Hire", user_email: "new@x.com" }])
    check("unknown host: name still reported for the email", [stranger.teamMemberId, stranger.userName, stranger.userEmail], [null, "New Hire", "new@x.com"])

    const collective = host([
      { user: "https://api.calendly.com/users/U-NEW", user_name: "New Hire", user_email: "new@x.com" },
      { user: "https://api.calendly.com/users/U-JORDAN", user_name: "Jordan Kim", user_email: "jordan@x.com" },
    ])
    check("collective event: primary host named, co-host supplies token + teammate", [collective.userName, collective.connection?.id, collective.teamMemberId], ["New Hire", "conn-jordan", "tm-jordan"])
    check("no memberships at all", [resolveEventHost({}, directory).teamMemberId, resolveEventHost(null, directory).userName], [null, null])
  }

  // 15. Intake attribution: first booking wins; junk tracking is ignored.
  {
    const db = fakeSupabase({
      jotform_intake_submissions: [
        { id: INTAKE_ID, calendly_event_id: null, first_booked_at: null },
        { id: INTAKE_OTHER, calendly_event_id: "ev-earlier", first_booked_at: iso(-100) },
      ],
    })
    check("attribute: returns the intake id", await attributeBookingToIntake(db.client, { salesforce_uuid: INTAKE_ID }, "ev-new", iso(-1)), INTAKE_ID)
    check("attribute: written", db.tables.jotform_intake_submissions[0].calendly_event_id, "ev-new")
    await attributeBookingToIntake(db.client, { salesforce_uuid: INTAKE_OTHER }, "ev-later", iso(-1))
    check("attribute: an earlier booking is never overwritten", db.tables.jotform_intake_submissions[1].calendly_event_id, "ev-earlier")
    check("tracking: not a uuid", intakeIdFromTracking({ salesforce_uuid: "abc; drop table" }), null)
    check("tracking: missing", [intakeIdFromTracking(null), intakeIdFromTracking({}), intakeIdFromTracking({ salesforce_uuid: 42 })], [null, null, null])
  }

  // 16. Backfill: repairs history, oldest booking first, skips cancelled invitees.
  {
    const db = fakeSupabase({
      jotform_intake_submissions: [
        { id: INTAKE_ID, calendly_event_id: null },
        { id: INTAKE_OTHER, calendly_event_id: "ev-existing" },
      ],
      calendly_invitees: [
        { calendly_event_id: "ev-second", tracking: { salesforce_uuid: INTAKE_ID }, status: "active", calendly_created_at: iso(-10) },
        { calendly_event_id: "ev-first", tracking: { salesforce_uuid: INTAKE_ID }, status: "active", calendly_created_at: iso(-50) },
        { calendly_event_id: "ev-cancelled", tracking: { salesforce_uuid: INTAKE_ID }, status: "canceled", calendly_created_at: iso(-90) },
        { calendly_event_id: "ev-other", tracking: { salesforce_uuid: INTAKE_OTHER }, status: "active", calendly_created_at: iso(-5) },
        { calendly_event_id: "ev-untracked", tracking: { utm_source: "x" }, status: "active", calendly_created_at: iso(-5) },
        { calendly_event_id: "ev-null", tracking: null, status: "active", calendly_created_at: iso(-5) },
      ],
    })
    check("backfill: one intake attributed", await backfillIntakeAttribution(db.client), 1)
    check("backfill: to its FIRST live booking", db.tables.jotform_intake_submissions[0].calendly_event_id, "ev-first")
    check("backfill: existing attribution untouched", db.tables.jotform_intake_submissions[1].calendly_event_id, "ev-existing")
    check("backfill: idempotent", await backfillIntakeAttribution(db.client), 0)
  }

  // 17. The nudge guard: has this prospect booked since the intake?
  {
    const db = fakeSupabase({
      calendly_invitees: [
        { calendly_event_id: "ev-old", contact_id: "c-1", email: "j@example.com", status: "active" },
        { calendly_event_id: "ev-new", contact_id: null, email: "J@Example.com", status: "active" },
        { calendly_event_id: "ev-x", contact_id: "c-2", email: "k@example.com", status: "canceled" },
      ],
      calendly_events: [
        { id: "ev-old", status: "active", start_time: iso(-2000), calendly_created_at: iso(-2100) },
        { id: "ev-new", status: "active", start_time: iso(-2), calendly_created_at: iso(-30) },
        { id: "ev-x", status: "active", start_time: iso(48), calendly_created_at: iso(-1) },
      ],
    })
    check("booked after the intake (matched by email) → no nudge", await hasActiveBookingSince(db.client, { contactId: "c-1", email: "j@example.com" }, iso(-48), NOW), true)
    check("only an ancient meeting before the intake → nudge is fine", await hasActiveBookingSince(db.client, { contactId: "c-1" }, iso(-48), NOW), false)
    check("cancelled invitee does not count", await hasActiveBookingSince(db.client, { contactId: "c-2" }, iso(-48), NOW), false)
    check("no identity → false", await hasActiveBookingSince(db.client, {}, iso(-48), NOW), false)
  }

  // 18. The backstop sweep must only pick up RECENT, LIVE, UPCOMING, un-announced bookings.
  {
    const db = fakeSupabase({
      calendly_events: [
        { id: "ev-recent", status: "active", start_time: iso(48), calendly_created_at: iso(-2), team_notified_at: null },
        { id: "ev-historical", status: "active", start_time: iso(48), calendly_created_at: iso(-24 * 30), team_notified_at: null },
        { id: "ev-just-now", status: "active", start_time: iso(48), calendly_created_at: iso(-0.02), team_notified_at: null },
        { id: "ev-cancelled", status: "canceled", start_time: iso(48), calendly_created_at: iso(-2), team_notified_at: null },
        { id: "ev-already-over", status: "active", start_time: iso(-1), calendly_created_at: iso(-3), team_notified_at: null },
        { id: "ev-announced", status: "active", start_time: iso(48), calendly_created_at: iso(-2), team_notified_at: iso(-1.9) },
        { id: "ev-no-created-at", status: "active", start_time: iso(48), calendly_created_at: null, team_notified_at: null },
      ],
      // No invitee rows → each candidate is skipped before anything is sent.
      calendly_invitees: [],
    })
    const sweep = await announceUnnotifiedBookings(db.client, NOW)
    check("sweep: exactly one candidate — the recent, live, upcoming, un-announced one", [sweep.candidates, sweep.announced, sweep.skipped], [1, 0, 1])
    ok("sweep: nothing was claimed or emailed for a booking with no invitee yet", db.tables.calendly_events.every((e) => e.id === "ev-announced" || e.team_notified_at === null))
  }

  // 19. One email per booking — the atomic claim.
  const sampleResearch = (): MeetingResearch => ({
    relationship: "prospect",
    profile: null,
    linkedBusinesses: [],
    openWorkItems: [],
    activeProposals: [],
    intake: null,
    pastMeetings: [],
    connectedTeam: [],
    bookingNote: "What would you like to discuss?: S-corp election",
    web: { status: "skipped_no_business", query: null, sources: [] },
  })
  {
    const mkDb = () =>
      fakeSupabase({
        calendly_events: [
          {
            id: "ev-1", calendly_uuid: "EV123", name: "Discovery Meeting", status: "active",
            start_time: iso(48), end_time: iso(48.5), location_type: "zoom", location: null, join_url: "https://zoom.us/j/123",
            team_member_id: "tm-avery", calendly_user_name: "Avery Stone", calendly_user_email: "avery@firm.example",
            event_memberships: v2Payload.scheduled_event.event_memberships, calendly_created_at: iso(-1), team_notified_at: null,
          },
          { id: "ev-cancelled", name: "x", status: "canceled", start_time: iso(48), team_notified_at: null },
          { id: "ev-empty", name: "x", status: "active", start_time: iso(48), team_notified_at: null },
        ],
        calendly_invitees: [
          {
            calendly_event_id: "ev-1", calendly_uri: v2Payload.uri, name: "Jane Doe", email: "jane@example.com", status: "active",
            questions_answers: v2Payload.questions_and_answers, text_reminder_number: "+1 555 0100", contact_id: "c-1",
            old_invitee_uri: null, calendly_created_at: iso(-1),
          },
          { calendly_event_id: "ev-cancelled", name: "Z", email: "z@example.com", status: "active", calendly_created_at: iso(-1) },
        ],
        team_members: [
          { id: "tm-avery", full_name: "Avery Stone", email: "avery@firm.example", is_active: true, is_service_account: false },
          { id: "tm-jordan", full_name: "Jordan Kim", email: "jordan@firm.example", is_active: true, is_service_account: false },
          { id: "tm-alfred", full_name: "ALFRED", email: "assistant@firm.example", is_active: true, is_service_account: true },
          { id: "tm-alum", full_name: "Former", email: "former@firm.example", is_active: false, is_service_account: false },
        ],
        contacts: [{ id: "c-1", created_at: iso(-500), source: "jotform_intake" }],
      })

    const sent: Array<{ subject: string; ids: string[]; html: string }> = []
    const deps = (db: ReturnType<typeof fakeSupabase>, sendCount: number | "all") => ({
      supabase: db.client,
      resolveRecipients: async (ids: string[]) => ids.map((id) => ({ team_member_id: id, email: `${id}@x.com`, full_name: id })),
      send: async (o: any) => {
        sent.push({ subject: o.subject, ids: o.teamMemberIds, html: o.html })
        const n = sendCount === "all" ? o.teamMemberIds.length : sendCount
        return { attempted: o.teamMemberIds.length, sent: n, skipped: o.teamMemberIds.length - n }
      },
      gather: async () => sampleResearch(),
      write: async (b: BookingForResearch, r: MeetingResearch) => buildFallbackBrief(b, r),
    })

    // Two triggers race for the same booking (webhook + sweep): one wins.
    {
      const db = mkDb()
      sent.length = 0
      const [a, b] = await Promise.all([
        notifyTeamOfNewBooking({ eventId: "ev-1" }, deps(db, "all")),
        notifyTeamOfNewBooking({ eventId: "ev-1" }, deps(db, "all")),
      ])
      check("race: exactly one send", [sent.length, [a.sent, b.sent].filter(Boolean).length], [1, 1])
      check("race: the loser reports already_notified", [a.reason, b.reason].filter(Boolean), ["already_notified"])
      check("recipients: active humans only (no service account, no alumni)", sent[0]?.ids.sort(), ["tm-avery", "tm-jordan"])
      check("subject", sent[0]?.subject, "New Meeting Booked: Jane Doe (Prospect) — Discovery Meeting with Avery Stone")
      ok("booking stays claimed", db.tables.calendly_events[0].team_notified_at !== null)
      check("third call later: still one email", (await notifyTeamOfNewBooking({ eventId: "ev-1" }, deps(db, "all"))).reason, "already_notified")
      check("…sent count unchanged", sent.length, 1)
    }

    // Mail provider accepts nothing → claim released so the sweep can retry.
    {
      const db = mkDb()
      sent.length = 0
      const r = await notifyTeamOfNewBooking({ eventId: "ev-1" }, deps(db, 0))
      check("provider outage: reported, claim released", [r.sent, r.reason, db.tables.calendly_events[0].team_notified_at], [false, "send_failed", null])
      const retry = await notifyTeamOfNewBooking({ eventId: "ev-1" }, deps(db, "all"))
      check("…and the retry goes through", [retry.sent, retry.recipientCount], [true, 2])
    }

    // Everyone opted out → nothing to retry; keep the claim.
    {
      const db = mkDb()
      const r = await notifyTeamOfNewBooking({ eventId: "ev-1" }, { ...deps(db, "all"), resolveRecipients: async () => [] })
      check("all opted out: no send, claim kept", [r.reason, db.tables.calendly_events[0].team_notified_at !== null], ["no_recipients", true])
    }

    // Cancelled meeting → no email, and it stays claimed.
    {
      const db = mkDb()
      sent.length = 0
      const r = await notifyTeamOfNewBooking({ eventId: "ev-cancelled" }, deps(db, "all"))
      check("cancelled: not announced", [r.reason, sent.length], ["not_active", 0])
    }

    // Event landed before its invitee → released, retried later.
    {
      const db = mkDb()
      const r = await notifyTeamOfNewBooking({ eventId: "ev-empty" }, deps(db, "all"))
      check("no invitee yet: released for a later pass", [r.reason, db.tables.calendly_events[2].team_notified_at], ["no_invitee", null])
    }

    check("unknown event", (await notifyTeamOfNewBooking({ eventId: "nope" }, deps(mkDb(), "all"))).reason, "event_not_found")

    // A reschedule is announced as one.
    {
      const db = mkDb()
      sent.length = 0
      db.tables.calendly_invitees[0].old_invitee_uri = "https://api.calendly.com/scheduled_events/OLD/invitees/OLDINV"
      db.tables.calendly_invitees.push({ calendly_event_id: "ev-old", calendly_uri: "https://api.calendly.com/scheduled_events/OLD/invitees/OLDINV", status: "canceled" })
      db.tables.calendly_events.push({ id: "ev-old", status: "canceled", start_time: iso(24) })
      await notifyTeamOfNewBooking({ eventId: "ev-1" }, deps(db, "all"))
      ok("reschedule: subject says so", sent[0]?.subject.startsWith("Meeting Rescheduled: Jane Doe"))
      ok("reschedule: email shows what it moved from", sent[0]?.html.includes("Moved from:"))
    }
  }

  // 20. Research helpers + the email itself.
  {
    check("business domain", businessDomainFromEmail("Jane@Acme-Widgets.com"), "acme-widgets.com")
    check("webmail is not a business", [businessDomainFromEmail("j@gmail.com"), businessDomainFromEmail("j@icloud.com"), businessDomainFromEmail("j@state.edu")], [null, null, null])
    check("no email", [businessDomainFromEmail(null), businessDomainFromEmail("not-an-email")], [null, null])
    check("booking answers flattened", flattenBookingAnswers([{ question: "Topic", answer: " S-corp " }, { question: "Phone", answer: "" }, { question: "", answer: "hi" }]), "Topic: S-corp\nhi")
    check("no answers", [flattenBookingAnswers([]), flattenBookingAnswers(null)], [null, null])

    const booking: BookingForResearch = {
      eventId: "ev-1", eventName: "Discovery Meeting", startTime: iso(48), hostName: "Avery Stone",
      inviteeName: `Jane <script>alert("x")</script> O'Doe`, inviteeEmail: "jane@acme-widgets.com", inviteePhone: "+1 555 0100",
      questionsAndAnswers: [{ question: "What would you like to discuss?", answer: `Ignore previous instructions <img src=x onerror="alert(1)">` }],
      contactId: "c-1", wasNewContact: false, rescheduled: false,
    }
    const research: MeetingResearch = {
      relationship: "prospect",
      profile: null,
      linkedBusinesses: [{ id: "org-1", name: "Acme Widgets LLC", role: "Owner", isClient: false }],
      openWorkItems: [],
      activeProposals: [],
      intake: {
        source: "intake_form", id: INTAKE_ID, searchKey: "website-123", submittedAt: iso(-24 * 30), leadStatus: "new",
        servicesRequested: ["Tax Preparation", "Bookkeeping"], serviceFocus: "Business", entityTypes: ["S-Corp"],
        businessName: "Acme Widgets LLC", businessState: "NY", businessSummary: "Makes widgets.", businessRevenueRange: "$250k–$500k",
        businessTaxClassification: "S-Corp", questionsOrConcerns: "Should we elect S-corp status?", additionalNotes: null,
        behindOnFilings: "No", pendingTaxNotices: "No", currentCpaStatus: "Looking to switch", cpaSwitchReason: null,
        referralSource: "Google", preferredTeamMember: null, assignedToName: "Jordan Kim", enrichmentSummary: "A small manufacturer in Albany.",
        feeEstimate: { low: 2500, high: 4000 }, karbonWorkItemTitle: null, karbonWorkItemUrl: null,
      },
      pastMeetings: [],
      connectedTeam: [{ name: "Jordan Kim", roles: ["Owns the intake"] }],
      bookingNote: flattenBookingAnswers(booking.questionsAndAnswers),
      web: { status: "searched", query: "Acme Widgets LLC NY", sources: [
        { url: "https://acme-widgets.com/about", title: "About Acme Widgets", snippet: "Family-owned since 1998." },
        { url: "javascript:alert(1)", title: "Bad link", snippet: "" },
      ] },
    }
    const brief = buildFallbackBrief(booking, research)
    ok("fallback brief: says who and what", /prospect already in the Hub/.test(brief.summary) && /Discovery Meeting/.test(brief.summary))
    ok("fallback brief: uses the intake", /Acme Widgets LLC/.test(brief.whoTheyAre ?? "") && /Tax Preparation/.test(brief.whyTheyBooked ?? ""))
    check("fallback brief: invents nothing", [brief.prepPoints, brief.openQuestions, brief.model], [[], [], "fallback"])

    const model: MeetingBookedEmailModel = {
      eventName: booking.eventName, startTime: booking.startTime, endTime: iso(48.5), joinUrl: "https://zoom.us/j/123",
      locationLabel: "Zoom", hostName: "Avery Stone", coHostNames: ["Jordan Kim"],
      inviteeName: booking.inviteeName, inviteeEmail: booking.inviteeEmail, inviteePhone: booking.inviteePhone,
      contactId: "c-1", rescheduled: false, previousStartTime: null, research,
      brief: { ...brief, prepPoints: ["Review the S-corp election deadline"], openQuestions: ["Current payroll set-up?"] },
    }
    const html = buildMeetingBookedEmailHtml(model)
    ok("email: script tag from the invitee's name is escaped", !html.includes("<script>alert") && html.includes("&lt;script&gt;"))
    ok("email: injected attribute from the booking note is escaped", !html.includes(`onerror="alert(1)"`) && html.includes("onerror=&quot;alert(1)&quot;"))
    ok("email: javascript: links are dropped", !html.includes("javascript:alert"))
    ok("email: safe web source is linked", html.includes(`href="https://acme-widgets.com/about"`))
    ok("email: names the calendar it landed on", html.includes("Avery Stone&#39;s calendar") && html.includes("Also hosting: Jordan Kim"))
    ok("email: shows the time on the firm's clock (ET), not UTC", /E[SD]T/.test(html) && !/\bUTC\b/.test(html))
    ok("email: brief sections present", ["ALFRED&#39;S BRIEF", "WHO THEY ARE", "WHY THEY BOOKED", "BEFORE THE MEETING", "WORTH ASKING"].every((t) => html.includes(t)))
    ok("email: who's connected", html.includes("Who&#39;s connected to this client") && html.includes("Owns the intake"))
    ok("email: intake on file, with a link into the Hub", html.includes("Intake form on file") && html.includes("/sales/intake?search=website-123"))
    ok("email: links to the client and the Team Calendar", html.includes("/clients/c-1") && html.includes("/meetings/calendar"))
    ok("email: join button", html.includes(`href="https://zoom.us/j/123"`))
    check("email subject", buildMeetingBookedSubject(model), `New Meeting Booked: ${booking.inviteeName} (Prospect) — Discovery Meeting with Avery Stone`)

    const htmlArg = process.argv.indexOf("--html")
    if (htmlArg !== -1 && process.argv[htmlArg + 1]) {
      // A friendlier sample for eyeballing the layout.
      const pretty: MeetingBookedEmailModel = {
        ...model,
        inviteeName: "Jane Doe",
        research: {
          ...research,
          bookingNote: "What would you like to discuss?: We just hit $400k in revenue and want to know if an S-corp election makes sense before year-end.",
        },
        brief: {
          summary: "Jane Doe, owner of Acme Widgets LLC, booked a Discovery Meeting with Avery Stone to talk through an S-corp election before year-end. She completed the intake form a month ago asking about tax preparation and bookkeeping; no engagement has started yet.",
          whoTheyAre: "Owner of Acme Widgets LLC, a family-owned widget manufacturer in Albany, NY reporting $250k–$500k in revenue and currently taxed as an S-Corp per her intake.",
          whyTheyBooked: "She wants to know whether an S-corp election makes sense now that revenue has reached about $400k, and is looking to switch from her current CPA.",
          historyWithFirm: "Intake form on file from last month, owned by Jordan Kim, with a fee estimate of $2,500–$4,000. No prior meetings, work items or proposals.",
          prepPoints: ["Review her intake answers on entity type — the form says S-Corp, the booking note asks about electing it.", "Have the S-corp election deadline and reasonable-compensation talking points ready.", "Bring the fee estimate range from the intake."],
          openQuestions: ["Is the business already taxed as an S-corp, or is that the goal?", "Who handles payroll and bookkeeping today?"],
          model: "sample",
        },
      }
      writeFileSync(process.argv[htmlArg + 1], buildMeetingBookedEmailHtml(pretty))
      console.log(`sample email written to ${process.argv[htmlArg + 1]}`)
    }
  }

  console.log(`${passes} passed, ${failures} failed`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
