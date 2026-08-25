/**
 * 403-verify-create-tax-return.ts
 *
 * One-off verification for the ProConnect "Create Tax Return" endpoint
 * (lib/proconnect/client.ts `createTaxReturn()`) and its `source` /
 * proforma field. Neither has ever been called against a live Intuit
 * response — both are wired from an unconfirmed "external view" doc, not
 * from the authoritative "ProConnect Open API — Series Map Export &
 * Import (Phase 1) v3" spec, which only documents Export and Import. See
 * the ⚠️ comment above CREATE_RETURN_BASE_URL in lib/proconnect/client.ts.
 *
 * WHY THE GUARDS: the Data Service has NO delete endpoint for a created
 * return. A bad call cannot be undone through the API — that is the
 * entire reason proconnect_tax_return_creation_jobs exists. Export had
 * this exact failure mode for months: a wrong path produced 403s that
 * read as "not provisioned" when the real problem was the URL (missing
 * `oii-client/` — see the header comment in lib/proconnect/data.ts).
 * Treat any 403/404 from this script the same way, not as proof Create
 * Tax Return isn't live.
 *
 * Commands
 *   preflight   READ-ONLY, the default. Resolves the target client from
 *               proconnect_clients, prints the exact host + path
 *               createTaxReturn() would call and the exact payload — then
 *               exits without sending anything. Safe for anyone to run.
 *   create      Sends ONE real create call. Refuses unless BOTH:
 *                 --i-understand-this-creates-a-real-return  is passed, AND
 *                 --client matches SENTINEL_CLIENT_ID below.
 *               Same fail-closed pattern as SENTINEL_RETURN_ID in
 *               scripts/376-retest-intuit-import-defects.ts. Writes a
 *               proconnect_tax_return_creation_jobs row before the call
 *               and updates it after, exactly as
 *               app/api/prospects/[id]/create-tax-return/route.ts does.
 *   proforma    Same as create, same guards, but also passes a prior-year
 *               engagement id as `source`. After the call, exports the
 *               newly created return and reports whether any series came
 *               back populated — that is the only way to tell a real
 *               roll-forward from a blank return.
 *
 * Every create/proforma call reports: HTTP status, the intuit-tid header,
 * and the response body with client identifiers (name, email, phone,
 * ssn/tax id, address, dob) redacted. A 403/404 prints a note that this
 * is the signature of a wrong host/path, not proof of a provisioning
 * problem, with a pointer to the Export precedent.
 *
 * This script does not modify lib/proconnect/client.ts, the
 * create-tax-return route, the UI, or SUPPORTED_RETURN_TYPES — it only
 * imports them to mirror the same validation the route enforces.
 *
 * Usage (repo root; needs .env.local — `vercel env pull .env.local` — for
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CRON_SECRET):
 *
 *   npx tsx scripts/403-verify-create-tax-return.ts preflight --client <clientOiiId> \
 *     [--name "Doe, John"] [--type IND] [--year 2025] [--source <priorEngagementId>]
 *
 *   npx tsx scripts/403-verify-create-tax-return.ts create --client <clientOiiId> \
 *     --name "Doe, John" --type IND --year 2025 \
 *     --i-understand-this-creates-a-real-return
 *
 *   npx tsx scripts/403-verify-create-tax-return.ts proforma --client <clientOiiId> \
 *     --name "Doe, John" --type IND --year 2025 --source <priorEngagementId> \
 *     --i-understand-this-creates-a-real-return
 *
 * Token note (same as scripts/364 and scripts/376): ProConnect client
 * creds pull as "[SENSITIVE]" locally, so this script cannot refresh the
 * OAuth token itself. It POSTs the production /api/proconnect/sync with
 * CRON_SECRET first, which refreshes + stores the token server-side; the
 * local calls then ride the fresh DB-stored access token.
 *
 * Not covered here: esignature.envelopes[] — that retest lives in
 * scripts/402.
 */
import { existsSync, readFileSync } from "node:fs"

// ── Fail-closed target. A human must deliberately fill this in with a
// real ProConnect client id (from proconnect_clients.proconnect_client_id)
// before `create` or `proforma` will run. Left empty on purpose — there is
// no sandbox and no delete endpoint, so nothing here should be runnable by
// accident. Prefer a client attached to a low-stakes/internal test entity.
const SENTINEL_CLIENT_ID = "" // e.g. "0123456789-abc..." — fill in deliberately

// Mirrors CREATE_RETURN_BASE_URL in lib/proconnect/client.ts. Not imported
// from there because that constant isn't exported (by design — see its
// header comment); duplicating it here keeps this script able to observe
// response headers (intuit-tid) that the shared apiRequest() helper does
// not surface. Override with the same env var Intuit confirmation would
// use in production.
// Deliberately NOT redeclared here. The whole point of this script is to
// verify the host and path lib/proconnect/client.ts actually sends; a local
// copy would verify itself. Resolved at call time via getCreateReturnBaseUrl()
// / buildCreateReturnPath().

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

// ---------------------------------------------------------------------------
// Redaction — client identifiers only, never structural/status fields.
// ---------------------------------------------------------------------------
const REDACT_KEYS = new Set([
  "name",
  "clientname",
  "displayname",
  "businessname",
  "firstname",
  "lastname",
  "email",
  "phone",
  "ssn",
  "taxid",
  "tax_id",
  "address",
  "dob",
  "birthdate",
  "dateofbirth",
])

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase()) && v != null) out[k] = "«redacted»"
      else out[k] = redact(v)
    }
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// Payload construction — mirrors CreateTaxReturnPayload in client.ts and
// the validation app/api/prospects/[id]/create-tax-return/route.ts applies,
// without importing anything mutable from either.
// ---------------------------------------------------------------------------

type Payload = { name: string; type: string; year: number; source?: string }

function buildPayload(opts: Record<string, string | boolean>): Payload {
  const name = typeof opts["name"] === "string" ? (opts["name"] as string).trim() : "HUB VERIFICATION — DO NOT FILE"
  const type = typeof opts["type"] === "string" ? (opts["type"] as string).toUpperCase() : "IND"
  const year = opts["year"] ? Number(opts["year"]) : new Date().getFullYear() - 1
  const source = typeof opts["source"] === "string" ? (opts["source"] as string) : undefined
  return { name, type, year, ...(source ? { source } : {}) }
}

async function validatePayload(payload: Payload) {
  const { RETURN_TYPE_MAP, SUPPORTED_RETURN_TYPES } = await import("../lib/proconnect/client")
  if (!(payload.type in RETURN_TYPE_MAP)) {
    console.error(`--type must be one of: ${Object.keys(RETURN_TYPE_MAP).join(", ")}`)
    process.exit(1)
  }
  if (!(SUPPORTED_RETURN_TYPES as readonly string[]).includes(payload.type)) {
    console.error(
      `--type "${payload.type}" is documented as "will follow", not yet live. ` +
        `The route rejects this too (SUPPORTED_RETURN_TYPES = ${SUPPORTED_RETURN_TYPES.join(", ")}). ` +
        `Pass --type IND, or if you are deliberately testing the rejection path, that IS the route's real behavior.`,
    )
    process.exit(1)
  }
  if (!Number.isInteger(payload.year) || payload.year < 2000 || payload.year > 2100) {
    console.error(`--year must be a valid 4-digit tax year, got "${payload.year}"`)
    process.exit(1)
  }
  if (!payload.name) {
    console.error("--name is required")
    process.exit(1)
  }
}

async function resolveClient(sb: any, clientOiiId: string) {
  const { data, error } = await sb
    .from("proconnect_clients")
    .select("proconnect_client_id, display_name, business_name, client_type, client_state")
    .eq("proconnect_client_id", clientOiiId)
    .maybeSingle()
  if (error) {
    console.warn(`  (client lookup failed, continuing anyway: ${error.message})`)
    return null
  }
  return data
}

// ---------------------------------------------------------------------------
// preflight — read-only
// ---------------------------------------------------------------------------

async function preflight(sb: any, clientOiiId: string, payload: Payload) {
  console.log("── preflight (read-only, nothing is sent) ──────────────────\n")

  const client = await resolveClient(sb, clientOiiId)
  if (client) {
    console.log(
      `client ${clientOiiId} found in proconnect_clients: ` +
        `${client.display_name ?? client.business_name ?? "(no name on file)"} ` +
        `(${client.client_type ?? "?"}, ${client.client_state ?? "?"})`,
    )
  } else {
    console.log(
      `client ${clientOiiId} was NOT found in proconnect_clients. createTaxReturn() requires an\n` +
        "existing ProConnect client — this function never creates one. Resolve a real id first.",
    )
  }

  // Read the host and path from client.ts so preflight prints what the code
  // WOULD send, not a restatement of it.
  const { getCreateReturnBaseUrl, buildCreateReturnPath } = await import("../lib/proconnect/client")
  const base = getCreateReturnBaseUrl()
  const path = buildCreateReturnPath(clientOiiId)
  console.log(`\nhost:   ${base}`)
  console.log(`path:   ${path}`)
  console.log(`method: POST`)
  console.log(`url:    ${base}${path}`)
  console.log(`\npayload:\n${JSON.stringify(payload, null, 2)}`)

  console.log(
    "\n⚠️  This host/path come from an unconfirmed doc, not the authoritative Phase 1 v3 spec\n" +
      "   (which only documents Export/Import). A 403/404 from `create` means \"wrong host,\n" +
      "   path, or endpoint doesn't exist yet\" — not \"not provisioned\". Export had exactly\n" +
      "   this failure mode (missing oii-client/ segment) for months. See the ⚠️ comment above\n" +
      "   CREATE_RETURN_BASE_URL in lib/proconnect/client.ts.\n",
  )
  console.log(
    payload.source
      ? "This payload includes `source` — a proforma test. Run `proforma`, not `create`, so the\n" +
          "roll-forward gets verified against a re-export automatically."
      : "No `source` set — this would create a blank return with no prior-year rollover.\n" +
          "Pass --source <priorYearEngagementId> and use `proforma` to test roll-forward instead.",
  )
  console.log(
    `\nNext (only once SENTINEL_CLIENT_ID is filled in at the top of this file):\n` +
      `  npx tsx scripts/403-verify-create-tax-return.ts create --client ${clientOiiId} ` +
      `--name "${payload.name}" --type ${payload.type} --year ${payload.year} ` +
      `--i-understand-this-creates-a-real-return`,
  )
}

// ---------------------------------------------------------------------------
// Raw call — mirrors apiRequest()'s request construction in
// lib/proconnect/client.ts exactly, so the request Intuit sees is
// identical, but also captures the intuit-tid response header, which
// apiRequest() does not surface to callers.
// ---------------------------------------------------------------------------

async function rawCreateTaxReturn(clientOiiId: string, payload: Payload) {
  const { getAccessToken, getRealmId } = await import("../lib/proconnect/oauth")
  const { newIntuitTid, acquireRateLimitSlot } = await import("../lib/proconnect/rate-limit")
  await acquireRateLimitSlot()

  const { getCreateReturnBaseUrl, buildCreateReturnPath } = await import("../lib/proconnect/client")
  const url = `${getCreateReturnBaseUrl()}${buildCreateReturnPath(clientOiiId)}`
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
  return {
    status: res.status,
    tid: res.headers.get("intuit_tid") ?? res.headers.get("intuit-tid"),
    body,
    url,
  }
}

function reportOn403or404(status: number) {
  if (status === 403 || status === 404) {
    console.log(
      `\n⚠️  HTTP ${status} — per the Export precedent, treat this as "wrong host/path or endpoint\n` +
        `   doesn't exist yet", NOT as proof Create Tax Return isn't provisioned. Export's own\n` +
        `   path was wrong (missing oii-client/) for months and returned exactly this shape of\n` +
        `   failure. Confirm the host/path with Intuit before concluding anything from this call.\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// create / proforma — COMMITS. Guards re-implemented here because this
// script talks to Intuit directly, bypassing the API route.
// ---------------------------------------------------------------------------

function assertGuards(clientOiiId: string, opts: Record<string, string | boolean>) {
  if (!SENTINEL_CLIENT_ID) {
    console.error(
      "refusing: SENTINEL_CLIENT_ID is empty. A human must edit this file and hard-code a real\n" +
        "ProConnect client id before this script can create anything. There is no delete endpoint\n" +
        "for a created return — this must never run against an arbitrary id by accident.",
    )
    process.exit(1)
  }
  if (clientOiiId !== SENTINEL_CLIENT_ID) {
    console.error(
      `refusing: --client ${clientOiiId} does not match the SENTINEL_CLIENT_ID hard-coded in this\n` +
        `file (${SENTINEL_CLIENT_ID}). Commits only ever go to the designated sentinel client.`,
    )
    process.exit(1)
  }
  if (!opts["i-understand-this-creates-a-real-return"]) {
    console.error(
      "refusing: pass --i-understand-this-creates-a-real-return. This COMMITS a real tax return\n" +
        "in ProConnect that cannot be deleted through the API.",
    )
    process.exit(1)
  }
}

/** Mirrors the audit discipline in app/api/prospects/[id]/create-tax-return/route.ts. */
async function insertJob(sb: any, clientOiiId: string, payload: Payload, scriptName: string) {
  const { data, error } = await sb
    .from("proconnect_tax_return_creation_jobs")
    .insert({
      prospect_submission_id: null,
      proconnect_client_id: clientOiiId,
      requested_name: payload.name,
      requested_type: payload.type,
      requested_year: payload.year,
      requested_source: payload.source ?? null,
      status: "pending",
      triggered_by: `script:${scriptName}`,
      trigger_context: { reason: "endpoint verification", payload },
    })
    .select("id")
    .single()
  if (error) {
    console.error(`failed to write audit row before calling ProConnect — aborting: ${error.message}`)
    process.exit(1)
  }
  return data.id as string
}

async function updateJob(
  sb: any,
  jobId: string,
  fields: {
    status: "succeeded" | "failed"
    http_status: number
    response_raw?: unknown
    created_engagement_id?: string | null
    error_message?: string | null
    intuit_tid?: string | null
  },
) {
  const { error } = await sb
    .from("proconnect_tax_return_creation_jobs")
    .update({ ...fields, completed_at: new Date().toISOString() })
    .eq("id", jobId)
  if (error) console.warn(`  (audit row update failed: ${error.message})`)
}

function extractEngagementId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  return (b.engagementId as string) || (b.id as string) || (b.returnId as string) || null
}

async function create(sb: any, clientOiiId: string, payload: Payload) {
  const jobId = await insertJob(sb, clientOiiId, payload, "403-verify-create-tax-return")
  console.log(`audit row ${jobId} written (status: pending)\n`)

  await refreshTokenServerSide()
  console.log(`\n── COMMIT ─────────────────────────────────────────────────`)
  {
    const { getCreateReturnBaseUrl, buildCreateReturnPath } = await import("../lib/proconnect/client")
    console.log(`POST ${getCreateReturnBaseUrl()}${buildCreateReturnPath(clientOiiId)}`)
  }
  console.log(`payload: ${JSON.stringify(payload)}`)

  const res = await rawCreateTaxReturn(clientOiiId, payload)
  console.log(`\nHTTP ${res.status}  intuit-tid=${res.tid ?? "(none)"}`)
  console.log(`body: ${JSON.stringify(redact(res.body)).slice(0, 2000)}`)

  const ok = res.status >= 200 && res.status < 300
  const engagementId = ok ? extractEngagementId(res.body) : null

  await updateJob(sb, jobId, {
    status: ok ? "succeeded" : "failed",
    http_status: res.status,
    response_raw: res.body,
    created_engagement_id: engagementId,
    error_message: ok ? null : typeof res.body === "string" ? res.body.slice(0, 2000) : JSON.stringify(res.body).slice(0, 2000),
    intuit_tid: res.tid,
  })

  reportOn403or404(res.status)

  if (ok) {
    console.log(
      `\n>>> Create Tax Return: CONFIRMED LIVE — HTTP ${res.status}${
        engagementId ? `, created engagement ${engagementId}` : " (no engagement id found in response body)"
      }.\n    Flip the ⚠️ comments in lib/proconnect/client.ts from "unverified" to "confirmed".`,
    )
  } else {
    console.log(`\n>>> Create Tax Return: NOT confirmed by this call (HTTP ${res.status}). See note above.`)
  }
  return { ok, engagementId, clientOiiId }
}

async function proforma(sb: any, clientOiiId: string, payload: Payload) {
  if (!payload.source) {
    console.error("refusing: proforma requires --source <priorYearEngagementId>")
    process.exit(1)
  }
  const result = await create(sb, clientOiiId, payload)
  if (!result.ok) {
    console.log("\ncreate call did not succeed — cannot test roll-forward. See the report above.")
    return
  }
  if (!result.engagementId) {
    console.log(
      "\ncreate call succeeded but no engagement id could be extracted from the response body —\n" +
        "cannot export the new return to check roll-forward. Re-check response_raw in\n" +
        "proconnect_tax_return_creation_jobs, or find the new return via the next engagement sync.",
    )
    return
  }

  console.log(`\n── verifying roll-forward: exporting the new return ${result.engagementId} ──`)
  const { exportReturnData } = await import("../lib/proconnect/data")
  const exp = await exportReturnData(clientOiiId, result.engagementId)
  if (!exp.ok) {
    console.log(
      `export of the new return failed: ${exp.error.kind} ${exp.error.status} — cannot confirm\n` +
        "roll-forward this way. The return may just not be indexed yet; try again shortly.",
    )
    return
  }

  const seriesMap = exp.data.data ?? {}
  const populatedSeries = Object.keys(seriesMap).filter((sid) => {
    const prefixes = Object.values(seriesMap[sid] ?? {})
    return prefixes.some((codes: any) =>
      Object.values(codes ?? {}).some((suffixes: any) =>
        Object.values(suffixes ?? {}).some((cell: any) => cell?.val != null || cell?.desc != null),
      ),
    )
  })

  if (populatedSeries.length > 0) {
    console.log(
      `\n>>> Proforma: CONFIRMED — ${populatedSeries.length} series came back populated ` +
        `(${populatedSeries.slice(0, 10).join(", ")}${populatedSeries.length > 10 ? ", ..." : ""}).\n` +
        `    source=${payload.source} produced a real roll-forward, not a blank return.`,
    )
  } else {
    console.log(
      "\n>>> Proforma: INCONCLUSIVE/EMPTY — the new return exported with zero populated series.\n" +
        "    Either `source` did not roll anything forward, or the prior-year engagement itself\n" +
        "    had no data. Re-check with a prior-year engagement known to have real values.",
    )
  }
}

// ---------------------------------------------------------------------------

async function main() {
  loadEnv()
  const { cmd, opts } = parseArgs()
  const command = cmd || "preflight"
  if (!["preflight", "create", "proforma"].includes(command)) {
    console.error(
      "usage: preflight|create|proforma --client <clientOiiId> [--name <text>] [--type IND]\n" +
        "       [--year <YYYY>] [--source <priorEngagementId>] [--i-understand-this-creates-a-real-return]",
    )
    process.exit(1)
  }

  const clientOiiId = opts["client"] as string
  if (!clientOiiId || typeof clientOiiId !== "string") {
    console.error("refusing: --client <clientOiiId> is required (a real proconnect_clients.proconnect_client_id)")
    process.exit(1)
  }

  const payload = buildPayload(opts)
  await validatePayload(payload)

  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  if (command === "preflight") return preflight(sb, clientOiiId, payload)

  // create / proforma both commit — same fail-closed gate.
  assertGuards(clientOiiId, opts)
  if (command === "create") return create(sb, clientOiiId, payload)
  return proforma(sb, clientOiiId, payload)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
