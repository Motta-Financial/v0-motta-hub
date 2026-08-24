/**
 * ProConnect Tax-Return Data API (Phase 1)
 *
 * Wraps the two Data Service endpoints:
 *
 *   Export: GET  /v2/clients/oii-client/{clientOiiId}/returns/{returnId}/data
 *   Import: POST /v2/clients/{clientId}/returns/{returnId}/import/series/{seriesId}
 *
 * These live on https://protaxdata.api.intuit.com (the Data Service host —
 * NOT client.accountant, engagement.accountant, or the plain api.intuit.com
 * gateway) and require the scope `com.intuit.proconnect.taxreturns`.
 *
 * IMPORTANT — the Export path has an `oii-client/` segment that the original
 * Phase 1 doc OMITTED; Intuit's corrected V2 doc includes it. Calling the
 * doc's path (`/v2/clients/{id}/returns/{id}/data`, no `oii-client/`) returned
 * `403 insufficient_scope` / `AuthorizationFailed` on every call from launch
 * through 2026-07-27. That LOOKED like a scope/allow-list gap but was really a
 * wrong URL — realm 9130356180193146 was provisioned all along. Confirmed
 * 2026-07-27: the `oii-client/` path returns 200 with a full series map.
 * (Fix per Steve @ Intuit.) `clientId` and `clientOiiId` are the same id.
 *
 * NOTE the asymmetry — Import does NOT use `oii-client/`. Don't "tidy up" the
 * two paths to match; the gateway routes them differently.
 *
 * Export and Import also live on DIFFERENT HOSTS (doc v3 §3). Sending an
 * Import to the Export host answers 403 AuthorizationFailed — the same
 * indistinguishable-from-unprovisioned failure the `oii-client/` omission
 * produced on Export. Verified against the sentinel return 2026-08-07:
 * import host + no oii-client → 200; every other combination → 403.
 *
 * Reference: ProConnect Open API Doc — Phase 1 (external view) v3.
 */

import { getAccessToken, getRealmId } from "./oauth"
import { acquireRateLimitSlot, newIntuitTid } from "./rate-limit"

/** Data Service / Export API. */
const TAX_RETURNS_BASE_URL =
  process.env.PROCONNECT_TAX_RETURNS_BASE_URL || "https://protaxdata.api.intuit.com"

/** Import Service / Import API — a separate host (doc v3 §3). */
const IMPORT_BASE_URL =
  process.env.PROCONNECT_IMPORT_BASE_URL || "https://protaxonlineimport.api.intuit.com"

// Spec caps a single import at 500 entries. We split anything larger.
export const MAX_ENTRIES_PER_IMPORT = 500

// ---------------------------------------------------------------------------
// Types — mirror the OpenAPI schemas in the Phase 1 doc.
// ---------------------------------------------------------------------------

export type FieldCell = {
  val?: string | null
  desc?: string | null
  src?: string | null
  /** taxpayer / spouse / joint flag */
  tsj?: "T" | "S" | "J" | "N" | "" | null
  scope?: string | null
  source?: string | null
  cityAbbrev?: string | null
  importSource?: string[] | null
  // Spec is `additionalProperties: true`, so unknown leaf props are allowed.
  [key: string]: unknown
}

/** seriesId → prefixId → codeId → suffixId → FieldCell */
export type SeriesMap = Record<
  string,
  Record<string, Record<string, Record<string, FieldCell>>>
>

export type SeriesVersion = { series: string; version: string }
export type EfileItem = { efileId: string; included: boolean }
export type Agency = { abbrev: string }

export type ReturnExport = {
  name?: string
  clientName?: string
  year?: number
  type?: "IND" | "COR" | "SCO" | "PAR" | "FID" | "EXM" | "GFT"
  data?: SeriesMap
  efileItems?: EfileItem[]
  agency?: Agency[]
  /** Return-level UUIDv1 — bumped on every write. Used for OCC. */
  version?: string
  seriesVersion?: SeriesVersion[]
  id_uuid?: string
  id_client?: string
  id_firm?: string
  createdTime?: number
  createdBy?: string
}

export type ImportEntry = {
  prefixId: string
  codeId: string
  suffixId: string
  val?: string
  desc?: string
  src?: string
  tsj?: "T" | "S" | "J" | "N" | ""
  source?: string
  cityAbbrev?: string
}

export type ImportRequest = {
  /**
   * Per-spec: required when updating an existing series, must be `null`
   * (NOT omitted) when creating a series for the first time.
   */
  version: string | null
  dryRun?: boolean
  entries: ImportEntry[]
}

/**
 * Per-entry rejection detail. Per Phase 1 spec §B.6 + Appendix A, the
 * server returns an *array* of per-field failures for each rejected
 * entry — e.g. a single c808 entry can fail with both a value rule and
 * a length rule simultaneously, producing two ErrorDetail rows. Do NOT
 * collapse this into scalar `errorCode`/`errorMessage`; downstream
 * code (proconnect_import_entry_results.error_details jsonb) stores
 * the array verbatim.
 */
export type ErrorDetail = {
  code: string
  field: string
  message: string
}

export type ImportEntryError = {
  prefixId: string
  codeId: string
  suffixId: string
  errorDetails: ErrorDetail[]
}

export type ImportSeriesResult = {
  seriesId: string
  importedCount: number
  errorCount: number
  /** Omitted on dryRun:true */
  version?: string
  errors: ImportEntryError[]
}

export type ImportResponse = {
  summary: {
    totalImported: number
    totalErrors: number
    dryRun: boolean
  }
  results: ImportSeriesResult[]
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

export type ProconnectApiError =
  | { kind: "unauthenticated"; status: 401; body: string }
  /** 401/403 with body indicating scope is missing — caller should re-consent. */
  | { kind: "scope_missing"; status: 401 | 403; body: string }
  /** 403 ACCESS_DENIED — token's firm doesn't own (clientId, returnId). */
  | { kind: "access_denied"; status: 403; body: string }
  | { kind: "not_found"; status: 404; body: string }
  /** Export-side lock per §A.7 surfaces as 403 RETURN_LOCKED; import side is 423. */
  | { kind: "locked"; status: 403 | 423; body: string; retryAfterMs?: number }
  | { kind: "rate_limited"; status: 429; body: string; retryAfterMs?: number }
  | { kind: "payload_too_large"; status: 413; body: string }
  | { kind: "bad_request"; status: 400; body: string }
  | { kind: "server"; status: number; body: string }
  | { kind: "network"; status: 0; body: string }

export type Result<T> =
  | { ok: true; status: number; data: T; intuitTid: string | null }
  | { ok: false; error: ProconnectApiError; intuitTid: string | null }

function classify(status: number, body: string): ProconnectApiError {
  // Inspect the upstream errorCode in the body so we can disambiguate the
  // overloaded 401/403 statuses (§A.7 + §B.8). The body shape per spec is
  // `{ "errorCode": "...", "errorMessage": "..." }` — we read it best-effort.
  const upstreamCode = parseUpstreamErrorCode(body)

  if (status === 401) {
    // 401 UNAUTHENTICATED is either an expired/invalid token or a
    // missing-scope condition. The Phase 1 doc explicitly calls out
    // that the `com.intuit.proconnect.taxreturns` scope must be
    // allow-listed; until it is, we'll see 401s on these endpoints.
    // We surface as scope_missing so the UI can prompt re-consent.
    return { kind: "scope_missing", status: 401, body }
  }
  if (status === 403) {
    // §A.7: export uses `403 RETURN_LOCKED` (import uses 423).
    if (upstreamCode === "RETURN_LOCKED") return { kind: "locked", status: 403, body }
    if (upstreamCode === "ACCESS_DENIED") return { kind: "access_denied", status: 403, body }
    // Gateway-level rejection. Observed on 100% of Import attempts (verified
    // 2026-08-03) while Export succeeds on the same token — i.e. the app/token
    // is not entitled to the Import operation, which per Phase 1 §2.1 requires
    // the firm's PRIMARY ADMIN token. Classified as scope_missing so the UI
    // surfaces the re-consent path rather than a generic failure.
    if (upstreamCode === "AuthorizationFailed") {
      return { kind: "scope_missing", status: 403, body }
    }
    // Default: treat unattributed 403 as scope-missing (consent flow).
    return { kind: "scope_missing", status: 403, body }
  }
  if (status === 404) return { kind: "not_found", status, body }
  if (status === 423) return { kind: "locked", status: 423, body }
  if (status === 429) return { kind: "rate_limited", status, body }
  if (status === 413) return { kind: "payload_too_large", status, body }
  if (status === 400) return { kind: "bad_request", status, body }
  return { kind: "server", status, body }
}

function parseUpstreamErrorCode(body: string): string | null {
  if (!body) return null
  try {
    // Two distinct error shapes reach us:
    //   1. The ProConnect service, per the Phase 1 spec:
    //        { "errorCode": "RETURN_LOCKED", "errorMessage": "..." }
    //   2. The Intuit API *gateway*, which rejects before the request ever
    //      reaches ProConnect and uses a different envelope entirely:
    //        { "code": "AuthorizationFailed", "type": "INPUT", "message": null }
    //      Verified live 2026-08-03: every Import call returns exactly this,
    //      with or without the `oii-client/` path segment, while Export on the
    //      same token returns 200. Reading only `errorCode` classified these as
    //      an unattributed 403 and lost the one diagnostic string that explains
    //      what happened.
    const parsed = JSON.parse(body) as { errorCode?: string; code?: string }
    if (typeof parsed.errorCode === "string") return parsed.errorCode
    if (typeof parsed.code === "string") return parsed.code
    return null
  } catch {
    return null
  }
}

/**
 * Exponential backoff for 429/423/5xx. Honors Retry-After when present.
 * Capped at 5 attempts; first retry at 500ms, then 1s, 2s, 4s, 8s.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempt = 0
): Promise<{ status: number; body: string; tid: string | null }> {
  const MAX_ATTEMPTS = 5

  let res: Response
  try {
    // Throttle before EVERY attempt, including retries. This path previously
    // had backoff but no limiter, while client.ts had a limiter but no
    // backoff — so the write path (Export/Import) could burst past Intuit's
    // ~5 TPS cap. Both now share one counter (lib/proconnect/rate-limit.ts).
    // Placing this inside the retry recursion means a backoff storm is
    // rate-limited too, not just the first attempt.
    await acquireRateLimitSlot()
    res = await fetch(url, init)
  } catch (err) {
    // Network / DNS / TLS — don't retry indefinitely; one retry only.
    if (attempt < 1) {
      await sleep(500)
      return fetchWithRetry(url, init, attempt + 1)
    }
    throw err
  }

  const tid = res.headers.get("intuit-tid")
  const body = await res.text()

  // Idempotency-aware retry. Phase 1 doc §4 is explicit: "Import is not
  // idempotent — repeated calls accumulate writes." So we MUST NOT blindly
  // re-issue a POST import after a 5xx, since the write may have partially
  // landed before the failure — a retry would double-write tax values.
  //
  //   - 429 RATE_LIMITED and 423 RETURN_LOCKED are guaranteed *no-write*
  //     states (the request was rejected before processing), so they're
  //     safe to retry for any method.
  //   - 5xx INTERNAL_ERROR is only auto-retried for idempotent reads (GET
  //     Export). For POST Import we surface the 5xx to the caller, which
  //     records the attempt in proconnect_import_jobs so a human/dedup
  //     step can decide whether to re-issue. (Doc §4: "Clients should
  //     de-duplicate before retrying.")
  const isIdempotent = (init.method ?? "GET").toUpperCase() === "GET"
  const retryable =
    res.status === 429 ||
    res.status === 423 ||
    (isIdempotent && res.status >= 500 && res.status <= 504)
  if (retryable && attempt < MAX_ATTEMPTS - 1) {
    const retryAfterHeader = res.headers.get("retry-after")
    const retryAfterMs = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10) * 1000
      : Math.min(8000, 500 * Math.pow(2, attempt))
    await sleep(retryAfterMs)
    return fetchWithRetry(url, init, attempt + 1)
  }

  return { status: res.status, body, tid }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function authedRequest<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; baseUrl?: string }
): Promise<Result<T>> {
  const accessToken = await getAccessToken()
  const realmId = getRealmId()

  const url = `${init.baseUrl ?? TAX_RETURNS_BASE_URL}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    intuit_product: "ITO",
    intuit_realmid: realmId,
    // Generate a fresh `intuit-tid` per request so the server can
    // correlate logs back to a specific call. Doc strongly recommends.
    "intuit-tid": newIntuitTid(),
  }
  if (init.body !== undefined) headers["Content-Type"] = "application/json"

  let result: { status: number; body: string; tid: string | null }
  try {
    result = await fetchWithRetry(url, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch (err) {
    return {
      ok: false,
      intuitTid: null,
      error: {
        kind: "network",
        status: 0,
        body: err instanceof Error ? err.message : String(err),
      },
    }
  }

  if (result.status >= 200 && result.status < 300) {
    let parsed: T
    try {
      parsed = result.body ? (JSON.parse(result.body) as T) : ({} as T)
    } catch (err) {
      return {
        ok: false,
        intuitTid: result.tid,
        error: {
          kind: "server",
          status: result.status,
          body: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      }
    }
    return { ok: true, status: result.status, data: parsed, intuitTid: result.tid }
  }

  return {
    ok: false,
    intuitTid: result.tid,
    error: classify(result.status, result.body),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the Export path for a return.
 *
 * Extracted so a health check can assert the shape of the path this module
 * ACTUALLY sends, rather than restating it. On 2026-08-15 a promoted preview
 * reverted production to the `oii-client`-less form and 403'd on every call;
 * a check that hardcoded its own copy of the path would have reported green
 * throughout. See the `oii-client` note at the top of this file.
 */
export function buildExportPath(clientId: string, returnId: string): string {
  return `/v2/clients/oii-client/${encodeURIComponent(clientId)}/returns/${encodeURIComponent(returnId)}/data`
}

/** The two Phase 1 hosts, exposed for diagnostics. Never call these directly. */
export function getPhase1Hosts(): { exportBase: string; importBase: string } {
  return { exportBase: TAX_RETURNS_BASE_URL, importBase: IMPORT_BASE_URL }
}

/**
 * Export the full series map and metadata for a single return.
 */
export async function exportReturnData(
  clientId: string,
  returnId: string
): Promise<Result<ReturnExport>> {
  return authedRequest<ReturnExport>(buildExportPath(clientId, returnId), {
    method: "GET",
  })
}

/**
 * Import one series of entries onto a return. Caller must pass
 * `seriesId` matching `^s\d{1,6}$`. Spec caps `entries.length <= 500`;
 * we enforce that here to avoid 413s round-tripping.
 */
export async function importSeries(
  clientId: string,
  returnId: string,
  seriesId: string,
  payload: ImportRequest
): Promise<Result<ImportResponse>> {
  if (!/^s\d{1,6}$/.test(seriesId)) {
    return {
      ok: false,
      intuitTid: null,
      error: {
        kind: "bad_request",
        status: 400,
        body: `Invalid seriesId "${seriesId}" — must match ^s\\d{1,6}$`,
      },
    }
  }
  if (!payload.entries || payload.entries.length === 0) {
    return {
      ok: false,
      intuitTid: null,
      error: { kind: "bad_request", status: 400, body: "entries[] is required and must be non-empty" },
    }
  }
  if (payload.entries.length > MAX_ENTRIES_PER_IMPORT) {
    return {
      ok: false,
      intuitTid: null,
      error: {
        kind: "bad_request",
        status: 400,
        body: `entries[].length=${payload.entries.length} exceeds spec max of ${MAX_ENTRIES_PER_IMPORT}; chunk client-side`,
      },
    }
  }

  return authedRequest<ImportResponse>(
    `/v2/clients/${encodeURIComponent(clientId)}/returns/${encodeURIComponent(returnId)}/import/series/${encodeURIComponent(seriesId)}`,
    { method: "POST", body: payload, baseUrl: IMPORT_BASE_URL }
  )
}

// ---------------------------------------------------------------------------
// Series-map helpers
// ---------------------------------------------------------------------------

export type FlatCell = {
  seriesId: string
  prefixId: string
  codeId: string
  suffixId: string
  cell: FieldCell
}

/**
 * Flatten the nested series-map shape into one row per leaf cell.
 * Useful for normalising into proconnect_return_field_cells and for
 * diffing one snapshot against another before issuing an import.
 */
export function flattenSeriesMap(data: SeriesMap | undefined): FlatCell[] {
  if (!data) return []
  const out: FlatCell[] = []
  for (const [seriesId, prefixMap] of Object.entries(data)) {
    if (!prefixMap || typeof prefixMap !== "object") continue
    for (const [prefixId, codeMap] of Object.entries(prefixMap)) {
      if (!codeMap || typeof codeMap !== "object") continue
      for (const [codeId, suffixMap] of Object.entries(codeMap)) {
        if (!suffixMap || typeof suffixMap !== "object") continue
        for (const [suffixId, cell] of Object.entries(suffixMap)) {
          if (!cell || typeof cell !== "object") continue
          out.push({ seriesId, prefixId, codeId, suffixId, cell })
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Post-write verification
//
// Intuit defect 3 (open as of 2026-08-07): an entry that the API cannot apply
// is still reported as applied. Every attempt to clear a value came back
// `{"totalImported":1,"totalErrors":0}` with a bumped series version and the
// cell unchanged. So `summary.totalImported` is NOT evidence the return now
// matches what was sent — the only evidence is a fresh Export.
//
// Callers that commit must therefore re-export and run the entries through
// verifyEntriesLanded() before reporting success.
// ---------------------------------------------------------------------------

export type UnlandedEntry = {
  prefixId: string
  codeId: string
  suffixId: string
  /**
   * absent            — the cell doesn't exist in the export at all
   * value_mismatch    — the cell exists but holds something else
   * clear_ignored     — we sent an empty/absent value and the old one is still there
   */
  reason: "absent" | "value_mismatch" | "clear_ignored"
}

export type ImportVerification = {
  checked: number
  landed: number
  /** Addresses only — never values (§8). */
  unlanded: UnlandedEntry[]
}

/**
 * Numbers survive the round trip reformatted — "150000" comes back as
 * "150,000" or "150000.00" depending on the field. Compare numerically when
 * both sides parse, exactly otherwise.
 */
function sameValue(sent: string, got: string): boolean {
  if (sent === got) return true
  const a = Number(sent.replace(/,/g, ""))
  const b = Number(got.replace(/,/g, ""))
  return Number.isFinite(a) && Number.isFinite(b) && a === b
}

/**
 * Check that each entry actually landed, given an Export taken AFTER the
 * commit. `rejected` is the errors[] array Intuit returned — those entries
 * are already reported as failures and are skipped here so they aren't
 * counted twice.
 */
export function verifyEntriesLanded(
  exportData: ReturnExport,
  seriesId: string,
  entries: ImportEntry[],
  rejected: ImportEntryError[] = []
): ImportVerification {
  const wasRejected = new Set(
    rejected.map((e) => `${e.prefixId}/${e.codeId}/${e.suffixId}`)
  )
  const series = exportData.data?.[seriesId]
  const unlanded: UnlandedEntry[] = []
  let checked = 0

  for (const entry of entries) {
    const addr = `${entry.prefixId}/${entry.codeId}/${entry.suffixId}`
    if (wasRejected.has(addr)) continue
    checked++

    const cell = series?.[entry.prefixId]?.[entry.codeId]?.[entry.suffixId]
    const at = { prefixId: entry.prefixId, codeId: entry.codeId, suffixId: entry.suffixId }

    // A clear: we sent no value, or an empty one. It landed only if the
    // cell is now gone or empty. This is the case defect 3 always fails.
    const sentVal = entry.val
    const sentDesc = entry.desc
    const isClear =
      (sentVal === undefined || sentVal === "") && (sentDesc === undefined || sentDesc === "")
    if (isClear) {
      const stillSet =
        cell != null && ((cell.val != null && cell.val !== "") || (cell.desc != null && cell.desc !== ""))
      if (stillSet) unlanded.push({ ...at, reason: "clear_ignored" })
      continue
    }

    if (cell == null) {
      unlanded.push({ ...at, reason: "absent" })
      continue
    }
    if (sentVal !== undefined && !sameValue(sentVal, String(cell.val ?? ""))) {
      unlanded.push({ ...at, reason: "value_mismatch" })
      continue
    }
    if (sentDesc !== undefined && sentDesc !== String(cell.desc ?? "")) {
      unlanded.push({ ...at, reason: "value_mismatch" })
    }
  }

  return { checked, landed: checked - unlanded.length, unlanded }
}

/**
 * Compute the version stamp for a specific series given a snapshot.
 * Returns null if the series isn't tracked in seriesVersion[]. Pass
 * this back into ImportRequest.version to satisfy OCC.
 */
export function getSeriesVersion(
  exportData: ReturnExport,
  seriesId: string
): string | null {
  const match = (exportData.seriesVersion || []).find((s) => s.series === seriesId)
  return match?.version ?? null
}
