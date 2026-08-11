/**
 * 376-retest-intuit-import-defects.ts
 *
 * Re-test the four Intuit Import-API defects Intuit confirmed on the
 * 2026-07-27 call (target fix ~2026-08-03). Source of truth for the defect
 * list: skills/proconnect-1040-mapping/SKILL.md § "Known Intuit defects".
 *
 *   1  Hard cap of 20 instances for dispositions
 *   2  M-screens are not importable (screen ids starting with "M")
 *   3  No delete / clear — a written value cannot be removed via the API
 *   4  API-written flag (importSource.isDetailImport) not set on API writes
 *
 * Result of the 2026-08-07 run: 1 and 2 FIXED, 3 and 4 STILL OPEN. Details
 * and evidence live in the skill's "Known Intuit defects" section.
 *
 * Commands
 *   survey    read-only. Inventories the catalog + the current sentinel
 *             export so the probes below can be aimed at real codes.
 *             Touches Intuit only with a GET (Export).
 *   screens   catalog lookup by screen title: --grep "disposition".
 *   shape     dump one series' nesting from a live Export, values redacted.
 *   paths     endpoint forensics. Sends a dryRun down every plausible
 *             host/path/verb combination and calibrates the 403 against a
 *             known-bad route. This is what found the separate Import host.
 *   history   every Import the Hub has ever attempted, from the audit table.
 *   probe     defects 1 and 2 via dryRun:true imports. Persists nothing at
 *             Intuit (§B.2) — safe on any return.
 *   write     defects 3 and 4. COMMITS to the return. Refuses unless
 *             --i-understand-this-writes is passed AND the return is the
 *             designated sentinel. Re-exports afterwards and reports
 *             importSource on the cell it wrote (defect 4).
 *   clear     defect 3 follow-up. Attempts every plausible shape of
 *             "remove this value" against the cell `write` created,
 *             re-exporting after each to see whether any of them took.
 *
 * Usage (repo root; needs .env.local from the mottahub project —
 * `vercel env pull .env.local` — for SUPABASE_URL / SERVICE_ROLE_KEY /
 * CRON_SECRET):
 *   npx tsx scripts/376-retest-intuit-import-defects.ts survey [--return <returnId>]
 *   npx tsx scripts/376-retest-intuit-import-defects.ts screens --grep disposition
 *   npx tsx scripts/376-retest-intuit-import-defects.ts paths
 *   npx tsx scripts/376-retest-intuit-import-defects.ts probe
 *   npx tsx scripts/376-retest-intuit-import-defects.ts write --i-understand-this-writes
 *   npx tsx scripts/376-retest-intuit-import-defects.ts clear --i-understand-this-writes
 *
 * `write` and `clear` refuse any return but the sentinel, `write` runs its own
 * dry run first, and both record audit rows in proconnect_import_jobs.
 *
 * Token note (same as scripts/364): ProConnect client creds pull as
 * "[SENSITIVE]" locally, so this script cannot refresh the OAuth token
 * itself. It POSTs the production /api/proconnect/sync with CRON_SECRET
 * first, which refreshes + stores the token server-side; the local calls
 * then ride the fresh DB-stored access token.
 */
import { existsSync, readFileSync } from "node:fs"

// The one return designated for write tests: "SENTINEL TEST — DO NOT FILE".
// Hard-coded rather than read from PROCONNECT_WRITE_ALLOWED_RETURN_IDS
// because that var lives in Vercel, not locally — this script bypasses the
// API route, so it has to carry its own allowlist. Fails closed.
const SENTINEL_RETURN_ID = "de74b2b2-ab40-4867-8a2a-d52f1518c58d"

// Phase 1 doc (external view) v3, §3 "Environments & Base URLs":
//   Production (Data Service / Export API)   https://protaxdata.api.intuit.com
//   Production (Import Service / Import API) https://protaxonlineimport.api.intuit.com
// Two different hosts. Earlier revisions of the doc listed only one, which
// is how lib/proconnect/data.ts came to post Import to the Export host.
const IMPORT_BASE = process.env.PROCONNECT_IMPORT_BASE_URL || "https://protaxonlineimport.api.intuit.com"

function parseArgs() {
  const [, , cmd, ...rest] = process.argv
  const opts: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("--")) continue
    const key = rest[i].slice(2)
    const next = rest[i + 1]
    if (!next || next.startsWith("--")) opts[key] = true
    else {
      opts[key] = next
      i++
    }
  }
  return { cmd, opts }
}

function loadEnv() {
  const path = `${process.cwd()}/.env.local`
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=")
    if (eq < 1 || line.startsWith("#")) continue
    const key = line.slice(0, eq)
    let v = line.slice(eq + 1)
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    if (!(key in process.env)) process.env[key] = v
  }
}

async function refreshTokenServerSide() {
  if (!process.env.CRON_SECRET) {
    console.warn("CRON_SECRET not set — assuming the DB token is already fresh")
    return
  }
  const res = await fetch("https://hub.motta.cpa/api/proconnect/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean }
  console.log(`token refresh via prod sync: ${res.status} ${body.ok ? "ok" : "FAILED"}`)
}

async function main() {
  loadEnv()
  const { cmd, opts } = parseArgs()
  const returnId = (opts["return"] as string) || SENTINEL_RETURN_ID
  if (!["survey", "screens", "shape", "paths", "history", "selftest", "probe", "write", "clear"].includes(cmd)) {
    console.error(
      "usage: survey|screens|shape|paths|history|probe|write|clear [--return <id>] " +
        "[--grep <text>] [--series <sid>] [--prefix <pN>] [--i-understand-this-writes]",
    )
    process.exit(1)
  }
  if (opts["prefix"]) {
    const prefixId = String(opts["prefix"])
    if (!/^p\d{1,4}$/.test(prefixId)) {
      console.error(`--prefix must look like p26, got "${prefixId}"`)
      process.exit(1)
    }
    ACTIVE = { ...TARGET, prefixId }
  }

  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: eng, error: engErr } = await sb
    .from("proconnect_engagements")
    .select("proconnect_client_id, tax_year, return_type, status")
    .eq("engagement_id", returnId)
    .maybeSingle()
  if (engErr || !eng) {
    console.error("engagement lookup failed:", engErr?.message ?? "not found")
    process.exit(1)
  }
  const clientId = eng.proconnect_client_id as string
  console.log(
    `return ${returnId} — client ${clientId} — ${eng.return_type ?? "?"} TY${eng.tax_year ?? "?"} (${eng.status ?? "?"})\n`,
  )

  if (cmd === "survey") return survey(sb, clientId, returnId)
  if (cmd === "screens") return screens(sb, String(opts["grep"] ?? ""))
  if (cmd === "probe") return probe(sb, clientId, returnId)
  if (cmd === "shape") return shape(clientId, returnId, String(opts["series"] ?? ""))
  if (cmd === "paths") return paths(sb, clientId, returnId)
  if (cmd === "history") return history(sb)
  if (cmd === "selftest") return selftest(clientId, returnId)
  if (cmd === "write" || cmd === "clear") {
    // Both gates the API route enforces, re-implemented here because this
    // script talks to Intuit directly. Fails closed on each.
    if (returnId !== SENTINEL_RETURN_ID) {
      console.error(
        `refusing: ${returnId} is not the designated sentinel return.\n` +
          "There is no delete in this API and no sandbox — commits go only to\n" +
          `${SENTINEL_RETURN_ID} ("SENTINEL TEST — DO NOT FILE").`,
      )
      process.exit(1)
    }
    if (!opts["i-understand-this-writes"]) {
      console.error("refusing: pass --i-understand-this-writes. This COMMITS to a live ProConnect return.")
      process.exit(1)
    }
    return cmd === "write" ? write(sb, clientId, returnId) : clear(sb, clientId, returnId)
  }
  console.error(`command "${cmd}" not implemented yet in this revision`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// The cell the write/clear tests use.
//
// s52 = "Schedule D/4797/etc." (the PTO Dispositions screen), c800 =
// "Description of property", a free-text field. Instance p25 is chosen
// deliberately: it is past the old 20-instance cap, so committing it tests
// defect 1 for real (dryRun may not enforce an instance cap that a commit
// would) while also creating the cell defects 3 and 4 need. Text field, no
// tax consequence, on a return that will never be filed.
// ---------------------------------------------------------------------------
// Defect 3 means p25 can never be emptied again, so each later re-test of
// defect 4 needs its own untouched instance: --prefix p26, p27, …
const TARGET = { seriesId: "s52", prefixId: "p25", codeId: "c800", suffixId: "x1000" }
const TARGET_TEXT = "RETEST 20260807 DEFECT PROBE"

/** TARGET with --prefix applied. `clear` leaves it at p25; `write` moves it on. */
let ACTIVE = { ...TARGET }

/** Date-stamped so the export shows which run left which cell behind. */
function probeText(now: Date) {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "")
  return `RETEST ${stamp} DEFECT PROBE`
}

function readCell(exp: any, t = ACTIVE) {
  return exp.data?.[t.seriesId]?.[t.prefixId]?.[t.codeId]?.[t.suffixId] ?? null
}

/** Mirror the API route's audit policy: every attempt gets a row. */
async function auditImport(
  sb: any,
  args: {
    returnId: string
    clientId: string
    seriesId: string
    version: string | null
    dryRun: boolean
    entries: Array<Record<string, unknown>>
    res: { status: number; tid: string | null; body: any }
    reason: string
  },
) {
  const { res } = args
  const summary = res.body?.summary
  const { error } = await sb.from("proconnect_import_jobs").insert({
    return_id: args.returnId,
    proconnect_client_id: args.clientId,
    series_id: args.seriesId,
    request_version: args.version,
    dry_run: args.dryRun,
    entry_count_requested: args.entries.length,
    // Addresses and has-value flags only — never values (§8).
    entries_payload: {
      entries: args.entries.map((e) => ({
        prefixId: e.prefixId,
        codeId: e.codeId,
        suffixId: e.suffixId,
        tsj: e.tsj ?? null,
        has_val: e.val !== undefined,
        has_desc: e.desc !== undefined,
        has_src: e.src !== undefined,
      })),
      redacted: true,
    },
    status:
      res.status !== 200 ? "failed" : (summary?.totalErrors ?? 0) > 0 ? "partial" : "succeeded",
    http_status: res.status,
    imported_count: summary?.totalImported ?? null,
    error_count: summary?.totalErrors ?? null,
    response_version: res.body?.results?.[0]?.version ?? null,
    response_summary: summary ?? null,
    response_raw: res.body ?? null,
    intuit_tid: res.tid,
    completed_at: new Date().toISOString(),
    triggered_by: "script:376-retest-intuit-import-defects",
    trigger_context: { reason: args.reason },
  })
  if (error) console.warn(`  (audit row failed: ${error.message})`)
}

// ---------------------------------------------------------------------------
// write — defects 1 (for real), 3 (setup) and 4
// ---------------------------------------------------------------------------

async function write(sb: any, clientId: string, returnId: string) {
  await refreshTokenServerSide()
  const { exportReturnData, getSeriesVersion } = await import("../lib/proconnect/data")

  const before = await exportReturnData(clientId, returnId)
  if (!before.ok) {
    console.error(`export failed: ${before.error.kind} ${before.error.status}`)
    process.exit(1)
  }
  const existing = readCell(before.data)
  console.log(
    `target ${ACTIVE.seriesId}/${ACTIVE.prefixId}/${ACTIVE.codeId}/${ACTIVE.suffixId} — ` +
      `currently ${existing ? "POPULATED" : "empty"}`,
  )
  if (existing) {
    console.error(
      "refusing: target cell already holds data. Pick an unused instance with --prefix pN\n" +
        "(defect 3 means a populated cell can never be emptied again).",
    )
    process.exit(1)
  }
  const version = getSeriesVersion(before.data, ACTIVE.seriesId)
  const entry = { ...ACTIVE, desc: probeText(new Date()) }
  const { seriesId, ...entryBody } = entry

  // Gate 2, same as the API route: a clean dry run of the exact shape first.
  console.log("\n── dry run (required before any commit) ────────────────────")
  const dry = await rawImport(clientId, returnId, seriesId, { version, dryRun: true, entries: [entryBody] })
  await auditImport(sb, { returnId, clientId, seriesId, version, dryRun: true, entries: [entryBody], res: dry, reason: "defect retest: pre-commit dry run" })
  console.log(`  HTTP ${dry.status} ${JSON.stringify(dry.body?.summary ?? dry.body)}`)
  if (dry.status !== 200 || (dry.body?.summary?.totalErrors ?? 1) !== 0) {
    console.error(`  dry run not clean — aborting before the commit.\n  ${JSON.stringify(dry.body).slice(0, 600)}`)
    process.exit(1)
  }

  console.log("\n── COMMIT ─────────────────────────────────────────────────")
  const commit = await rawImport(clientId, returnId, seriesId, { version, dryRun: false, entries: [entryBody] })
  await auditImport(sb, { returnId, clientId, seriesId, version, dryRun: false, entries: [entryBody], res: commit, reason: "defect retest: commit for defects 1/3/4" })
  console.log(`  HTTP ${commit.status} tid=${commit.tid}`)
  console.log(`  ${JSON.stringify(commit.body).slice(0, 600)}`)

  verdict(
    `defect 1 (real commit at instance ${ACTIVE.prefixId.slice(1)})`,
    commit.status === 200 && (commit.body?.summary?.totalImported ?? 0) === 1
      ? true
      : commit.status === 200
        ? false
        : null,
    commit.status === 200 && (commit.body?.summary?.totalImported ?? 0) === 1
      ? `disposition instance ${ACTIVE.prefixId.slice(1)} committed — the 20-instance cap is gone`
      : `commit did not persist: ${JSON.stringify(commit.body?.results?.[0]?.errors ?? commit.body).slice(0, 300)}`,
  )

  // ── defect 4 — does the written cell carry isDetailImport? ──────────
  console.log("\n── re-export: what does importSource say? ─────────────────")
  const after = await exportReturnData(clientId, returnId)
  if (!after.ok) {
    console.error(`re-export failed: ${after.error.kind} ${after.error.status}`)
    process.exit(1)
  }
  const cell: any = readCell(after.data)
  console.log(`  cell now: ${cell ? JSON.stringify(cell) : "(still absent)"}`)
  const src: string[] = cell?.importSource ?? []
  verdict(
    "defect 4 (isDetailImport)",
    cell == null ? null : src.includes("isDetailImport") ? true : false,
    cell == null
      ? "the cell did not appear in the export — cannot judge"
      : src.includes("isDetailImport")
        ? `importSource = ${JSON.stringify(src)} — the API write is flagged`
        : `importSource = ${JSON.stringify(src)} — no isDetailImport, API writes are still indistinguishable from manual entry`,
  )
  console.log(`\nNext: npx tsx scripts/376-retest-intuit-import-defects.ts clear --i-understand-this-writes`)
}

// ---------------------------------------------------------------------------
// clear — defect 3
// ---------------------------------------------------------------------------

async function clear(sb: any, clientId: string, returnId: string) {
  await refreshTokenServerSide()
  const { exportReturnData, getSeriesVersion } = await import("../lib/proconnect/data")

  // Every shape a caller might reasonably expect to mean "remove this".
  // The spec defines none of them, so this is an enumeration, not a lookup.
  const attempts: Array<[string, Record<string, unknown>]> = [
    ["desc: empty string", { desc: "" }],
    ["desc: null", { desc: null }],
    ["val: empty string", { val: "" }],
    ["val: null", { val: null }],
    ["no value sub-field at all", {}],
  ]

  for (const [label, patch] of attempts) {
    const exp = await exportReturnData(clientId, returnId)
    if (!exp.ok) {
      console.error(`export failed: ${exp.error.kind} ${exp.error.status}`)
      process.exit(1)
    }
    const cell = readCell(exp.data)
    if (!cell) {
      console.log(`\ncell is already gone — nothing left to clear.`)
      verdict("defect 3 (no delete/clear)", true, "the cell no longer appears in the export")
      return
    }
    const { seriesId, ...addr } = ACTIVE
    const version = getSeriesVersion(exp.data, seriesId)
    const entryBody = { ...addr, ...patch }

    console.log(`\n── attempt: ${label} ──────────────────────────────────────`)
    const res = await rawImport(clientId, returnId, seriesId, { version, dryRun: false, entries: [entryBody] })
    await auditImport(sb, { returnId, clientId, seriesId, version, dryRun: false, entries: [entryBody], res, reason: `defect 3 retest: clear via ${label}` })
    console.log(`  HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`)

    const post = await exportReturnData(clientId, returnId)
    const now: any = post.ok ? readCell(post.data) : null
    console.log(`  cell after: ${now ? JSON.stringify(now) : "(absent)"}`)
    if (!now || (now.desc == null && now.val == null) || now.desc === "") {
      verdict("defect 3 (no delete/clear)", true, `"${label}" removed the value`)
      return
    }
  }
  verdict(
    "defect 3 (no delete/clear)",
    false,
    "none of the five clear shapes removed the value — still no way to delete through the API",
  )
}

// ---------------------------------------------------------------------------
// Raw import — bypasses lib/proconnect/data.ts's `^s\d{1,6}$` seriesId guard.
//
// That guard is correct for production (the catalog has no non-numeric
// series), but defect 2 is *about* non-numeric series ids, so the retest has
// to be able to put `s100M` in the path. Everything else — base URL, headers,
// tid — mirrors authedRequest() so the call Intuit sees is identical.
// ---------------------------------------------------------------------------

async function rawImport(
  clientId: string,
  returnId: string,
  seriesId: string,
  payload: { version: string | null; dryRun: boolean; entries: unknown[] },
) {
  const { getAccessToken, getRealmId } = await import("../lib/proconnect/oauth")
  const { newIntuitTid, acquireRateLimitSlot } = await import("../lib/proconnect/rate-limit")
  await acquireRateLimitSlot()
  // Import lives on its own host and does NOT take the `oii-client/`
  // segment — the exact mirror image of Export. See IMPORT_BASE above.
  const url =
    `${IMPORT_BASE}/v2/clients/${encodeURIComponent(clientId)}` +
    `/returns/${encodeURIComponent(returnId)}/import/series/${encodeURIComponent(seriesId)}`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      intuit_product: "ITO",
      intuit_realmid: getRealmId(),
      "intuit-tid": newIntuitTid(),
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    /* leave as text */
  }
  return { status: res.status, tid: res.headers.get("intuit_tid") ?? res.headers.get("intuit-tid"), body }
}

/**
 * Read-only check of verifyEntriesLanded() against real Export data. The
 * sentinel return is the ideal fixture: s52/p25/c800 holds the probe text
 * that defect 3 refused to clear, so a "clear" of it must be reported as
 * clear_ignored — the exact case the helper exists to catch.
 */
async function selftest(clientId: string, returnId: string) {
  await refreshTokenServerSide()
  const { exportReturnData, verifyEntriesLanded } = await import("../lib/proconnect/data")
  const exp = await exportReturnData(clientId, returnId)
  if (!exp.ok) {
    console.error(`export failed: ${exp.error.kind} ${exp.error.status}`)
    process.exit(1)
  }
  const { seriesId, ...addr } = TARGET
  const cases: Array<[string, any[], string | null]> = [
    ["value that IS present → landed", [{ ...addr, desc: TARGET_TEXT }], null],
    ["clear of a value that persisted → clear_ignored", [{ ...addr }], "clear_ignored"],
    ["empty-string clear → clear_ignored", [{ ...addr, desc: "" }], "clear_ignored"],
    ["wrong text at a real address → value_mismatch", [{ ...addr, desc: "NOT WHAT IS THERE" }], "value_mismatch"],
    ["address that doesn't exist → absent", [{ ...addr, prefixId: "p99", desc: "x" }], "absent"],
    ["rejected entries are skipped, not counted", [{ ...addr, desc: "NOT WHAT IS THERE" }], null],
  ]

  let failed = 0
  cases.forEach(([label, entries, expected], i) => {
    // The last case passes the entry in as already-rejected by Intuit.
    const rejected = i === cases.length - 1 ? [{ ...addr, errorDetails: [] }] : []
    const v = verifyEntriesLanded(exp.data, seriesId, entries as any, rejected as any)
    const got = v.unlanded[0]?.reason ?? null
    const ok = got === expected && (expected !== null || v.landed === v.checked)
    if (!ok) failed++
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${label}\n` +
        `        checked=${v.checked} landed=${v.landed} reason=${got ?? "(none)"} expected=${expected ?? "(none)"}`,
    )
  })
  console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases passed")
  if (failed) process.exit(1)
}

/**
 * Every Import attempt the Hub has ever made, from the audit table. Answers
 * "has this API ever returned anything but 403 for us?" — which decides
 * whether a 403 today is a regression or the standing state.
 */
async function history(sb: any) {
  const { data, error } = await sb
    .from("proconnect_import_jobs")
    .select("started_at, series_id, dry_run, status, http_status, entry_count_requested, imported_count, error_count, error_message, triggered_by")
    .order("started_at", { ascending: false })
    .limit(50)
  if (error) {
    console.error(error.message)
    process.exit(1)
  }
  if (!data?.length) {
    console.log("proconnect_import_jobs is EMPTY — the Hub has never called Import.")
    return
  }
  console.log(`${data.length} import job(s), most recent first:`)
  for (const j of data)
    console.log(
      `  ${j.started_at}  ${j.series_id.padEnd(7)} ${j.dry_run ? "dry " : "COMMIT"} ` +
        `${String(j.status).padEnd(9)} http=${j.http_status ?? "-"} ` +
        `req=${j.entry_count_requested} ok=${j.imported_count ?? "-"} err=${j.error_count ?? "-"}` +
        (j.error_message ? `  ${String(j.error_message).slice(0, 120)}` : ""),
    )
}

/**
 * Import returns 403 AuthorizationFailed on the documented path while Export
 * (which needs the extra `oii-client/` segment) succeeds on the same token.
 * Before reading anything into a defect retest, establish which of the two is
 * true: the token lacks write scope, or the Import path shape is wrong.
 */
async function paths(sb: any, clientId: string, returnId: string) {
  const { data: tok } = await sb
    .from("proconnect_oauth_tokens")
    .select("scope, realm_id, expires_at")
    .limit(1)
    .maybeSingle()
  console.log(`token: realm=${tok?.realm_id} expires=${tok?.expires_at}`)
  console.log(`granted scopes: ${tok?.scope ?? "(none recorded)"}\n`)

  await refreshTokenServerSide()
  const { getAccessToken, getRealmId } = await import("../lib/proconnect/oauth")
  const { newIntuitTid } = await import("../lib/proconnect/rate-limit")
  const base = process.env.PROCONNECT_TAX_RETURNS_BASE_URL || "https://protaxdata.api.intuit.com"
  const token = await getAccessToken()
  const realm = getRealmId()

  // A single no-op-shaped dry run, sent down each candidate path. dryRun
  // persists nothing (§B.2) and the code is deliberately invalid, so the
  // only thing being measured here is routing + authorization.
  const body = JSON.stringify({
    version: null,
    dryRun: true,
    entries: [{ prefixId: "p1", codeId: "c999999999", suffixId: "x1000", val: "1" }],
  })

  const call = async (
    label: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    withBody: boolean,
    host = base,
  ) => {
    const res = await fetch(`${host}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(withBody ? { "Content-Type": "application/json" } : {}),
        intuit_product: "ITO",
        intuit_realmid: realm,
        "intuit-tid": newIntuitTid(),
      },
      body: withBody ? body : undefined,
    })
    const text = await res.text()
    console.log(`${label}\n  ${method} ${host}${path}\n  → HTTP ${res.status}  ${text.slice(0, 300)}\n`)
    await new Promise((r) => setTimeout(r, 300))
    return res.status
  }

  // The discriminator. If a KNOWN-GOOD path answers 403 to POST, the 403 is
  // about the write, not the route. If a KNOWN-BAD path also answers 403,
  // then this gateway says 403 for "no such route" too and the import 403
  // tells us nothing about entitlement — it means we have the path wrong.
  const exportOk = await call("export control (must be 200)", "GET", `/v2/clients/oii-client/${clientId}/returns/${returnId}/data`, false)
  const bogusPath = await call("bogus path (routing baseline)", "GET", `/v2/clients/oii-client/${clientId}/returns/${returnId}/no-such-endpoint`, false)
  const postToRead = await call("POST to the working Export path (verb test)", "POST", `/v2/clients/oii-client/${clientId}/returns/${returnId}/data`, true)

  // Calibration: the Export endpoint definitely exists, but with the
  // oii-client segment removed. If that also answers 403, then 403 is this
  // gateway's answer to "path I don't recognise" and the import 403 is
  // consistent with a path problem, not an entitlement problem.
  await call("export path MINUS oii-client (calibration)", "GET", `/v2/clients/${clientId}/returns/${returnId}/data`, false)

  // §3 of the Phase 1 doc (v3) gives Import its OWN production host —
  // protaxonlineimport.api.intuit.com — separate from the Export host. The
  // Hub had been posting imports to the Export host, which is why every
  // attempt answered 403.
  const importVariants: Array<[string, "POST", string, string]> = [
    ["import host, doc path", "POST", `/v2/clients/${clientId}/returns/${returnId}/import/series/s100`, IMPORT_BASE],
    ["import host, oii-client", "POST", `/v2/clients/oii-client/${clientId}/returns/${returnId}/import/series/s100`, IMPORT_BASE],
    ["export host, doc path (old behaviour)", "POST", `/v2/clients/${clientId}/returns/${returnId}/import/series/s100`, base],
    ["export host, oii-client", "POST", `/v2/clients/oii-client/${clientId}/returns/${returnId}/import/series/s100`, base],
  ]
  const results: Array<[string, number]> = []
  for (const [label, method, path, host] of importVariants)
    results.push([label, await call(label, method, path, true, host)])

  console.log("──────────────────────────────────────────────────────────")
  console.log(`export GET (control)        : ${exportOk}`)
  console.log(`bogus path GET              : ${bogusPath}`)
  console.log(`POST to the export path     : ${postToRead}`)
  for (const [label, status] of results) console.log(`${label.padEnd(28).slice(0, 28)}: ${status}`)
  console.log("")
  if (bogusPath === 403) {
    console.log(
      "READ: this gateway answers 403 AuthorizationFailed for unknown routes too, so a\n" +
        "403 here never means 'not entitled' — it means the URL is wrong. On 2026-08-07\n" +
        "that turned out to be the host: Import lives on protaxonlineimport.api.intuit.com\n" +
        "and takes NO oii-client/ segment, the mirror image of Export.",
    )
  } else {
    console.log(
      `READ: unknown routes answer ${bogusPath}, not 403 — so 403 on a real path would be an\n` +
        "entitlement answer. Re-read this if the gateway's behaviour has changed.",
    )
  }
}

/** One-line verdict formatter shared by every probe. */
function verdict(label: string, fixed: boolean | null, detail: string) {
  const tag = fixed === true ? "FIXED     " : fixed === false ? "STILL OPEN" : "INCONCLUSIVE"
  console.log(`\n  >>> ${label}: ${tag} — ${detail}`)
}

// ---------------------------------------------------------------------------
// probe — defects 1 and 2, dryRun only (§B.2: persists nothing)
// ---------------------------------------------------------------------------

async function probe(sb: any, clientId: string, returnId: string) {
  await refreshTokenServerSide()
  const { exportReturnData, getSeriesVersion } = await import("../lib/proconnect/data")
  const exp = await exportReturnData(clientId, returnId)
  if (!exp.ok) {
    console.error(`export failed: ${exp.error.kind} ${exp.error.status}`)
    process.exit(1)
  }
  const ret = exp.data
  const map = ret.data ?? {}

  // ── Defect 2 — M-screens are not importable ─────────────────────────
  //
  // Controlled comparison. The M-series on this return (s100M, s200M) are
  // empty, and the catalog has no M rows, so there is no known-good code to
  // send. Instead send the SAME deliberately-invalid code to a numeric
  // series and to an M series and compare where each fails:
  //
  //   numeric control  → HTTP 200 + entry-level error  (routing worked,
  //                      field validation rejected the code)
  //   M treatment      → same shape  ⇒ M routing works, defect 2 FIXED
  //                    → request-level 4xx / different failure
  //                      ⇒ still rejected before field validation
  //
  // dryRun:true throughout, and the code doesn't exist, so nothing can land.
  console.log("── Defect 2: M-screens not importable ──────────────────────")
  const BOGUS_CODE = "c999999999"
  const probeEntry = { prefixId: "p1", codeId: BOGUS_CODE, suffixId: "x1000", val: "1" }
  const allSeries = (ret.seriesVersion ?? []).map((s) => s.series)
  const mSeries = allSeries.filter((s) => !/^s\d+$/.test(s))
  console.log(`  series on return: ${allSeries.length}, non-numeric: ${mSeries.join(", ") || "(none)"}`)

  const shot = async (sid: string) => {
    const res = await rawImport(clientId, returnId, sid, {
      version: getSeriesVersion(ret, sid),
      dryRun: true,
      entries: [probeEntry],
    })
    const errs: any[] = res.body?.results?.[0]?.errors ?? []
    console.log(`  ${sid.padEnd(7)} → HTTP ${res.status} tid=${res.tid}`)
    console.log(`     ${JSON.stringify(res.body).slice(0, 500)}`)
    return { sid, status: res.status, entryErrors: errs.length, body: res.body }
  }

  const control = await shot("s100")
  const treatments = []
  for (const sid of mSeries) treatments.push(await shot(sid))

  // Stronger test when the return actually has a populated M-series cell:
  // echo its CURRENT value back as a dry run. A clean result proves the
  // whole path works on a real M address, not just that routing resolves.
  // Echoing the existing value means even a hypothetical stray commit is a
  // no-op overwrite of identical data.
  for (const sid of mSeries) {
    const prefixes = Object.keys(map[sid] ?? {})
    if (!prefixes.length) continue
    const prefixId = prefixes[0]
    const codeId = Object.keys(map[sid][prefixId])[0]
    const suffixId = Object.keys(map[sid][prefixId][codeId])[0]
    const cell: any = map[sid][prefixId][codeId][suffixId]
    const entry: Record<string, unknown> = { prefixId, codeId, suffixId }
    if (cell.val != null) entry.val = String(cell.val)
    if (cell.desc != null) entry.desc = String(cell.desc)
    if (cell.tsj != null) entry.tsj = cell.tsj

    const res = await rawImport(clientId, returnId, sid, {
      version: getSeriesVersion(ret, sid),
      dryRun: true,
      entries: [entry],
    })
    const clean = res.status === 200 && (res.body?.summary?.totalErrors ?? 1) === 0
    console.log(
      `  REAL M-CELL ${sid}/${prefixId}/${codeId}/${suffixId} (value echoed, redacted) → HTTP ${res.status}`,
    )
    console.log(`     ${JSON.stringify(res.body?.summary ?? res.body).slice(0, 300)}`)
    verdict(
      `defect 2 (${sid}, real address)`,
      clean ? true : false,
      clean
        ? "a valid M-series entry validated clean end-to-end — M-screens are importable"
        : `rejected: ${JSON.stringify(res.body?.results?.[0]?.errors ?? res.body).slice(0, 300)}`,
    )
  }

  const sameShape = (a: any, b: any) => a.status === b.status && a.entryErrors > 0 === b.entryErrors > 0
  for (const t of treatments) {
    verdict(
      `defect 2 (${t.sid})`,
      sameShape(control, t) ? true : null,
      sameShape(control, t)
        ? `reached field validation exactly like the numeric control s100 (HTTP ${t.status}, ${t.entryErrors} entry error(s)) — the M series id was routed, not rejected`
        : `differs from the numeric control (control HTTP ${control.status}/${control.entryErrors} entry errors vs ${t.status}/${t.entryErrors}) — read the bodies above`,
    )
  }

  // ── Defect 1 — 20-instance cap on dispositions ──────────────────────
  // s52 = "Schedule D/4797/etc." (the PTO Dispositions screen). Send one
  // entry per instance p1..p25 in a single dryRun call and see whether
  // anything past p20 comes back rejected.
  console.log("\n── Defect 1: 20-instance cap on dispositions (s52) ─────────")
  const { data: descRow } = await sb
    .from("proconnect_field_catalog")
    .select("code_id, description, value_type, rules")
    .eq("agency", "Federal")
    .eq("series_id", "s52")
    .ilike("description", "%description of property%")
    .limit(1)
    .maybeSingle()
  if (!descRow) {
    verdict("defect 1", null, 'no "description of property" code found in the s52 catalog')
    return
  }
  console.log(`  using s52/${descRow.code_id} — "${descRow.description}" (${descRow.value_type})`)

  const entries = Array.from({ length: 25 }, (_, i) => ({
    prefixId: `p${i + 1}`,
    codeId: descRow.code_id,
    suffixId: "x1000",
    desc: `RETEST INSTANCE ${i + 1}`,
  }))
  const res = await rawImport(clientId, returnId, "s52", {
    version: getSeriesVersion(ret, "s52") ?? null,
    dryRun: true,
    entries,
  })
  console.log(`  25 instances p1..p25 → HTTP ${res.status} tid=${res.tid}`)
  console.log(`  summary: ${JSON.stringify(res.body?.summary ?? res.body).slice(0, 400)}`)
  const errs: any[] = res.body?.results?.[0]?.errors ?? []
  if (errs.length) {
    const failedPrefixes = errs.map((e) => e.prefixId)
    console.log(`  rejected prefixes: ${failedPrefixes.join(",")}`)
    console.log(`  first error: ${JSON.stringify(errs[0]).slice(0, 400)}`)
  }
  const over20 = errs.filter((e) => Number(String(e.prefixId).slice(1)) > 20)
  verdict(
    "defect 1",
    res.status === 200 && errs.length === 0
      ? true
      : over20.length > 0 && errs.length === over20.length
        ? false
        : null,
    res.status === 200 && errs.length === 0
      ? "all 25 disposition instances validated clean"
      : `${errs.length} rejection(s), ${over20.length} of them above instance 20`,
  )
}

/**
 * Print the nesting of one series verbatim, values redacted. Used to learn
 * the shape of the M-series (s100M/s200M), which the catalog doesn't cover.
 */
async function shape(clientId: string, returnId: string, seriesId: string) {
  await refreshTokenServerSide()
  const { exportReturnData, getSeriesVersion } = await import("../lib/proconnect/data")
  const exp = await exportReturnData(clientId, returnId)
  if (!exp.ok) {
    console.error(`export failed: ${exp.error.kind} ${exp.error.status}`)
    process.exit(1)
  }
  const node = (exp.data.data ?? {})[seriesId]
  console.log(`${seriesId} version=${getSeriesVersion(exp.data, seriesId)}`)
  console.log(`  typeof=${typeof node} isArray=${Array.isArray(node)}`)
  const redact = (k: string, v: unknown) =>
    ["val", "desc", "description", "source"].includes(k) && v != null ? "«redacted»" : v
  console.log(JSON.stringify(node ?? null, redact, 1).slice(0, 4000))
  console.log(
    `\nall seriesVersion entries: ${(exp.data.seriesVersion ?? []).map((s) => s.series).join(" ")}`,
  )
}

/** Catalog screen lookup — "which series is the dispositions screen?" */
async function screens(sb: any, pattern: string) {
  const { data, error } = await sb
    .from("proconnect_field_catalog")
    .select("series_id, screen_title, description")
    .eq("agency", "Federal")
    .ilike("screen_title", `%${pattern}%`)
    .limit(5000)
  if (error) {
    console.error(error.message)
    process.exit(1)
  }
  const bySeries = new Map<string, { title: string; n: number }>()
  for (const r of data ?? []) {
    const cur = bySeries.get(r.series_id) ?? { title: r.screen_title, n: 0 }
    cur.n++
    bySeries.set(r.series_id, cur)
  }
  for (const [sid, v] of [...bySeries.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`${sid.padEnd(8)} ${String(v.n).padStart(4)} codes  ${v.title}`)
}

// ---------------------------------------------------------------------------
// survey — read-only reconnaissance
// ---------------------------------------------------------------------------

async function survey(sb: any, clientId: string, returnId: string) {
  // ── catalog: is there anything M-shaped to aim defect 2 at? ──────────
  const rows: Array<{ series_id: string; screen_title: string | null }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("proconnect_field_catalog")
      .select("series_id, screen_title")
      .eq("agency", "Federal")
      .range(from, from + 999)
    if (error) {
      console.error("catalog read failed:", error.message)
      break
    }
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const bySeries = new Map<string, string | null>()
  for (const r of rows) if (!bySeries.has(r.series_id)) bySeries.set(r.series_id, r.screen_title)
  const nonNumeric = [...bySeries.keys()].filter((s) => !/^s\d+$/.test(s))
  console.log(`catalog: ${rows.length} Federal rows, ${bySeries.size} distinct series`)
  console.log(`  series ids not matching ^s\\d+$ : ${nonNumeric.length ? nonNumeric.join(", ") : "(none)"}`)
  const screensMatching = (re: RegExp) =>
    [...bySeries.entries()]
      .filter(([, t]) => re.test(t ?? ""))
      .map(([s, t]) => `${s} (${t})`)
      .join(" | ") || "(none)"
  console.log(`  disposition screens: ${screensMatching(/disposit/i)}`)
  console.log(`  carryover screens:   ${screensMatching(/carryover/i)}`)

  // ── live export: what does importSource look like today? ─────────────
  await refreshTokenServerSide()
  const { exportReturnData } = await import("../lib/proconnect/data")
  const result = await exportReturnData(clientId, returnId)
  if (!result.ok) {
    console.error(`\nexport failed: ${result.error.kind} ${result.error.status}`)
    process.exit(1)
  }
  const ret = result.data
  const map = ret.data ?? {}
  const seriesIds = Object.keys(map)
  console.log(`\nexport ok: ${seriesIds.length} series on the return, version ${ret.version}`)
  console.log(`  series: ${seriesIds.join(" ")}`)

  // Cell census + a redacted look at importSource, which is what defect 4
  // hinges on: addresses and flags only, never values (§8).
  let cells = 0
  const importSourceShapes = new Map<string, number>()
  for (const [sid, prefixes] of Object.entries(map)) {
    for (const [pid, codes] of Object.entries(prefixes)) {
      for (const [cid, suffixes] of Object.entries(codes)) {
        for (const [xid, cell] of Object.entries(suffixes)) {
          cells++
          const src = (cell as any).importSource
          const key = src === undefined ? "(absent)" : JSON.stringify(src)
          importSourceShapes.set(key, (importSourceShapes.get(key) ?? 0) + 1)
          void sid
          void pid
          void cid
          void xid
        }
      }
    }
  }
  console.log(`  ${cells} populated cells`)
  console.log(`  importSource shapes seen:`)
  for (const [shape, n] of [...importSourceShapes.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`    ${n.toString().padStart(5)} × ${shape}`)

  // Instance census per series — tells us how many disposition instances
  // already exist, which is what defect 1's 20-cap probe has to clear.
  console.log(`\n  instances (distinct prefixIds) per series:`)
  for (const sid of seriesIds) {
    const prefixes = Object.keys(map[sid])
    if (prefixes.length > 1) console.log(`    ${sid}: ${prefixes.length} — ${prefixes.join(",")}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
