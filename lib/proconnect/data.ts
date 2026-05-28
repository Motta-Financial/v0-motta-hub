/**
 * ProConnect Tax-Return Data API (Phase 1)
 *
 * Wraps the two new endpoints introduced in the Phase 1 spec:
 *
 *   GET  /v2/clients/{clientId}/returns/{returnId}/data
 *   POST /v2/clients/{clientId}/returns/{returnId}/import/series/{seriesId}
 *
 * These live on https://api.intuit.com (NOT on client.accountant or
 * engagement.accountant) and require the scope
 * `com.intuit.proconnect.taxreturns` which Intuit must explicitly
 * allow-list for our app. If our existing refresh token doesn't have
 * that scope, calls will return 401 — we surface that distinctly so
 * the dashboard can prompt re-consent rather than silently failing.
 *
 * Reference: ProConnect Open API Doc — Phase 1.
 */

import { getAccessToken, getRealmId } from "./oauth"

const TAX_RETURNS_BASE_URL =
  process.env.PROCONNECT_TAX_RETURNS_BASE_URL || "https://api.intuit.com"

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
    const parsed = JSON.parse(body) as { errorCode?: string }
    return typeof parsed.errorCode === "string" ? parsed.errorCode : null
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
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<Result<T>> {
  const accessToken = await getAccessToken()
  const realmId = getRealmId()

  const url = `${TAX_RETURNS_BASE_URL}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    intuit_product: "ITO",
    intuit_realmid: realmId,
    // Generate a fresh `intuit-tid` per request so the server can
    // correlate logs back to a specific call. Doc strongly recommends.
    "intuit-tid": cryptoRandomTid(),
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

/** RFC 4122-style 8-char request id. */
function cryptoRandomTid(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export the full series map and metadata for a single return.
 */
export async function exportReturnData(
  clientId: string,
  returnId: string
): Promise<Result<ReturnExport>> {
  return authedRequest<ReturnExport>(
    `/v2/clients/${encodeURIComponent(clientId)}/returns/${encodeURIComponent(returnId)}/data`,
    { method: "GET" }
  )
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
    { method: "POST", body: payload }
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
