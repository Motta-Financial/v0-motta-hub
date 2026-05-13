/**
 * Ignition Reporting API backfill / sync layer.
 *
 * Field-name strategy
 * -------------------
 * Empirical truth from probing the live API (see scripts/probe-ignition-reporting.mjs):
 *   - Every resource keys off a string `slug` (e.g. `cli_xxx`, `prop_xxx`,
 *     `inv_xxx`, `psd_xxx`, `pypay_xxx`, `pss_xxx`). The `id` numeric column
 *     only appears on `/reporting/contacts` and `/reporting/collections`.
 *   - Foreign keys are also slugs: `client_slug`, `stage_slug`, etc.
 *   - Money is consistently shaped as `{ amount/total, currency }` and lives
 *     in fields like `amount`, `minimum_contract_value`, `projected_value`.
 *   - `/reporting/collections` returns one row PER PAYMENT TRANSACTION
 *     (linking a payment → invoice → disbursal). It does NOT return one row
 *     per disbursal, so it maps to `ignition_payment_transactions`, not to
 *     `ignition_disbursals` (which is fed by webhooks/Zapier).
 *
 * Defensive picking
 * -----------------
 * We still go through `pick(...)` even when we know the field name, because
 * (a) it tolerates the `nested.path` syntax cleanly and (b) the Ignition
 * docs and webhook payloads sometimes use different names than the reporting
 * API. The raw row is always stashed into `raw_payload` so any mapping
 * mistake can be corrected without re-hitting the rate-limited API.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type IgnitionConnectionRow,
  ignitionPaginate,
} from "@/lib/ignition/oauth"

/* ─────────────────────────────────────────────────────────────────────────
 * Generic helpers
 * ───────────────────────────────────────────────────────────────────────── */

/** Tries each key in order on `obj` and returns the first non-null/undefined
 *  value. Supports dotted paths (`address.city`). */
function pick<T = unknown>(obj: Record<string, any> | null | undefined, ...keys: string[]): T | null {
  if (!obj) return null
  for (const key of keys) {
    const value = key.split(".").reduce<any>((acc, part) => (acc == null ? acc : acc[part]), obj)
    if (value !== null && value !== undefined) return value as T
  }
  return null
}

function pickStr(obj: Record<string, any> | null | undefined, ...keys: string[]): string | null {
  const v = pick(obj, ...keys)
  if (v == null) return null
  return String(v)
}

function pickNum(obj: Record<string, any> | null | undefined, ...keys: string[]): number | null {
  const v = pick(obj, ...keys)
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function pickBool(obj: Record<string, any> | null | undefined, ...keys: string[]): boolean | null {
  const v = pick(obj, ...keys)
  if (v == null) return null
  if (typeof v === "boolean") return v
  if (v === "true" || v === 1 || v === "1") return true
  if (v === "false" || v === 0 || v === "0") return false
  return null
}

/** Coerces to an ISO timestamp string. Accepts Date, number (epoch seconds OR
 *  milliseconds), or string. Returns null on anything unparseable. */
function pickIso(obj: Record<string, any> | null | undefined, ...keys: string[]): string | null {
  const v = pick(obj, ...keys)
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v
    const d = new Date(ms)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }
  const d = new Date(String(v))
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** Same as pickIso but truncated to a YYYY-MM-DD `date` column. */
function pickDate(obj: Record<string, any> | null | undefined, ...keys: string[]): string | null {
  const iso = pickIso(obj, ...keys)
  return iso ? iso.slice(0, 10) : null
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Loads the full set of ID values from a single text column in batches.
 *  Used to validate FK targets before we set them — we'd rather drop a
 *  reference than crash the entire resource's upsert on a single dangling
 *  pointer. Supabase paginates SELECTs at 1000 rows by default; we keep
 *  pulling until a short page comes back. */
async function loadKnownIds(
  supabase: SupabaseClient,
  table: string,
  column: string,
): Promise<Set<string>> {
  const out = new Set<string>()
  const PAGE = 1000
  let from = 0
  for (let i = 0; i < 1000; i++) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(from, from + PAGE - 1)
    if (error) {
      // A read failure shouldn't blow up the whole sync — fall through with
      // whatever we've collected so far. The mapper will treat absent IDs
      // as "unknown" and just null the FK column.
      console.warn(`[ignition/sync] loadKnownIds(${table}.${column}) failed:`, error.message)
      return out
    }
    if (!data || data.length === 0) return out
    for (const row of data) {
      const v = (row as any)[column]
      if (v != null) out.add(String(v))
    }
    if (data.length < PAGE) return out
    from += PAGE
  }
  return out
}

/** De-duplicates an array of objects by the value of `key`. Keeps the LAST
 *  occurrence so newer rows from later pages overwrite earlier ones. Used
 *  to dodge "ON CONFLICT cannot affect row a second time" when a paginated
 *  endpoint returns the same record across two pages (Ignition's payments
 *  endpoint does this when a payment is linked to multiple invoices). */
function dedupeByKey<T extends Record<string, any>>(rows: T[], key: keyof T): T[] {
  const map = new Map<unknown, T>()
  for (const row of rows) {
    const k = row[key]
    if (k == null) continue
    map.set(k, row)
  }
  return Array.from(map.values())
}

/** Normalize Ignition's free-form `cadence` strings to our internal
 *  enum. Mirrors `normalizeBillingFrequency` in lib/sales/ignition-recurring
 *  but kept local here so the sync layer has no React/Sales deps. */
function normalizeCadence(s: string | null | undefined): string | null {
  if (!s) return null
  const v = String(s).toLowerCase()
  if (/month/.test(v)) return "monthly"
  if (/quarter/.test(v)) return "quarterly"
  if (/week/.test(v)) return "weekly"
  if (/year|annual/.test(v)) return "annually"
  if (/once|onetime|one-time|one_off/.test(v)) return "one-time"
  return v
}

/**
 * Map a single Ignition payload service into an `ignition_proposal_services`
 * row. The Ignition shape lives under `proposal.services[]` and looks like:
 *
 *   {
 *     name, slug, service_slug, description, position, is_add_on,
 *     is_selected_for_acceptance, invoice_strategy,
 *     billing: {
 *       mode, summary, is_recurring,
 *       schedules: [{ cadence, recurrence, currency, invoice_strategy,
 *                     minimum_period_value: {amount, currency},
 *                     minimum_contract_value: {amount, currency} }]
 *     },
 *     pricing: { currency, quantity, minimum_period_value:{amount},
 *                minimum_contract_value:{amount} }
 *   }
 *
 * `service_slug` is the catalog id — that's the FK target on our side.
 * The per-line `slug` is unique-per-line and lives in raw_payload only.
 *
 * `knownServiceIds` lets us null `ignition_service_id` for services that
 * haven't been synced into our catalog yet, mirroring the same defensive
 * approach used for proposals.ignition_client_id elsewhere in this file.
 */
function buildProposalServiceRow(
  proposalId: string,
  raw: any,
  ordinal: number,
  knownServiceIds: Set<string>,
): Record<string, any> | null {
  if (!raw || typeof raw !== "object") return null
  const serviceSlug = pickStr(raw, "service_slug")
  const cadence = pickStr(raw, "billing.schedules.0.cadence")
  const recurrence = pickStr(raw, "billing.schedules.0.recurrence")
  const isRecurring = pickBool(raw, "billing.is_recurring") === true
  // Effective billing frequency: prefer cadence; fall back to recurrence
  // ("once_off" / "monthly" / "yearly"). When the line is flagged as
  // non-recurring we hard-code "one-time" so downstream MRR aggregations
  // don't accidentally include deposits.
  const billingFrequency = isRecurring
    ? (normalizeCadence(cadence) ?? normalizeCadence(recurrence) ?? "monthly")
    : "one-time"
  const periodValue = pickNum(raw, "pricing.minimum_period_value.amount", "billing.schedules.0.minimum_period_value.amount")
  const contractValue = pickNum(raw, "pricing.minimum_contract_value.amount", "billing.schedules.0.minimum_contract_value.amount")
  const quantity = pickNum(raw, "pricing.quantity") ?? 1
  const currency =
    pickStr(raw, "pricing.currency") ??
    pickStr(raw, "billing.schedules.0.currency") ??
    pickStr(raw, "billing.schedules.0.minimum_period_value.currency") ??
    null
  // service_name is NOT NULL on the table. A nameless line item is
  // possible in theory but never in practice — guard with a sentinel so
  // a malformed payload never poisons the whole batch.
  const serviceName = pickStr(raw, "name") ?? "(unnamed service)"
  return {
    proposal_id: proposalId,
    ignition_service_id:
      serviceSlug && knownServiceIds.has(serviceSlug) ? serviceSlug : null,
    service_name: serviceName,
    description: pickStr(raw, "description"),
    quantity,
    unit_price: periodValue,
    total_amount: contractValue,
    currency,
    billing_frequency: billingFrequency,
    billing_type: pickStr(raw, "billing.mode"),
    // Ignition can mark a line as deselected at acceptance (the client
    // removed it from the package). Surface that in `status` so the
    // sales views can filter to actually-accepted lines when needed.
    status:
      pickBool(raw, "is_selected_for_acceptance") === false
        ? "deselected"
        : "active",
    // Always use the loop index for `ordinal` rather than Ignition's
    // `position` field — some proposals have duplicate positions across
    // add-ons (e.g. two add-ons both labelled position=0) which would
    // collide on the (proposal_id, ignition_service_id, ordinal) unique
    // index. The loop index is strictly unique within a proposal.
    ordinal,
    raw_payload: raw,
  }
}

/** Splits a single Ignition `name` ("Smith, John") into first/last as best we
 *  can. Returns nulls when we genuinely can't tell. */
function splitName(name: string | null): { first: string | null; last: string | null } {
  if (!name) return { first: null, last: null }
  const trimmed = name.trim()
  if (!trimmed) return { first: null, last: null }
  // "Last, First" — the dominant convention in Motta's Ignition data.
  if (trimmed.includes(",")) {
    const [last, ...rest] = trimmed.split(",")
    return { first: rest.join(",").trim() || null, last: last.trim() || null }
  }
  // "First Last" / "First Middle Last" — fall back to space split.
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Public types
 * ───────────────────────────────────────────────────────────────────────── */

export type ResourceName =
  | "clients"
  | "contacts"
  | "deal_stages"
  | "deals"
  | "services"
  | "proposals"
  | "invoices"
  | "payments"
  | "collections"

/** Order matters: dependencies must be synced before the things that depend
 *  on them. Specifically: deal_stages before deals (FK reference), clients
 *  before everything else (most resources carry a client_slug). */
export const RESOURCE_ORDER: ResourceName[] = [
  "clients",
  "contacts",
  "deal_stages",
  "deals",
  "services",
  "proposals",
  "invoices",
  "payments",
  "collections",
]

export interface ResourceSyncResult {
  resource: ResourceName
  fetched: number
  upserted: number
  pages: number
  durationMs: number
  errors: string[]
}

export interface FullBackfillResult {
  startedAt: string
  finishedAt: string
  totalFetched: number
  totalUpserted: number
  totalErrors: number
  results: ResourceSyncResult[]
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shared run-loop
 * ───────────────────────────────────────────────────────────────────────── */

const BATCH_SIZE = 250

/**
 * Options passed to every per-resource sync function. The single
 * `updatedSince` flag turns the run from a full backfill into an
 * incremental tick — the value is forwarded as the API's `updated_from`
 * query param (see oauth.ts ignitionPaginate). When unset, every record is
 * fetched and the run behaves like the original backfill.
 */
export interface ResourceSyncOptions {
  updatedSince?: string | null
}

async function runResource<T>(
  resource: ResourceName,
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  path: string,
  upsertBatch: (rows: T[]) => Promise<{ upserted: number; error?: string }>,
  mapRow: (raw: any) => T | null,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  const start = Date.now()
  const errors: string[] = []
  let fetched = 0
  let upserted = 0
  let pages = 0
  let mappedNulls = 0

  try {
    for await (const page of ignitionPaginate<any>(connection, supabase, path, {
      query: { updated_from: options.updatedSince ?? undefined },
    })) {
      pages += 1
      const pageData = page.data ?? []
      fetched += pageData.length
      const rows: T[] = []
      for (const raw of pageData) {
        const mapped = mapRow(raw)
        if (mapped === null) mappedNulls += 1
        else rows.push(mapped)
      }

      for (const batch of chunk(rows, BATCH_SIZE)) {
        const { upserted: n, error } = await upsertBatch(batch)
        upserted += n
        if (error) errors.push(error)
      }
    }
  } catch (err: any) {
    errors.push(`fetch_failed: ${err?.message || String(err)}`)
  }

  if (mappedNulls > 0) {
    // Not a hard error, but surface it so the UI can show "X rows skipped" if
    // a future API shape change starts dropping records silently.
    errors.push(`skipped_unmappable: ${mappedNulls}`)
  }

  return {
    resource,
    fetched,
    upserted,
    pages,
    durationMs: Date.now() - start,
    errors,
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Per-resource sync functions.
 *
 * Each mapper is written against the live response shape captured by
 * scripts/probe-ignition-reporting.mjs. When in doubt, re-run that probe
 * and update the field names here — every row's full raw response is
 * stashed in `raw_payload` so historical data can be re-derived without
 * an API round-trip.
 * ───────────────────────────────────────────────────────────────────────── */

export async function syncClients(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  return runResource(
    "clients",
    connection,
    supabase,
    "/reporting/clients",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_clients")
        .upsert(rows, { onConflict: "ignition_client_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const slug = pickStr(raw, "slug")
      if (!slug) return null
      return {
        ignition_client_id: slug,
        name: pickStr(raw, "name"),
        email: pickStr(raw, "email"),
        phone: pickStr(raw, "phone"),
        // `state` is one of "lead" / "client" / "archived" / "deleted" —
        // store it in client_type which is free-text on our side.
        client_type: pickStr(raw, "state"),
        // Ignition's `business_name` doesn't exist on /reporting/clients;
        // names like "Last, First" denote individuals while plain corporate
        // names live in `name`. We leave business_name null and let the
        // matcher decide based on group_name and external_client_id.
        business_name: pickStr(raw, "group_name"),
        ignition_created_at: pickIso(raw, "created_at"),
        ignition_updated_at: pickIso(raw, "updated_at"),
        last_event_at: pickIso(raw, "updated_at", "created_at"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

export async function syncContacts(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  return runResource(
    "contacts",
    connection,
    supabase,
    "/reporting/contacts",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_contacts")
        .upsert(rows, { onConflict: "ignition_contact_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      // Contacts is the one endpoint with BOTH slug and numeric id — we use
      // slug for consistency with every other table's foreign-key style.
      const slug = pickStr(raw, "slug")
      if (!slug) return null
      const fullName = pickStr(raw, "name")
      const { first, last } = splitName(fullName)
      return {
        ignition_contact_id: slug,
        ignition_client_id: pickStr(raw, "client.slug"),
        first_name: first,
        last_name: last,
        full_name: fullName,
        email: pickStr(raw, "email"),
        phone: pickStr(raw, "phone", "mobile"),
        role: pickStr(raw, "position"),
        raw_payload: raw,
        ignition_created_at: pickIso(raw, "created_at"),
        ignition_updated_at: pickIso(raw, "updated_at"),
        last_event_at: pickIso(raw, "updated_at", "created_at"),
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

export async function syncDealStages(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  return runResource(
    "deal_stages",
    connection,
    supabase,
    "/reporting/deal_stages",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_deal_stages")
        .upsert(rows, { onConflict: "ignition_stage_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const slug = pickStr(raw, "slug")
      if (!slug) return null
      const winLikelihood = pickNum(raw, "win_likelihood")
      return {
        ignition_stage_id: slug,
        name: pickStr(raw, "name"),
        // Ignition doesn't expose pipeline grouping on /reporting/deal_stages,
        // so we leave this null. UI code should not depend on it for now.
        pipeline_name: null,
        // Derive is_won/is_lost from win_likelihood: 100 → won, 0 → lost,
        // anything between → in-flight. This matches Ignition's UX where
        // stages at the ends of the pipeline get those probabilities.
        is_won: winLikelihood == null ? null : winLikelihood >= 100,
        is_lost:
          winLikelihood == null
            ? null
            : winLikelihood === 0 && /lost|dead|won't proceed/i.test(pickStr(raw, "name") ?? ""),
        is_active: true,
        sort_order: pickNum(raw, "position"),
        raw_payload: raw,
        ignition_created_at: pickIso(raw, "created_at"),
        ignition_updated_at: pickIso(raw, "updated_at"),
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

export async function syncDeals(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  return runResource(
    "deals",
    connection,
    supabase,
    "/reporting/deals",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_deals")
        .upsert(rows, { onConflict: "ignition_deal_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const slug = pickStr(raw, "slug")
      if (!slug) return null
      return {
        ignition_deal_id: slug,
        ignition_client_id: pickStr(raw, "client_slug"),
        ignition_stage_id: pickStr(raw, "stage_slug"),
        // Pipeline grouping isn't exposed here, but stage_name is useful for
        // quick rendering without a join to ignition_deal_stages.
        pipeline_name: null,
        stage_name: pickStr(raw, "stage_name"),
        title: pickStr(raw, "name"),
        status: pickStr(raw, "state"),
        owner_name: pickStr(raw, "owner.name"),
        owner_email: pickStr(raw, "owner.email"),
        // Ignition returns `value` and a separate `projected_value` object.
        // Prefer the realised value, fall back to the projection.
        value:
          pickNum(raw, "value") ??
          pickNum(raw, "projected_value.amount") ??
          null,
        currency:
          pickStr(raw, "currency") ??
          pickStr(raw, "projected_value.currency") ??
          null,
        // `expected_close_date` isn't on this endpoint; closed_at is when it
        // was actually closed. We still try the canonical name in case the
        // field shape changes.
        expected_close_date: pickDate(raw, "expected_close_date"),
        closed_at: pickIso(raw, "closed_at"),
        raw_payload: raw,
        ignition_created_at: pickIso(raw, "created_at"),
        ignition_updated_at: pickIso(raw, "updated_at"),
        last_event_at: pickIso(raw, "updated_at", "created_at"),
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

export async function syncServices(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  return runResource(
    "services",
    connection,
    supabase,
    "/reporting/services",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_services")
        .upsert(rows, { onConflict: "ignition_service_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const slug = pickStr(raw, "slug")
      if (!slug) return null
      return {
        ignition_service_id: slug,
        name: pickStr(raw, "name"),
        description: pickStr(raw, "description"),
        category: pickStr(raw, "service_group_name", "service_group"),
        // Ignition exposes `state` ("active" / "archived"). Anything other
        // than archived counts as active for our purposes.
        is_active: (pickStr(raw, "state") ?? "active").toLowerCase() === "active",
        default_price: pickNum(raw, "price"),
        currency: null,
        billing_type: pickStr(raw, "billing_mode", "price_type"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

export async function syncProposals(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  // Proposals are now sourced exclusively from the Ignition Reporting API.
  // We still UPSERT (rather than INSERT/REPLACE) so any legacy Zapier-era
  // columns we don't touch (e.g. the historical `payload` blob) survive the
  // merge unchanged.
  //
  // ignition_proposals.ignition_client_id is a FK into ignition_clients.
  // Some proposals reference clients that don't come back from /reporting/clients
  // (archived/deleted/legacy IDs from the Zapier era). We pre-fetch the known
  // set so we can null those references rather than fail the batch.
  //
  // ignition_proposal_services.ignition_service_id is a FK into ignition_services.
  // Same story — we pre-fetch the catalog so any unknown service_slug on a
  // line item is nulled rather than failing the whole service batch.
  const [knownClientIds, knownServiceIds] = await Promise.all([
    loadKnownIds(supabase, "ignition_clients", "ignition_client_id"),
    loadKnownIds(supabase, "ignition_services", "ignition_service_id"),
  ])

  return runResource(
    "proposals",
    connection,
    supabase,
    "/reporting/proposals",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_proposals")
        .upsert(rows, { onConflict: "proposal_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }

      // ── Fan out every proposal's line items into ignition_proposal_services ──
      // The Reporting API embeds `services[]` on each proposal. Previously
      // we threw that data away — only ~22% of proposals (198/913) had any
      // rows in `ignition_proposal_services`, with 2,299 line items missing
      // firm-wide. Now we delete-and-reinsert the child rows in lockstep
      // with the parent upsert so the table is always a faithful mirror
      // of Ignition's current state for every synced proposal.
      try {
        const proposalIds = rows
          .map((r: any) => r.proposal_id)
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
        if (proposalIds.length > 0) {
          // Delete first so re-syncs don't leave stale lines behind (e.g.
          // a partner removed a service from the proposal in Ignition).
          // Chunk the IN clause to stay under PostgREST's URL length limit.
          for (const idChunk of chunk(proposalIds, 100)) {
            const { error: delErr } = await supabase
              .from("ignition_proposal_services")
              .delete()
              .in("proposal_id", idChunk)
            if (delErr) {
              console.warn(
                `[ignition/sync] proposal_services delete failed: ${delErr.message}`,
              )
            }
          }

          const serviceRows: any[] = []
          for (const row of rows as any[]) {
            const raw = row?.raw_payload
            const list = Array.isArray(raw?.services) ? raw.services : []
            list.forEach((svc: any, idx: number) => {
              const built = buildProposalServiceRow(
                row.proposal_id,
                svc,
                idx,
                knownServiceIds,
              )
              if (built) serviceRows.push(built)
            })
          }
          if (serviceRows.length > 0) {
            for (const svcBatch of chunk(serviceRows, BATCH_SIZE)) {
              const { error: insErr } = await supabase
                .from("ignition_proposal_services")
                .insert(svcBatch)
              if (insErr) {
                console.warn(
                  `[ignition/sync] proposal_services insert failed: ${insErr.message}`,
                )
              }
            }
          }
        }
      } catch (svcErr: any) {
        console.warn(
          `[ignition/sync] proposal_services fanout exception: ${svcErr?.message || svcErr}`,
        )
      }

      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const slug = pickStr(raw, "slug")
      if (!slug) return null
      // Money lives in `minimum_contract_value: { amount, currency }`.
      const amount = pickNum(raw, "minimum_contract_value.amount")
      const currency = pickStr(raw, "minimum_contract_value.currency")
      const clientCandidate = pickStr(raw, "client_slug")
      return {
        proposal_id: slug,
        ignition_client_id:
          clientCandidate && knownClientIds.has(clientCandidate) ? clientCandidate : null,
        title: pickStr(raw, "name"),
        proposal_number: pickStr(raw, "reference_number"),
        status: pickStr(raw, "state"),
        client_name: pickStr(raw, "client_name"),
        // Reporting API doesn't expose client_email / manager / partner.
        // Those stay null here and pick up their Zapier-fed values via the
        // partial-merge upsert. We intentionally do NOT write them as null.
        proposal_sent_by: pickStr(raw, "sender.name", "creator.name"),
        recurring_frequency: pickStr(raw, "contract_term"),
        currency,
        signed_url: pickStr(raw, "pdf_url"),
        amount,
        total_value: amount,
        sent_at: pickIso(raw, "sent_at"),
        accepted_at: pickIso(raw, "accepted_at"),
        lost_at: pickIso(raw, "lost_at"),
        inserted_at: pickIso(raw, "created_at"),
        modified_at: pickIso(raw, "updated_at", "created_at"),
        last_event_at: pickIso(raw, "updated_at", "created_at"),
        // The legacy `payload` column predates `raw_payload` and is still
        // declared NOT NULL because the Zapier feed depends on it. Mirror
        // raw into both so the schema constraint is satisfied without
        // requiring a destructive migration.
        payload: raw,
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

export async function syncInvoices(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  // Pre-fetch the set of proposal AND client slugs we actually have on disk.
  // Both columns are FKs and will reject references to rows we never received
  // (archived/deleted/legacy IDs). We null any unknown FK rather than crash
  // the whole batch.
  const [knownProposalIds, knownClientIds] = await Promise.all([
    loadKnownIds(supabase, "ignition_proposals", "proposal_id"),
    loadKnownIds(supabase, "ignition_clients", "ignition_client_id"),
  ])

  return runResource(
    "invoices",
    connection,
    supabase,
    "/reporting/invoices",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_invoices")
        .upsert(rows, { onConflict: "ignition_invoice_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const slug = pickStr(raw, "slug")
      if (!slug) return null
      // Each invoice items[].origin_identifier links back to a proposal slug.
      // We only set proposal_id when we already have that proposal in our DB.
      const firstItem: any = Array.isArray(raw?.items) && raw.items.length > 0 ? raw.items[0] : null
      const proposalCandidate =
        firstItem?.origin_type === "proposal" ? pickStr(firstItem, "origin_identifier") : null
      const proposalId =
        proposalCandidate && knownProposalIds.has(proposalCandidate) ? proposalCandidate : null
      const clientCandidate = pickStr(raw, "client.slug")
      return {
        ignition_invoice_id: slug,
        ignition_client_id:
          clientCandidate && knownClientIds.has(clientCandidate) ? clientCandidate : null,
        proposal_id: proposalId,
        invoice_number: pickStr(raw, "reference_number"),
        status: pickStr(raw, "state"),
        currency: pickStr(raw, "amount.currency"),
        amount: pickNum(raw, "amount.total"),
        invoice_date: pickDate(raw, "date"),
        due_date: pickDate(raw, "due_date"),
        paid_at: pickIso(raw, "payment.collection_date", "payment_date"),
        last_event_at: pickIso(raw, "updated_at", "date"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

export async function syncPayments(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  // Same FK story as invoices — ignition_payments has FKs into BOTH
  // ignition_invoices AND ignition_clients. We pre-fetch both sets so the
  // mapper can null any dangling reference rather than fail the batch.
  const [knownInvoiceIds, knownClientIds] = await Promise.all([
    loadKnownIds(supabase, "ignition_invoices", "ignition_invoice_id"),
    loadKnownIds(supabase, "ignition_clients", "ignition_client_id"),
  ])

  return runResource(
    "payments",
    connection,
    supabase,
    "/reporting/payments",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      // Ignition's payments endpoint can return the same payment twice when
      // it's linked to multiple invoices on different pages. ON CONFLICT
      // DO UPDATE rejects a batch that contains two rows with the same
      // conflict key, so we de-dupe here to keep the last (most-recent)
      // version of each payment slug.
      const deduped = dedupeByKey(rows as any[], "ignition_payment_id")
      const { error, count } = await supabase
        .from("ignition_payments")
        .upsert(deduped, { onConflict: "ignition_payment_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? deduped.length }
    },
    (raw) => {
      const slug = pickStr(raw, "slug")
      if (!slug) return null
      const firstInvoice: any =
        Array.isArray(raw?.invoices) && raw.invoices.length > 0 ? raw.invoices[0] : null
      const invoiceSlug = firstInvoice ? pickStr(firstInvoice, "slug") : null
      const clientCandidate = pickStr(raw, "client.slug")
      const amount = pickNum(raw, "amount.amount", "amount.total")
      const fee = pickNum(raw, "collection.fee_amount.amount", "collection.fee.amount")
      return {
        ignition_payment_id: slug,
        ignition_client_id:
          clientCandidate && knownClientIds.has(clientCandidate) ? clientCandidate : null,
        ignition_invoice_id:
          invoiceSlug && knownInvoiceIds.has(invoiceSlug) ? invoiceSlug : null,
        payment_status: pickStr(raw, "state", "collection.state"),
        payment_method: null, // Ignition doesn't expose this on /reporting/payments.
        amount,
        // Stripe-style net = gross - fees. Only compute when we have both;
        // otherwise leave null and let the UI handle it.
        net_amount: amount != null && fee != null ? amount - fee : null,
        fees: fee,
        currency: pickStr(raw, "amount.currency"),
        paid_at: pickIso(raw, "collection.completed_at", "created_at"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

export async function syncCollections(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: ResourceSyncOptions = {},
): Promise<ResourceSyncResult> {
  // /reporting/collections returns one row PER PAYMENT TRANSACTION. It's not
  // the same shape as ignition_disbursals (which represents a payout batch),
  // so this feeds the per-transaction table instead. The `ignition_disbursals`
  // table is now a frozen historical archive — it was previously fed by the
  // retired Zapier webhook flow and the Reporting API has no equivalent
  // endpoint. Payout-batch data should be derived from collections rows
  // grouped by disbursal date going forward.
  //
  // ignition_payment_transactions.disbursal_id is a FK into ignition_disbursals,
  // so we only set it when we already have that disbursal on disk — otherwise
  // the upsert would fail the entire batch.
  const knownDisbursalIds = await loadKnownIds(supabase, "ignition_disbursals", "disbursal_id")

  return runResource(
    "collections",
    connection,
    supabase,
    "/reporting/collections",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const deduped = dedupeByKey(rows as any[], "transaction_id")
      const { error, count } = await supabase
        .from("ignition_payment_transactions")
        .upsert(deduped, { onConflict: "transaction_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? deduped.length }
    },
    (raw) => {
      // Collections rows use a numeric `id`, the only resource that doesn't
      // use slug as the natural key. Stringify it for our text column.
      const id = pick(raw, "id")
      if (id == null) return null
      const gross = pickNum(raw, "amount.total")
      const fee = pickNum(raw, "payment.fee")
      const disbursalCandidate = pickStr(raw, "disbursal.id")
      return {
        transaction_id: String(id),
        transaction_type: pickStr(raw, "type"),
        payment_method: pickStr(raw, "type"),
        gross_amount: gross,
        fees: fee,
        net_amount: gross != null && fee != null ? gross - fee : null,
        currency: pickStr(raw, "amount.currency"),
        payment_date: pickDate(raw, "payment.started_at"),
        disbursal_id:
          disbursalCandidate && knownDisbursalIds.has(disbursalCandidate)
            ? disbursalCandidate
            : null,
        client_name: pickStr(raw, "client.name"),
        client_email: null, // not provided on this endpoint
        invoice_number: pickStr(raw, "invoice.number"),
        proposal_name: null, // not provided directly; would require join
        service_name: null,
        updated_at: new Date().toISOString(),
      }
    },
    options,
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * Orchestrator
 * ───────────────────────────────────────────────────────────────────────── */

const RESOURCE_FUNCTIONS: Record<
  ResourceName,
  (
    conn: IgnitionConnectionRow,
    sb: SupabaseClient,
    opts?: ResourceSyncOptions,
  ) => Promise<ResourceSyncResult>
> = {
  clients: syncClients,
  contacts: syncContacts,
  deal_stages: syncDealStages,
  deals: syncDeals,
  services: syncServices,
  proposals: syncProposals,
  invoices: syncInvoices,
  payments: syncPayments,
  collections: syncCollections,
}

/**
 * Run a backfill across one or more resources. Updates the connection row's
 * sync timestamps and writes a `sync_log` entry summarizing the run.
 *
 * When `updatedSince` is supplied the run becomes an INCREMENTAL TICK: each
 * resource is queried with `?updated_from=<ISO>` so only records modified
 * after that cutoff are fetched. The cron path passes
 * `connection.last_synced_at - 5 minutes` to maintain freshness without
 * paying for a full backfill every 15 minutes. When omitted, the run is a
 * full backfill (every record on every page).
 *
 * If any single resource fails, we keep going and aggregate errors at the
 * end. A partial success leaves `last_synced_at` updated but also writes
 * `last_sync_error` so the UI can warn the user.
 *
 * The per-resource breakdown is ALWAYS persisted to `sync_log.error_details`
 * (even on full success) so the admin UI can render the table of "fetched /
 * upserted / pages / duration" for the last run. The `sync_type` differs
 * between `ignition_backfill` and `ignition_incremental` so the UI can
 * pivot on it when displaying recent runs.
 */
export async function runFullBackfill(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: {
    resources?: ResourceName[]
    triggeredByTeamMemberId?: string | null
    isManual?: boolean
    /** ISO timestamp; when set, runs an incremental sync via `updated_from`. */
    updatedSince?: string | null
  } = {},
): Promise<FullBackfillResult> {
  const startedAt = new Date().toISOString()
  const resources = options.resources?.length
    ? options.resources.filter((r): r is ResourceName => r in RESOURCE_FUNCTIONS)
    : RESOURCE_ORDER

  const isIncremental = !!options.updatedSince

  await supabase
    .from("ignition_connections")
    .update({
      last_sync_started_at: startedAt,
      last_sync_error: null,
      updated_at: startedAt,
    })
    .eq("id", connection.id)

  const { data: syncLogRow } = await supabase
    .from("sync_log")
    .insert({
      sync_type: isIncremental ? "ignition_incremental" : "ignition_backfill",
      sync_direction: "inbound",
      status: "running",
      started_at: startedAt,
      is_manual: options.isManual ?? true,
      triggered_by_id: options.triggeredByTeamMemberId ?? null,
    })
    .select("id")
    .maybeSingle()

  const resourceOptions: ResourceSyncOptions = {
    updatedSince: options.updatedSince ?? null,
  }

  const results: ResourceSyncResult[] = []
  for (const resource of resources) {
    const fn = RESOURCE_FUNCTIONS[resource]
    if (!fn) continue
    const result = await fn(connection, supabase, resourceOptions)
    results.push(result)
  }

  const finishedAt = new Date().toISOString()
  const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0)
  const totalUpserted = results.reduce((sum, r) => sum + r.upserted, 0)
  // "Errors" here counts all per-resource error strings — a `skipped_unmappable`
  // is recorded as an error so it's visible, but it doesn't flip the overall
  // status away from success unless we also have a hard fetch/upsert error.
  const hardErrors = results.reduce(
    (sum, r) =>
      sum + r.errors.filter((e) => !e.startsWith("skipped_unmappable")).length,
    0,
  )
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)
  const overallStatus = hardErrors === 0 ? "success" : "partial"

  await supabase
    .from("ignition_connections")
    .update({
      last_synced_at: finishedAt,
      last_sync_started_at: null,
      last_sync_error:
        hardErrors === 0
          ? null
          : results
              .filter((r) => r.errors.some((e) => !e.startsWith("skipped_unmappable")))
              .map(
                (r) =>
                  `${r.resource}: ${r.errors.find((e) => !e.startsWith("skipped_unmappable")) ?? ""}`,
              )
              .join("; "),
      updated_at: finishedAt,
    })
    .eq("id", connection.id)

  if (syncLogRow?.id) {
    await supabase
      .from("sync_log")
      .update({
        status: overallStatus,
        completed_at: finishedAt,
        records_fetched: totalFetched,
        records_updated: totalUpserted,
        records_failed: totalErrors,
        // ALWAYS write the per-resource breakdown — the admin UI reads this
        // out of error_details to render the results table after a run.
        error_details: { results } as any,
      })
      .eq("id", syncLogRow.id)
  }

  return {
    startedAt,
    finishedAt,
    totalFetched,
    totalUpserted,
    totalErrors,
    results,
  }
}
