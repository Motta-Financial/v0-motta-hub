/**
 * ProConnect Sync Orchestrator
 *
 * Coordinates the full sync: clients → engagements → custom statuses.
 * All data is upserted with full JSONB payloads to preserve every field
 * the API returns.
 *
 * Tax years synced: 2021–2026 (configurable)
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js"
import {
  fetchClients,
  fetchEngagement,
  fetchEngagements,
  fetchAllEngagementsForYear,
  fetchCustomStatuses,
  extractClientEmail,
  extractClientName,
  RETURN_TYPE_MAP,
} from "./client"

// SUPABASE_URL is not set on every Vercel project that serves this repo —
// fall back to the public URL (same project) so cron/webhook code paths
// never build "undefined/..." URLs.
const SUPABASE_URL = (process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL)!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Tax years to sync (inclusive)
const TAX_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]

// Skip clients synced within this many hours (unless full reset)
const SKIP_IF_SYNCED_WITHIN_HOURS = 24

// Time budget before we gracefully stop, checkpoint, and let the next run
// resume. The Vercel function limit is 300s (Pro plan); we stop well before it
// because we need headroom for the in-flight fetch to finish (up to ~4 retries
// with backoff), the partial-progress log write, and response serialization.
// The loop checkpoints at (client, year) granularity, so a single slow client
// can't overshoot this by more than one fetch. Override with
// PROCONNECT_SYNC_BUDGET_MS (e.g. lower it if the platform limit is < 300s).
const MAX_EXECUTION_MS =
  Number(process.env.PROCONNECT_SYNC_BUDGET_MS) || 240_000

interface SyncResult {
  success: boolean
  syncLogId: string
  clientsSynced: number
  engagementsSynced: number
  customStatusesSynced: number
  /** Engagements whose e-file status was re-read this run (bulk sync only). */
  efileHydrated?: number
  /** Engagements still awaiting e-file hydration after this run. */
  efileStaleRemaining?: number
  errors: string[]
  duration: number
  timedOut?: boolean
  partial?: boolean
  lastClientIndex?: number
}

interface SyncLog {
  id: string
  sync_type: string
  status: string
  clients_synced: number
  engagements_synced: number
  custom_statuses_synced: number
  error_message: string | null
  error_details: unknown
  started_at: string
  completed_at: string | null
  last_client_index: number
}

/**
 * Get a Supabase client with service role
 */
function getSupabaseAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

/**
 * Create a sync log entry
 */
async function createSyncLog(
  supabase: SupabaseClient,
  syncType: string
): Promise<string> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .insert({
      sync_type: syncType,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (error) throw new Error(`Failed to create sync log: ${error.message}`)
  return data.id
}

/**
 * Update sync log with results
 */
async function updateSyncLog(
  supabase: SupabaseClient,
  logId: string,
  result: Partial<SyncLog>
): Promise<void> {
  const { error } = await supabase
    .from("proconnect_sync_logs")
    .update({
      ...result,
      completed_at: new Date().toISOString(),
    })
    .eq("id", logId)

  if (error) {
    console.error(`Failed to update sync log: ${error.message}`)
  }
}

/**
 * Get consecutive failure count
 */
async function getConsecutiveFailureCount(
  supabase: SupabaseClient
): Promise<number> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("status")
    .order("started_at", { ascending: false })
    .limit(10)

  if (error || !data) return 0

  let count = 0
  for (const log of data) {
    if (log.status === "failed") {
      count++
    } else {
      break
    }
  }
  return count
}

/**
 * Get the resume index from the most recent partial sync.
 * Returns 0 if the last sync was complete or successful.
 */
async function getResumeIndex(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("status, last_client_index, started_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .single()

  console.log("[v0] getResumeIndex query result:", {
    error: error?.message,
    status: data?.status,
    last_client_index: data?.last_client_index,
    started_at: data?.started_at,
  })

  if (error || !data) {
    console.log("[v0] getResumeIndex returning 0 (no data or error)")
    return 0
  }

  // Only resume if the last run was partial AND has a valid index > 0
  if (
    data.status === "partial" &&
    typeof data.last_client_index === "number" &&
    data.last_client_index > 0
  ) {
    console.log("[v0] getResumeIndex returning", data.last_client_index, "(resuming from partial)")
    return data.last_client_index
  }

  console.log("[v0] getResumeIndex returning 0 (last run was not partial or index was 0)")
  return 0
}

/**
 * Get accumulated counts from the most recent partial sync log.
 * When resuming, we need to add to these counts rather than starting from 0.
 */
async function getPreviousSyncCounts(supabase: SupabaseClient): Promise<{
  clientsSynced: number
  engagementsSynced: number
  customStatusesSynced: number
}> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("status, clients_synced, engagements_synced, custom_statuses_synced")
    .order("started_at", { ascending: false })
    .limit(1)
    .single()

  if (error || !data || data.status !== "partial") {
    return { clientsSynced: 0, engagementsSynced: 0, customStatusesSynced: 0 }
  }

  return {
    clientsSynced: data.clients_synced ?? 0,
    engagementsSynced: data.engagements_synced ?? 0,
    customStatusesSynced: data.custom_statuses_synced ?? 0,
  }
}

/**
 * Sync all clients from ProConnect
 */
async function syncClients(
  supabase: SupabaseClient
): Promise<{ count: number; errors: string[] }> {
  const fnStart = Date.now()
  console.log("[v0] syncClients start")

  console.log("[v0] syncClients - calling fetchClients API", Date.now() - fnStart, "ms")
  const response = await fetchClients()
  console.log("[v0] syncClients - fetchClients API done", Date.now() - fnStart, "ms")

  if (!response.ok || !response.data) {
    return { count: 0, errors: [response.error || "Failed to fetch clients"] }
  }

  const clients = response.data
  console.log(`[v0] syncClients - got ${clients.length} clients`, Date.now() - fnStart, "ms")

  let count = 0
  const errors: string[] = []

  // Map with mapClientRow — the same mapper runBulkSync uses. The previous
  // per-field extraction called extractClientId() = (c.id || c.clientId ||
  // c.oiiClientId); but in the real ProConnect payload `id` is an object
  // ({ value }), so that returned the object itself, every upsert set
  // proconnect_client_id to an object and failed the write — which is why the
  // logs showed "2001 clients" fetched but "Synced 0 clients". mapClientRow
  // reads oiiClientId / id.value correctly and also populates the client_type
  // / client_state / contact columns the /tax UI and auto-link trigger need.
  //
  // hub_contact_id / hub_organization_id are intentionally omitted (see
  // mapClientRow) so INSERTs are linked by the BEFORE-INSERT trigger and
  // UPDATEs preserve any existing auto_fuzzy / manual mappings.
  const rows = clients.map(mapClientRow).filter((r) => r.proconnect_client_id)
  const skipped = clients.length - rows.length
  if (skipped > 0) {
    errors.push(`${skipped} clients skipped (no resolvable client id)`)
  }

  // Batched upsert — one round trip per 100 rows instead of ~2000 serial
  // writes, which also keeps the (fresh-run) client phase short.
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
    const { error } = await supabase
      .from("proconnect_clients")
      .upsert(batch, { onConflict: "proconnect_client_id" })
    if (error) {
      errors.push(`clients upsert @${i}: ${error.message}`)
    } else {
      count += batch.length
    }
  }

  console.log(`[ProConnect Sync] Synced ${count} clients`)
  return { count, errors }
}

/**
 * Sync engagements for a single client across all tax years.
 * Returns the count and any errors.
 *
 * The tax-year fetches run SEQUENTIALLY (one at a time). Combined with the
 * global ~4 req/s rate limiter in client.ts, this keeps the full import
 * comfortably under ProConnect's confirmed 5 TPS limit. The previous
 * implementation fired all 6 years in parallel (Promise.allSettled), which —
 * multiplied across the concurrent client batch — burst to ~36 simultaneous
 * requests and triggered 429 Too Many Requests.
 */
async function syncClientEngagements(
  supabase: SupabaseClient,
  clientId: string,
  deadline: number
): Promise<{ count: number; errors: string[]; incomplete: boolean }> {
  let count = 0
  const errors: string[] = []

  for (const year of TAX_YEARS) {
    // Checkpoint at year granularity: never START a new ProConnect fetch once
    // we're past the time budget, so a client with many years can't run the
    // invocation past the serverless limit. The caller redoes this client on
    // the next run (upserts are idempotent), so no data is lost.
    if (Date.now() > deadline) {
      return { count, errors, incomplete: true }
    }
    try {
      const r = await syncClientYear(supabase, clientId, year)
      count += r.count
      errors.push(...r.errors)
    } catch (err) {
      errors.push(
        `Client ${clientId}/${year} year fetch rejected: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  return { count, errors, incomplete: false }
}

/**
 * Sync engagements for a single (client, year) pair. Extracted so
 * syncClientEngagements can walk the tax years one at a time. The fetch is
 * wrapped in withRetry so a transient 429/5xx backs off and retries rather
 * than dropping the (client, year) pair from the import.
 */
async function syncClientYear(
  supabase: SupabaseClient,
  clientId: string,
  year: number
): Promise<{ count: number; errors: string[] }> {
  let count = 0
  const errors: string[] = []

  try {
    const response = await withRetry(
      () => fetchEngagements(clientId, year),
      `engagements ${clientId}/${year}`
    )

    if (!response.ok) {
      // 404 is expected if client has no engagements for that year
      if (response.status !== 404) {
        errors.push(`Engagements ${clientId}/${year}: ${response.error}`)
      }
      return { count, errors }
    }

    if (!response.data || response.data.length === 0) {
      return { count, errors }
    }

    for (const engagement of response.data) {
      const eng = engagement as Record<string, unknown>
      const engagementId =
        (eng.id as string) ||
        (eng.engagementId as string) ||
        `${clientId}-${year}`

      // CRITICAL: Use the engagement's actual clientId from the API response,
      // NOT the clientId we queried with. ProConnect returns engagements that
      // may belong to different clients than the one we queried.
      const actualClientId = (eng.clientId as string) || clientId

      // Extract form type from raw API response
      const formType = (eng.type as string) || null
      const returnType = formType

      const { error } = await supabase.from("proconnect_engagements").upsert(
        {
          engagement_id: engagementId,
          proconnect_client_id: actualClientId,
          tax_year: year,
          return_type: returnType,
          form_type: formType,
          status: (eng.status as string) || null,
          // efile_status is deliberately absent — see mapEngagementRow.
          work_status:
            ((eng.customStatus ?? eng.workStatus) as string) || null,
          raw_json: engagement,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          // Use engagement_id as the conflict key - it's globally unique.
          // The old composite key (proconnect_client_id,tax_year,return_type)
          // was broken because return_type is often null, causing overwrites.
          onConflict: "engagement_id",
        }
      )

      if (error) {
        errors.push(`Engagement ${engagementId}: ${error.message}`)
      } else {
        count++
      }
    }
  } catch (err) {
    errors.push(
      `Engagement ${clientId}/${year}: ${err instanceof Error ? err.message : "Unknown"}`
    )
  }

  return { count, errors }
}

/**
 * Sync engagements for all clients across all tax years.
 * Supports resumable sync - starts from startIndex and tracks progress.
 * Processes clients SEQUENTIALLY (one at a time); each client's tax years
 * are also fetched sequentially. Combined with the global ~4 req/s rate
 * limiter in client.ts this keeps the import under ProConnect's 5 TPS limit.
 * Skips clients synced within SKIP_IF_SYNCED_WITHIN_HOURS unless forceFullSync.
 */
async function syncEngagements(
  supabase: SupabaseClient,
  startTime: number,
  startIndex: number = 0,
  forceFullSync: boolean = false
): Promise<{
  count: number
  errors: string[]
  timedOut: boolean
  lastClientIndex: number
  totalClients: number
  skippedClients: number
}> {
  console.log(
    `[v0] syncEngagements start (index ${startIndex}, forceFullSync=${forceFullSync})`
  )

  // Get all client IDs with their last sync time
  const { data: clients, error: clientError } = await supabase
    .from("proconnect_clients")
    .select("proconnect_client_id, updated_at")
    .order("proconnect_client_id", { ascending: true })

  if (clientError || !clients) {
    return {
      count: 0,
      errors: [clientError?.message || "Failed to get client IDs"],
      timedOut: false,
      lastClientIndex: startIndex,
      totalClients: 0,
      skippedClients: 0,
    }
  }

  // Get the last engagement sync time per client
  const { data: lastSyncs } = await supabase
    .from("proconnect_engagements")
    .select("proconnect_client_id, synced_at")
    .order("synced_at", { ascending: false })

  // Build a map of client_id -> last synced time
  const lastSyncMap = new Map<string, string>()
  for (const row of lastSyncs || []) {
    if (row.proconnect_client_id && !lastSyncMap.has(row.proconnect_client_id)) {
      lastSyncMap.set(row.proconnect_client_id, row.synced_at)
    }
  }

  const cutoffTime = Date.now() - SKIP_IF_SYNCED_WITHIN_HOURS * 60 * 60 * 1000

  let count = 0
  const errors: string[] = []
  let timedOut = false
  let lastClientIndex = startIndex
  let skippedClients = 0

  const deadline = startTime + MAX_EXECUTION_MS

  // Process clients one at a time starting from startIndex. Rate limiting is
  // enforced globally in client.ts (~4 req/s), so there is no client-level
  // concurrency here — that is exactly what was bursting past the 429 limit.
  for (let i = startIndex; i < clients.length; i++) {
    // Check the time budget before starting each client.
    if (Date.now() > deadline) {
      console.log(
        `[v0] Time budget reached before client index ${i}, ${Date.now() - startTime}ms elapsed`
      )
      timedOut = true
      lastClientIndex = i
      break
    }

    const clientId = clients[i].proconnect_client_id
    if (!clientId) {
      lastClientIndex = i + 1
      continue
    }

    // Skip recently synced clients (unless force full sync)
    if (!forceFullSync) {
      const lastSync = lastSyncMap.get(clientId)
      if (lastSync && Date.parse(lastSync) > cutoffTime) {
        skippedClients++
        lastClientIndex = i + 1
        continue
      }
    }

    console.log(
      `[v0] Processing client ${clientId} at index ${i}, ${Date.now() - startTime}ms elapsed`
    )

    const result = await syncClientEngagements(supabase, clientId, deadline)
    count += result.count
    errors.push(...result.errors)

    // Ran out of budget partway through this client's tax years — stop and
    // resume from THIS client next run (leave lastClientIndex = i so it is
    // reprocessed; upserts are idempotent).
    if (result.incomplete) {
      console.log(
        `[v0] Time budget reached during client ${clientId} (index ${i}), ${Date.now() - startTime}ms elapsed`
      )
      timedOut = true
      lastClientIndex = i
      break
    }

    // Update last processed index after each client so a timeout resumes
    // from the next unprocessed client.
    lastClientIndex = i + 1

    console.log(
      `[v0] Client ${clientId} done: ${count} total engagements, ${Date.now() - startTime}ms elapsed`
    )
  }

  // If we processed all clients, reset to 0
  if (lastClientIndex >= clients.length) {
    lastClientIndex = 0
  }

  console.log(
    `[v0] syncEngagements done: ${count} engagements, ${skippedClients} skipped, timedOut=${timedOut}`
  )

  return {
    count,
    errors,
    timedOut,
    lastClientIndex,
    totalClients: clients.length,
    skippedClients,
  }
}

/**
 * Sync custom statuses.
 *
 * Exported as `refreshCustomStatuses` below for the TaxReturnWorkStatus
 * webhook, which — per Intuit PD, 2026-08-24 — fires when the custom status
 * LIST changes, not when a return's status changes.
 */
async function syncCustomStatuses(
  supabase: SupabaseClient
): Promise<{ count: number; errors: string[] }> {
  console.log("[ProConnect Sync] Fetching custom statuses...")

  const response = await fetchCustomStatuses()

  if (!response.ok || !response.data) {
    // Not all ProConnect accounts have custom statuses
    if (response.status === 404) {
      return { count: 0, errors: [] }
    }
    return {
      count: 0,
      errors: [response.error || "Failed to fetch custom statuses"],
    }
  }

  let count = 0
  const errors: string[] = []

  for (const status of response.data) {
    try {
      const s = status as Record<string, unknown>
      const statusId =
        (s.id as string) || (s.statusId as string) || String(Math.random())

      const { error } = await supabase
        .from("proconnect_custom_statuses")
        .upsert(
          {
            status_id: statusId,
            name: (s.name as string) || "Unknown",
            description: (s.description as string) || null,
            color: (s.color as string) || null,
            sort_order: (s.sortOrder as number) || null,
            is_active: (s.isActive as boolean) ?? true,
            raw_json: status,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "status_id" }
        )

      if (error) {
        errors.push(`Status ${statusId}: ${error.message}`)
      } else {
        count++
      }
    } catch (err) {
      errors.push(
        `Status error: ${err instanceof Error ? err.message : "Unknown"}`
      )
    }
  }

  console.log(`[ProConnect Sync] Synced ${count} custom statuses`)
  return { count, errors }
}

// ═══════════════════════════════════════════════════════════════════════════
// Bulk sync (per-year engagement fetch) — the nightly-cron strategy
// ═══════════════════════════════════════════════════════════════════════════

// First tax year ProConnect holds data for this firm.
const FIRST_TAX_YEAR = 2021

function taxYearsThroughCurrent(): number[] {
  const years: number[] = []
  for (let y = FIRST_TAX_YEAR; y <= new Date().getFullYear(); y++) years.push(y)
  return years
}

const UPSERT_BATCH_SIZE = 100

interface RawEngagement {
  engagementId?: string
  id?: string
  clientId?: string
  period?: string
  type?: string
  name?: string
  state?: string
  status?: string
  /**
   * Intuit's field is `customStatus`, NOT `workStatus`. We read the wrong key
   * from the start, so work_status was silently null on every engagement —
   * 923 of 923 as of 2026-08-24, while 702 of them carried a real
   * customStatus. `workStatus` is kept only to tolerate a payload that ever
   * carries it; `customStatus` is the one that exists.
   */
  customStatus?: string
  workStatus?: string
  userDefinedStatus?: string
  assignee?: { profileId?: string; authId?: string }
  createdBy?: { profileId?: string }
  modifiedBy?: { profileId?: string }
  createdDate?: string
  modifiedDate?: string
  taxFiling?: RawTaxFiling
  /** Populated on the single GET only — see pickLatestEsignature. */
  esignature?: { envelopes?: RawEnvelope[] }
}

export interface RawFilingStatus {
  status?: string
  /** Intuit's human label for the same state: "Rejected", "Received by Agency". */
  userMessage?: string
  statusUpdateTimestamp?: string
  confirmationNumber?: string
  errorInfo?: Array<{ errorCode?: string; problemMessage?: string }>
}

export interface RawFiling {
  filingType?: string
  filingLevel?: string
  jurisdiction?: string
  primaryFiling?: boolean
  /**
   * Identifies WHICH filing this is: `{entity}.{jurisdiction}[.{kind}]` —
   * `ind.us` is the 1040 itself, `ind.us.ext` the 4868, `ind.us.amd` the
   * 1040-X, `ind.us.fbar` FinCEN 114. Present on 100% of live filings
   * (2,383 of 2,383, 2026-08-11) and agrees with `filingType` everywhere
   * it overlaps, so ./efile-lock reads both and takes the stricter answer.
   */
  filingKey?: { filingId?: string; instance?: string }
  filingStatuses?: RawFilingStatus[]
  /** Nested filings — an extension hangs off the return it extends. */
  children?: RawFiling[]
}

export interface RawTaxFiling {
  filings?: RawFiling[]
  derivedStatus?: string | null
}

/** The chosen status, flattened with the context needed to render it. */
export interface EfileLatest {
  status: string | null
  userMessage: string | null
  filingType: string | null
  filingLevel: string | null
  jurisdiction: string | null
  primaryFiling: boolean
  statusUpdateTimestamp: string | null
  confirmationNumber: string | null
  errorCodes: string[]
  /** taxFiling.derivedStatus — Intuit's own rollup. Null in every sample so far. */
  derivedStatus: string | null
}

/** Depth-first flatten of filings[] including nested children[]. */
export function flattenFilings(filings: RawFiling[] | undefined): RawFiling[] {
  const out: RawFiling[] = []
  for (const f of filings || []) {
    out.push(f)
    if (f.children?.length) out.push(...flattenFilings(f.children))
  }
  return out
}

/**
 * How much a filing's status deserves to be THE headline status for the
 * engagement. A return's own federal filing outranks its extension, which
 * outranks a state filing — otherwise a rejected extension transmitted after
 * an accepted return would present as "the return was rejected".
 */
function filingRank(f: RawFiling): number {
  return (
    (f.filingType === "REGULAR" ? 4 : 0) +
    (f.filingLevel === "flFederal" ? 2 : 0) +
    (f.primaryFiling ? 1 : 0)
  )
}

/**
 * The CURRENT status of one filing: the entry with the newest
 * `statusUpdateTimestamp`. Never `filingStatuses.at(-1)` — the history is
 * append-only but arrives unordered (1,505 of 2,383 live filings are not in
 * chronological array order, measured 2026-08-11).
 */
export function latestStatusOf(f: RawFiling): RawFilingStatus | null {
  let latest: RawFilingStatus | null = null
  let latestDate = -Infinity
  for (const s of f.filingStatuses || []) {
    const t = s.statusUpdateTimestamp
      ? new Date(s.statusUpdateTimestamp).getTime()
      : Number.NaN
    if (Number.isNaN(t)) {
      // Undated status: better than nothing, but never beats a dated one.
      latest = latest ?? s
      continue
    }
    if (t > latestDate) {
      latestDate = t
      latest = s
    }
  }
  return latest
}

/**
 * Pick the one filing status that best represents this engagement's e-file
 * state, and return it with its context.
 *
 * Only ever call this on a SINGLE-engagement GET payload. The list endpoints
 * return `filings: []` on every engagement, so on a list row this yields null
 * for reasons that have nothing to do with whether the return was filed.
 *
 * Two shapes in the live data drove this:
 *
 *   - Filings nest. A 1120 came back with a primary REGULAR federal filing
 *     whose `filingStatuses` was EMPTY, and an EXTENSION child carrying the
 *     real history. A non-recursive walk reports "no e-file activity" on a
 *     return that has been transmitted three times.
 *   - Status history is append-only and unordered. The same filing held
 *     PENDING_EFE → PENDING_AGENCY → ACK_REJECTED three times over, so
 *     "latest by statusUpdateTimestamp" is the only correct read; array
 *     position is not chronological.
 *
 * Filings with no statuses at all are skipped rather than ranked, so a
 * pristine REGULAR filing doesn't outrank an extension that actually has
 * news. When the winner isn't the return's own federal filing, `filingType`
 * / `jurisdiction` on the result say so.
 */
/** esignature.envelopes[] as returned by GET /v2/engagements/{id}. */
interface RawEnvelopeStatus {
  status?: string
  statusUpdateTimestamp?: string
}
interface RawEnvelope {
  envelopeId?: string
  statuses?: RawEnvelopeStatus[]
}

/**
 * Latest e-signature status across every envelope on a return.
 *
 * Empty on the LIST endpoint and populated on the single GET — the same
 * trap taxFiling.filings[] set, and confirmed the same way on 2026-08-24:
 * 12 of 15 sampled engagements carry envelopes (scripts/402).
 *
 * Like filingStatuses, the status history is append-only and arrives
 * UNORDERED, so the latest is chosen by timestamp and never by array
 * position. Envelopes with no statuses at all are counted but contribute
 * no status, mirroring how filings with zero statuses are handled.
 */
function pickLatestEsignature(
  esignature: { envelopes?: RawEnvelope[] } | null | undefined
): { status: string | null; count: number } {
  const envelopes = esignature?.envelopes ?? []
  let bestAt = ""
  let bestStatus: string | null = null
  for (const env of envelopes) {
    for (const st of env.statuses ?? []) {
      if (!st.status) continue
      const at = st.statusUpdateTimestamp ?? ""
      if (bestStatus === null || at > bestAt) {
        bestAt = at
        bestStatus = st.status
      }
    }
  }
  return { status: bestStatus, count: envelopes.length }
}

function pickLatestEfile(taxFiling: RawTaxFiling | null | undefined): EfileLatest | null {
  const candidates = flattenFilings(taxFiling?.filings).filter(
    (f) => (f.filingStatuses?.length ?? 0) > 0
  )
  if (candidates.length === 0) return null

  let best: { filing: RawFiling; status: RawFilingStatus } | null = null
  for (const filing of candidates) {
    const status = latestStatusOf(filing)
    if (!status) continue
    if (!best) {
      best = { filing, status }
      continue
    }
    const rankDelta = filingRank(filing) - filingRank(best.filing)
    if (rankDelta > 0) {
      best = { filing, status }
    } else if (rankDelta === 0) {
      const a = status.statusUpdateTimestamp
        ? new Date(status.statusUpdateTimestamp).getTime()
        : -Infinity
      const b = best.status.statusUpdateTimestamp
        ? new Date(best.status.statusUpdateTimestamp).getTime()
        : -Infinity
      if (a > b) best = { filing, status }
    }
  }
  if (!best) return null

  return {
    status: best.status.status ?? null,
    userMessage: best.status.userMessage ?? null,
    filingType: best.filing.filingType ?? null,
    filingLevel: best.filing.filingLevel ?? null,
    jurisdiction: best.filing.jurisdiction ?? null,
    primaryFiling: best.filing.primaryFiling === true,
    statusUpdateTimestamp: best.status.statusUpdateTimestamp ?? null,
    confirmationNumber: best.status.confirmationNumber ?? null,
    errorCodes: (best.status.errorInfo || [])
      .map((e) => e.errorCode)
      .filter((c): c is string => !!c),
    derivedStatus: taxFiling?.derivedStatus ?? null,
  }
}

/**
 * Map a row from the engagement LIST endpoint to a DB row.
 *
 * The four efile_* columns (`efile_status`, `efile_latest`, `efile_filings`,
 * `efile_synced_at`) are deliberately absent from the returned object, and
 * must stay absent: the list endpoint
 * carries no filings, so writing them here would null out whatever the
 * hydrator (hydrateEngagementEfile) last read from the single-engagement
 * GET — every night, silently. PostgREST only SETs the columns present in
 * the request body, so omitting the keys leaves those values alone.
 *
 * Omit them from EVERY row in a batch or none: PostgREST unions the keys
 * across a batch and null-fills the rows that lack them, so a conditional
 * "include it only when non-null" would clobber exactly the rows it was
 * trying to protect.
 */
function mapEngagementRow(raw: unknown, fallbackYear: number) {
  const eng = raw as RawEngagement
  const now = new Date().toISOString()
  const period = eng.period ? Number.parseInt(eng.period, 10) : NaN
  return {
    engagement_id: eng.engagementId || eng.id || null,
    proconnect_client_id: eng.clientId || null,
    tax_year: Number.isFinite(period) ? period : fallbackYear,
    return_type: eng.type ?? null,
    form_type: eng.type ?? null,
    engagement_name: eng.name ?? null,
    engagement_state: eng.state ?? null,
    status: eng.status ?? null,
    work_status: eng.customStatus ?? eng.workStatus ?? null,
    user_defined_status_id: eng.userDefinedStatus ?? null,
    assignee_profile_id: eng.assignee?.profileId ?? null,
    assignee_auth_id: eng.assignee?.authId ?? null,
    created_by_profile_id: eng.createdBy?.profileId ?? null,
    modified_by_profile_id: eng.modifiedBy?.profileId ?? null,
    proconnect_created_at: eng.createdDate ?? null,
    proconnect_modified_at: eng.modifiedDate ?? null,
    raw_json: raw,
    synced_at: now,
    updated_at: now,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// E-file status hydration (single-engagement GET)
// ═══════════════════════════════════════════════════════════════════════════

// Ceiling on how many engagements one hydration pass will fetch.
const EFILE_HYDRATE_MAX =
  Number(process.env.PROCONNECT_EFILE_HYDRATE_MAX) || 500

// Wall-clock stop for a hydration pass, checked between engagements. This is
// the cap that actually binds: measured end-to-end cost is ~0.7s per
// engagement (250ms rate-limit slot + a token lookup + the API call + the
// row update), not the 250ms the throttle alone implies, so 150s buys ~200
// engagements rather than 500. Sized to leave the 300s cron plenty of room
// after the bulk sync, since anything not reached simply stays queued.
const EFILE_HYDRATE_BUDGET_MS =
  Number(process.env.PROCONNECT_EFILE_HYDRATE_BUDGET_MS) || 150_000

export interface EfileHydrateResult {
  ok: boolean
  /** True when the engagement came back with at least one filing. */
  hasFilings: boolean
  status: string | null
  latest: EfileLatest | null
  /**
   * The verbatim `taxFiling` payload, set whenever the GET itself succeeded
   * — including when the DB write afterwards did not. Callers that need to
   * reason about ALL filings rather than the single headline status (the
   * post-e-file edit lock, ./efile-lock) read this; `fetchedOk` says whether
   * it is trustworthy, since a null here is otherwise ambiguous between
   * "nothing filed" and "we never got an answer".
   */
  taxFiling?: RawTaxFiling | null
  /** True when GET /v2/engagements/{id} returned a payload we could read. */
  fetchedOk: boolean
  /** True when no proconnect_engagements row matched the id. */
  missingRow?: boolean
  /** True when ProConnect no longer has this engagement (404). */
  notFound?: boolean
  error?: string
}

/**
 * Read one engagement's e-file status from GET /v2/engagements/{id} and
 * write it to its existing proconnect_engagements row.
 *
 * UPDATE, not upsert, on purpose: the row is created by the engagement list
 * sync, which owns every other column. If the row isn't there yet (a webhook
 * that beat the nightly sync), we report missingRow and let the list sync
 * create it — the stale-row query will hydrate it on the next pass.
 *
 * An engagement with no filings writes efile_status = NULL and still stamps
 * efile_synced_at. That is the point: "we looked, nothing is filed" has to be
 * distinguishable from "we never looked", or every unfiled return stays in the
 * stale set forever and the hydrator never drains it.
 */
export async function hydrateEngagementEfile(
  engagementId: string,
  supabase?: SupabaseClient
): Promise<EfileHydrateResult> {
  const sb = supabase ?? getSupabaseAdmin()

  const resp = await withRetry(
    () => fetchEngagement(engagementId),
    `engagement ${engagementId}`
  )
  if (!resp.ok || !resp.data) {
    // 404 = ProConnect doesn't have this engagement any more (deleted there,
    // still in our table). Stamp efile_synced_at so it leaves the stale queue
    // instead of being retried nightly forever — a permanently non-zero
    // "still stale" count is a signal people learn to ignore. Deliberately
    // does NOT clear efile_status / efile_filings: the last known filing
    // state is the most useful thing we have about a return that's gone.
    if (resp.status === 404) {
      await sb
        .from("proconnect_engagements")
        .update({ efile_synced_at: new Date().toISOString() })
        .eq("engagement_id", engagementId)
      return {
        ok: false,
        hasFilings: false,
        status: null,
        latest: null,
        fetchedOk: false,
        notFound: true,
        error: resp.error || "404 not found in ProConnect",
      }
    }
    return {
      ok: false,
      hasFilings: false,
      status: null,
      latest: null,
      fetchedOk: false,
      error: resp.error || `fetch failed (${resp.status})`,
    }
  }

  const eng = resp.data as RawEngagement
  const taxFiling = eng.taxFiling ?? null
  const hasFilings = (taxFiling?.filings?.length ?? 0) > 0
  const latest = pickLatestEfile(taxFiling)
  const esign = pickLatestEsignature(eng.esignature)
  const now = new Date().toISOString()

  const { data, error } = await sb
    .from("proconnect_engagements")
    .update({
      efile_status: latest?.status ?? null,
      efile_latest: latest,
      efile_filings: taxFiling,
      efile_synced_at: now,
      // Free: the envelopes ride in on the SAME fetchEngagement() response
      // the e-file status came from. No extra call, no extra rate-limit
      // pressure. See scripts/405.
      esignature_envelopes: eng.esignature?.envelopes ?? null,
      esignature_status: esign.status,
      esignature_count: esign.count,
      updated_at: now,
    })
    .eq("engagement_id", engagementId)
    .select("engagement_id")

  const status = latest?.status ?? null
  // fetchedOk / taxFiling are set on every branch below: the GET already
  // succeeded, so the filings are usable even when the DB write is not.
  if (error) {
    return {
      ok: false,
      hasFilings,
      status,
      latest,
      taxFiling,
      fetchedOk: true,
      error: error.message,
    }
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      hasFilings,
      status,
      latest,
      taxFiling,
      fetchedOk: true,
      missingRow: true,
    }
  }

  return { ok: true, hasFilings, status, latest, taxFiling, fetchedOk: true }
}

/**
 * Hydrate e-file status for engagements that need it: never hydrated, or
 * modified in ProConnect since we last read their filings. Most recent tax
 * year first, so filing-season returns win any budget contention.
 *
 * Bounded by both a count cap and a wall-clock budget, and reports what it
 * left behind — a pass that silently stops short reads as "everything is
 * hydrated" when the coverage numbers are actually stale. Whatever is left
 * over is picked up by the next run; the stale set is a queue, not a
 * snapshot, so partial progress is always safe.
 */
export async function hydrateStaleEfileStatuses(
  supabase?: SupabaseClient,
  opts: { limit?: number; budgetMs?: number } = {}
): Promise<{
  attempted: number
  hydrated: number
  /** Of those hydrated, how many resolved to an actual filing status. */
  withStatus: number
  skippedMissingRow: number
  /** Engagements ProConnect 404s — gone there, still in our table. */
  goneFromProConnect: number
  remaining: number
  errors: string[]
}> {
  const sb = supabase ?? getSupabaseAdmin()
  const limit = opts.limit ?? EFILE_HYDRATE_MAX
  const budgetMs = opts.budgetMs ?? EFILE_HYDRATE_BUDGET_MS
  const startedAt = Date.now()
  const errors: string[] = []

  const { data: stale, error: staleErr, count } = await sb
    .from("proconnect_engagements_efile_stale")
    .select("engagement_id", { count: "exact" })
    .order("tax_year", { ascending: false })
    .order("proconnect_modified_at", { ascending: false, nullsFirst: false })
    .limit(limit)

  if (staleErr) {
    return {
      attempted: 0,
      hydrated: 0,
      withStatus: 0,
      skippedMissingRow: 0,
      goneFromProConnect: 0,
      remaining: 0,
      errors: [`stale e-file query failed: ${staleErr.message}`],
    }
  }

  const queue = (stale || []).map((r) => r.engagement_id as string).filter(Boolean)
  const total = count ?? queue.length

  let attempted = 0
  let hydrated = 0
  let withStatus = 0
  let skippedMissingRow = 0
  let goneFromProConnect = 0

  for (const engagementId of queue) {
    if (Date.now() - startedAt > budgetMs) break
    attempted++
    const result = await hydrateEngagementEfile(engagementId, sb)
    if (result.ok) {
      hydrated++
      if (result.status) withStatus++
    } else if (result.notFound) {
      goneFromProConnect++
    } else if (result.missingRow) {
      skippedMissingRow++
    } else if (errors.length < 20) {
      errors.push(`e-file ${engagementId}: ${result.error}`)
    }
  }

  return {
    attempted,
    hydrated,
    withStatus,
    skippedMissingRow,
    goneFromProConnect,
    // Everything still stale after this pass: the queue we didn't get to,
    // plus anything beyond `limit` that we never selected. 404s count as
    // drained — they were stamped, so they've left the queue for good.
    remaining: Math.max(0, total - hydrated - goneFromProConnect),
    errors,
  }
}

interface RawClient {
  oiiClientId?: string
  id?: { value?: string } | string
  clientState?: string
  person?: RawClientEntity
  organization?: RawClientEntity
}

interface RawClientEntity {
  taxId?: string
  names?: Array<{ firstName?: string; lastName?: string; name?: string }>
  emailAddresses?: Array<{ address?: string; properties?: { isPrimary?: string } }>
  phoneNumbers?: Array<{ number?: string; properties?: { isPrimary?: string } }>
  physicalAddresses?: Array<{
    city?: string
    stateOrProvince?: string
    postalCode?: string
    properties?: { isPrimary?: string }
  }>
}

function getPrimary<T extends { properties?: { isPrimary?: string } }>(
  items: T[] | undefined
): T | undefined {
  if (!items || items.length === 0) return undefined
  return items.find((i) => i.properties?.isPrimary === "true") || items[0]
}

/**
 * Map a raw /v1/clients entry to a proconnect_clients row, including the
 * fields the auto-link trigger and the /tax UI depend on (client_type,
 * client_state, contact info). hub_contact_id / hub_organization_id are
 * intentionally omitted — see syncClients() for the rationale.
 */
export function mapClientRow(raw: unknown) {
  const client = raw as RawClient
  const names = extractClientName(raw)
  const contactSource = client.person || client.organization
  const primaryEmail = getPrimary(contactSource?.emailAddresses)
  const primaryPhone = getPrimary(contactSource?.phoneNumbers)
  const primaryAddress = getPrimary(contactSource?.physicalAddresses)
  const now = new Date().toISOString()

  return {
    proconnect_client_id:
      client.oiiClientId ||
      (typeof client.id === "string" ? client.id : client.id?.value) ||
      null,
    top_level_entity_id:
      typeof client.id === "object" ? (client.id?.value ?? null) : null,
    client_type: client.person
      ? "PERSON"
      : client.organization
        ? "ORGANIZATION"
        : null,
    client_state: client.clientState ?? null,
    first_name: names.firstName,
    last_name: names.lastName,
    business_name: names.businessName,
    display_name: names.displayName,
    name_for_matching: names.displayName?.toLowerCase() ?? null,
    email: primaryEmail?.address || extractClientEmail(raw),
    phone: primaryPhone?.number ?? null,
    city: primaryAddress?.city ?? null,
    state: primaryAddress?.stateOrProvince ?? null,
    zip: primaryAddress?.postalCode ?? null,
    tax_id: client.person?.taxId || client.organization?.taxId || null,
    raw_json: raw,
    synced_at: now,
    updated_at: now,
  }
}

/** Does a raw /v1/clients entry match a webhook entity id? */
function clientMatchesId(raw: unknown, targetId: string): boolean {
  const client = raw as RawClient
  const topLevelId =
    typeof client.id === "string" ? client.id : client.id?.value
  return client.oiiClientId === targetId || topLevelId === targetId
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Retry a ProConnect fetch on 429/5xx with exponential backoff. The
 * apiRequest layer surfaces those as ok=false with a status code.
 */
async function withRetry<T>(
  fn: () => Promise<{ ok: boolean; status: number; data: T | null; error: string | null }>,
  label: string,
  retries = 4
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  let last: { ok: boolean; status: number; data: T | null; error: string | null } = {
    ok: false,
    status: 0,
    data: null,
    error: "not attempted",
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    last = await fn()
    if (last.ok || (last.status !== 429 && last.status < 500)) return last
    const backoff = 800 * Math.pow(2, attempt)
    console.log(`[ProConnect Sync] ${label}: ${last.status} — retrying in ${backoff}ms`)
    await sleep(backoff)
  }
  return last
}

/**
 * Bulk sync: clients (1 call) → engagements (1 call per tax year) →
 * custom statuses (1 call) → e-file hydration (1 call per stale
 * engagement, capped). The first three steps are ~8 calls total instead
 * of the legacy per-client loop's ~12,000. The fourth is per-engagement
 * by necessity — e-file status exists only on the single-engagement GET —
 * so it is bounded by count and wall clock and resumes across runs rather
 * than trying to finish in one invocation. This is what the nightly cron
 * runs.
 */
export async function runBulkSync(
  syncType: "full" | "manual" = "full"
): Promise<SyncResult> {
  const startTime = Date.now()
  const supabase = getSupabaseAdmin()
  const errors: string[] = []
  const syncLogId = await createSyncLog(supabase, syncType)

  let clientsSynced = 0
  let engagementsSynced = 0
  let customStatusesSynced = 0

  try {
    // ── 1. Clients ─────────────────────────────────────────────────────
    const clientsResp = await withRetry(() => fetchClients(), "clients")
    if (!clientsResp.ok || !clientsResp.data) {
      errors.push(`clients fetch failed: ${clientsResp.error}`)
    } else {
      const rows = clientsResp.data
        .map(mapClientRow)
        .filter((r) => r.proconnect_client_id)
      for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
        const { error } = await supabase
          .from("proconnect_clients")
          .upsert(batch, { onConflict: "proconnect_client_id" })
        if (error) {
          errors.push(`clients upsert @${i}: ${error.message}`)
        } else {
          clientsSynced += batch.length
        }
      }
    }

    // ── 2. Engagements, one bulk call per tax year ─────────────────────
    for (const year of taxYearsThroughCurrent()) {
      const resp = await withRetry(
        () => fetchAllEngagementsForYear(year),
        `engagements ${year}`
      )
      if (!resp.ok || !resp.data) {
        // 404 just means no engagements exist for that year
        if (resp.status !== 404) {
          errors.push(`engagements ${year} fetch failed: ${resp.error}`)
        }
        continue
      }
      const rows = resp.data
        .map((raw) => mapEngagementRow(raw, year))
        .filter((r) => r.engagement_id && r.proconnect_client_id)
      for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
        const { error } = await supabase
          .from("proconnect_engagements")
          .upsert(batch, { onConflict: "engagement_id" })
        if (error) {
          errors.push(`engagements ${year} upsert @${i}: ${error.message}`)
        } else {
          engagementsSynced += batch.length
        }
      }
    }

    // ── 3. Custom statuses ─────────────────────────────────────────────
    const statusResult = await syncCustomStatuses(supabase)
    customStatusesSynced = statusResult.count
    errors.push(...statusResult.errors)

    // ── 4. E-file status, one call per stale engagement ────────────────
    // Steps 1–3 are ~8 calls total. This step is one call per engagement,
    // because the list endpoint doesn't carry filings — so it runs last,
    // capped, on whatever budget is left. Webhooks handle the in-season hot
    // path (see processTaxReturnEvent); this catches missed events and drains
    // the never-hydrated backlog a few hundred engagements per night.
    const efileResult = await hydrateStaleEfileStatuses(supabase, {
      budgetMs: Math.max(
        0,
        EFILE_HYDRATE_BUDGET_MS - (Date.now() - startTime)
      ),
    })
    errors.push(...efileResult.errors)
    if (efileResult.remaining > 0) {
      console.log(
        `[ProConnect Sync] e-file: hydrated ${efileResult.hydrated} (${efileResult.withStatus} with a filing status), ${efileResult.remaining} still stale — next run continues`
      )
    }

    const success = errors.length === 0
    const efileSummary =
      `${efileResult.hydrated} e-file hydrated (${efileResult.withStatus} with status, ${efileResult.remaining} stale)` +
      (efileResult.goneFromProConnect > 0
        ? `, ${efileResult.goneFromProConnect} gone from PTO`
        : "")
    await updateSyncLog(supabase, syncLogId, {
      status: success ? "success" : "failed",
      clients_synced: clientsSynced,
      engagements_synced: engagementsSynced,
      custom_statuses_synced: customStatusesSynced,
      last_client_index: 0,
      error_message: success
        ? `Bulk sync: ${clientsSynced} clients, ${engagementsSynced} engagements, ${efileSummary} in ${Math.round((Date.now() - startTime) / 1000)}s`
        : `${errors.length} errors occurred`,
      error_details: success ? null : { errors: errors.slice(0, 50) },
    })

    return {
      success,
      syncLogId,
      clientsSynced,
      engagementsSynced,
      customStatusesSynced,
      efileHydrated: efileResult.hydrated,
      efileStaleRemaining: efileResult.remaining,
      errors,
      duration: Date.now() - startTime,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    errors.push(msg)
    await updateSyncLog(supabase, syncLogId, {
      status: "failed",
      clients_synced: clientsSynced,
      engagements_synced: engagementsSynced,
      custom_statuses_synced: customStatusesSynced,
      last_client_index: 0,
      error_message: msg,
      error_details: { errors: errors.slice(0, 50), stack: err instanceof Error ? err.stack : null },
    })
    return {
      success: false,
      syncLogId,
      clientsSynced,
      engagementsSynced,
      customStatusesSynced,
      errors,
      duration: Date.now() - startTime,
    }
  }
}

/**
 * Run the full sync with timeout awareness and resumable progress.
 * If a previous run was partial, this will resume from where it left off.
 */
export async function runFullSync(
  syncType: "full" | "manual" | "webhook" = "full"
): Promise<SyncResult> {
  const startTime = Date.now()
  console.log("[v0] Sync started at", startTime)

  const supabase = getSupabaseAdmin()
  const errors: string[] = []
  let timedOut = false

  // Check if we should resume from a previous partial run
  console.log("[v0] Step 1 start - getResumeIndex", Date.now() - startTime, "ms elapsed")
  const resumeIndex = await getResumeIndex(supabase)
  console.log("[v0] Step 1 done - getResumeIndex", Date.now() - startTime, "ms elapsed, resumeIndex:", resumeIndex)

  const isResuming = resumeIndex > 0

  // When resuming, load the previous run's accumulated counts so we can add to them
  let previousCounts = { clientsSynced: 0, engagementsSynced: 0, customStatusesSynced: 0 }
  if (isResuming) {
    console.log(`[ProConnect Sync] Resuming from client index ${resumeIndex}`)
    previousCounts = await getPreviousSyncCounts(supabase)
    console.log("[v0] Previous counts loaded:", previousCounts)
  }

  // Create sync log
  console.log("[v0] Step 2 start - createSyncLog", Date.now() - startTime, "ms elapsed")
  const syncLogId = await createSyncLog(supabase, syncType)
  console.log("[v0] Step 2 done - createSyncLog", Date.now() - startTime, "ms elapsed")

  // Track results outside try block so catch can access them for partial progress reporting
  let clientResult = { count: 0, errors: [] as string[] }
  let engagementResult = { count: 0, errors: [] as string[], timedOut: false, lastClientIndex: 0, totalClients: 0, skippedClients: 0 }
  let statusResult = { count: 0, errors: [] as string[] }

  try {
    // 1. Sync clients (only on fresh runs, not resumes)
    if (!isResuming) {
      console.log("[v0] Step 3 start - syncClients", Date.now() - startTime, "ms elapsed")
      clientResult = await syncClients(supabase)
      console.log("[v0] Step 3 done - syncClients", Date.now() - startTime, "ms elapsed, count:", clientResult.count)
      errors.push(...clientResult.errors)

      // Check timeout after clients
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        timedOut = true
        throw new Error("Timeout after syncing clients")
      }
    }

    // 2. Sync engagements (this is the slow part - resumable, parallel, skip recent)
    // Force full sync on manual runs; incremental on cron/webhook
    const forceFullSync = syncType === "manual"
    console.log("[v0] Step 4 start - syncEngagements", Date.now() - startTime, "ms elapsed")
    engagementResult = await syncEngagements(supabase, startTime, resumeIndex, forceFullSync)
    console.log("[v0] Step 4 done - syncEngagements", Date.now() - startTime, "ms elapsed, count:", engagementResult.count, "skipped:", engagementResult.skippedClients)
    errors.push(...engagementResult.errors)
    timedOut = engagementResult.timedOut

    // Determine if this was a partial or complete run
    const isPartial = timedOut && engagementResult.lastClientIndex > 0
    const isComplete = engagementResult.lastClientIndex === 0 && !timedOut

    // 3. Sync custom statuses (only if we completed all clients and have time)
    if (isComplete && Date.now() - startTime < MAX_EXECUTION_MS) {
      statusResult = await syncCustomStatuses(supabase)
      errors.push(...statusResult.errors)
    }

    const success = isComplete && errors.length === 0

    // Determine status
    let status: string
    if (isPartial) {
      status = "partial"
    } else if (success) {
      status = "success"
    } else {
      status = "failed"
    }

    // Accumulate counts from previous partial runs when resuming
    const totalClientsSynced = previousCounts.clientsSynced + clientResult.count
    const totalEngagementsSynced = previousCounts.engagementsSynced + engagementResult.count
    const totalStatusesSynced = previousCounts.customStatusesSynced + statusResult.count

    // Update sync log
    await updateSyncLog(supabase, syncLogId, {
      status,
      clients_synced: totalClientsSynced,
      engagements_synced: totalEngagementsSynced,
      custom_statuses_synced: totalStatusesSynced,
      last_client_index: engagementResult.lastClientIndex,
      error_message: isPartial
        ? `Partial sync: processed ${engagementResult.lastClientIndex}/${engagementResult.totalClients} clients (${engagementResult.skippedClients} skipped) in ${Math.round((Date.now() - startTime) / 1000)}s`
        : success
          ? `Synced ${totalEngagementsSynced} engagements (${engagementResult.skippedClients} clients skipped - already synced)`
          : `${errors.length} errors occurred`,
      error_details: isPartial
        ? {
            partial: true,
            lastClientIndex: engagementResult.lastClientIndex,
            totalClients: engagementResult.totalClients,
            skippedClients: engagementResult.skippedClients,
            errors: errors.slice(0, 20),
          }
        : success
          ? { skippedClients: engagementResult.skippedClients }
          : { errors: errors.slice(0, 50) },
    })

    return {
      success,
      syncLogId,
      clientsSynced: totalClientsSynced,
      engagementsSynced: totalEngagementsSynced,
      customStatusesSynced: totalStatusesSynced,
      errors,
      duration: Date.now() - startTime,
      timedOut,
      partial: isPartial,
      lastClientIndex: engagementResult.lastClientIndex,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"

    // Check if this was a timeout - treat as partial, not failed
    const isTimeoutError =
      timedOut ||
      errorMessage.toLowerCase().includes("timeout") ||
      errorMessage.toLowerCase().includes("timed out")

    if (isTimeoutError) {
      // Timeout should be partial, not failed - so it doesn't trigger 3-strike alerts
      // Accumulate counts from previous partial runs when resuming
      const totalClientsSynced = previousCounts.clientsSynced + clientResult.count
      const totalEngagementsSynced = previousCounts.engagementsSynced + engagementResult.count
      const totalStatusesSynced = previousCounts.customStatusesSynced + statusResult.count

      await updateSyncLog(supabase, syncLogId, {
        status: "partial",
        clients_synced: totalClientsSynced,
        engagements_synced: totalEngagementsSynced,
        custom_statuses_synced: totalStatusesSynced,
        last_client_index: engagementResult.lastClientIndex || resumeIndex || 1, // Save progress for resume
        error_message: `Partial sync: timed out after ${Math.round((Date.now() - startTime) / 1000)}s - will resume on next run`,
        error_details: {
          partial: true,
          timedOut: true,
          resumeIndex: engagementResult.lastClientIndex || resumeIndex,
          clientsSynced: totalClientsSynced,
          engagementsSynced: totalEngagementsSynced,
          stack: err instanceof Error ? err.stack : null,
        },
      })

      return {
        success: false,
        syncLogId,
        clientsSynced: totalClientsSynced,
        engagementsSynced: totalEngagementsSynced,
        customStatusesSynced: totalStatusesSynced,
        errors: [errorMessage],
        duration: Date.now() - startTime,
        timedOut: true,
        partial: true,
        lastClientIndex: engagementResult.lastClientIndex || resumeIndex,
      }
    }

    // Actual failure (not timeout) - still accumulate counts
    const totalClientsSynced = previousCounts.clientsSynced + clientResult.count
    const totalEngagementsSynced = previousCounts.engagementsSynced + engagementResult.count
    const totalStatusesSynced = previousCounts.customStatusesSynced + statusResult.count

    await updateSyncLog(supabase, syncLogId, {
      status: "failed",
      clients_synced: totalClientsSynced,
      engagements_synced: totalEngagementsSynced,
      custom_statuses_synced: totalStatusesSynced,
      last_client_index: engagementResult.lastClientIndex || resumeIndex, // Preserve resume point on failure
      error_message: errorMessage,
      error_details: { 
        stack: err instanceof Error ? err.stack : null,
        timedOut: false,
        resumeIndex: engagementResult.lastClientIndex || resumeIndex,
        clientsSynced: totalClientsSynced,
        engagementsSynced: totalEngagementsSynced,
      },
    })

    return {
      success: false,
      syncLogId,
      clientsSynced: totalClientsSynced,
      engagementsSynced: totalEngagementsSynced,
      customStatusesSynced: totalStatusesSynced,
      errors: [errorMessage],
      duration: Date.now() - startTime,
      timedOut: false,
    }
  }
}

/**
 * Get sync statistics
 */
export async function getSyncStats(): Promise<{
  lastSync: SyncLog | null
  consecutiveFailures: number
  totalClients: number
  totalEngagements: number
}> {
  const supabase = getSupabaseAdmin()

  const [lastSyncResult, clientsResult, engagementsResult] = await Promise.all([
    supabase
      .from("proconnect_sync_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("proconnect_clients")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("proconnect_engagements")
      .select("id", { count: "exact", head: true }),
  ])

  const consecutiveFailures = await getConsecutiveFailureCount(supabase)

  return {
    lastSync: lastSyncResult.data as SyncLog | null,
    consecutiveFailures,
    totalClients: clientsResult.count || 0,
    totalEngagements: engagementsResult.count || 0,
  }
}

/**
 * Fetch the full client list once so a webhook batch with many Client
 * entities doesn't hit /v1/clients once per entity (that's what caused
 * the 429 bursts). Returns null on failure.
 */
export async function prefetchClientList(): Promise<unknown[] | null> {
  const response = await withRetry(() => fetchClients(), "clients (webhook prefetch)")
  return response.ok && response.data ? response.data : null
}

/**
 * Sync a single client (for webhook updates).
 *
 * ProConnect has no single-client GET (`/v1/clients/{id}` 404s), so we
 * pull the full list and filter by id. Pass `prefetchedClients` when
 * processing several Client events in one webhook delivery.
 */
export async function syncSingleClient(
  proconnectClientId: string,
  prefetchedClients?: unknown[] | null
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()

  try {
    let clients = prefetchedClients ?? null
    if (!clients) {
      clients = await prefetchClientList()
      if (!clients) {
        return { success: false, error: "Failed to fetch client list" }
      }
    }

    const client = clients.find((c) => clientMatchesId(c, proconnectClientId))
    if (!client) {
      // The client isn't in the active /v1/clients list — it was archived
      // or deleted in ProConnect (which still emits Update events for it),
      // or it's an id we don't sync. This is an expected steady state, not
      // a fault: there's nothing to apply and retrying can't help, so we
      // report it as *skipped* rather than failed. The nightly bulk sync
      // remains the safety net if it ever reappears.
      return {
        success: true,
        skipped: true,
        error: `Client ${proconnectClientId} is not in the active ProConnect client list (likely archived or deleted). Nothing to sync.`,
      }
    }

    // hub_contact_id / hub_organization_id intentionally omitted from
    // the row (see syncClients / mapClientRow). INSERTs are handled by
    // the BEFORE-INSERT trigger; UPDATEs must preserve any auto_fuzzy /
    // manual mappings.
    const { error } = await supabase
      .from("proconnect_clients")
      .upsert(mapClientRow(client), { onConflict: "proconnect_client_id" })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

/**
 * Refresh all engagements for one (client, year) pair — used by the
 * TaxReturnWorkStatus webhook so status changes land without waiting
 * for the nightly sync. One API call.
 */
/**
 * Re-sync the custom status catalog. One API call.
 *
 * The correct response to a TaxReturnWorkStatus webhook. Intuit's PD
 * confirmed on 2026-08-24 that the event fires only when the custom status
 * *list* is edited — a status added, renamed or removed — NOT when an
 * individual return moves between statuses. The entity id on that event is
 * therefore a status id, never an engagement id.
 */
export async function refreshCustomStatuses(): Promise<{ count: number; errors: string[] }> {
  return syncCustomStatuses(getSupabaseAdmin())
}

export async function refreshClientYearEngagements(
  proconnectClientId: string,
  taxYear: number
): Promise<{ success: boolean; count: number; error?: string }> {
  const supabase = getSupabaseAdmin()

  const resp = await withRetry(
    () => fetchEngagements(proconnectClientId, taxYear),
    `engagements ${proconnectClientId}/${taxYear}`
  )
  if (!resp.ok || !resp.data) {
    if (resp.status === 404) return { success: true, count: 0 }
    return { success: false, count: 0, error: resp.error || "fetch failed" }
  }

  // The engagement endpoint can return engagements belonging to other
  // clients — trust each row's own clientId (mapEngagementRow does).
  const rows = resp.data
    .map((raw) => mapEngagementRow(raw, taxYear))
    .filter((r) => r.engagement_id && r.proconnect_client_id)

  if (rows.length === 0) return { success: true, count: 0 }

  const { error } = await supabase
    .from("proconnect_engagements")
    .upsert(rows, { onConflict: "engagement_id" })

  if (error) return { success: false, count: 0, error: error.message }
  return { success: true, count: rows.length }
}

/**
 * Delete a client (for webhook deletes)
 */
export async function deleteClient(
  proconnectClientId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()

  try {
    // Delete engagements first
    await supabase
      .from("proconnect_engagements")
      .delete()
      .eq("proconnect_client_id", proconnectClientId)

    // Delete client
    const { error } = await supabase
      .from("proconnect_clients")
      .delete()
      .eq("proconnect_client_id", proconnectClientId)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}
