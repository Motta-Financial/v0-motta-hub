/**
 * Shared ProConnect request throttle + correlation id.
 *
 * Why this module exists
 * ----------------------
 * ProConnect enforces ~5 TPS per app per user. We had drifted into *two*
 * independent HTTP paths:
 *
 *   - `lib/proconnect/client.ts` (Client + Engagement services) had a local
 *     250 ms slot reservation but no backoff, no `intuit-tid`.
 *   - `lib/proconnect/data.ts`   (Export + Import) had backoff, `Retry-After`
 *     handling and tid capture but **no limiter**.
 *
 * Each had what the other lacked. Worse, a per-file limiter is not just
 * incomplete — it is actively wrong: two module-scoped counters each pacing
 * at 4 req/s means the process as a whole can emit ~8 req/s and breach the
 * cap. The limiter has to be a single shared choke point, which is what this
 * module provides. Both clients import from here; neither keeps its own copy.
 *
 * This matters most on the write path: Import is not idempotent, so a 429
 * mid-batch leaves a partially-applied series that a human has to reconcile.
 * Staying under the cap is cheaper than recovering from breaching it.
 */

/**
 * 1000 ms / 250 ms = 4 requests per second, one notch under Intuit's ~5 TPS
 * so a little clock skew or a retry burst doesn't tip us over.
 */
const MIN_REQUEST_INTERVAL_MS = 250

/**
 * Timestamp (ms) of the next free slot. Module scope = one counter per
 * server instance, shared by every ProConnect caller in the process.
 *
 * Note on correctness across instances: Vercel may run several concurrent
 * lambdas, each with its own module scope, so this bounds per-instance rate
 * rather than global rate. That is the same guarantee the original
 * implementation gave. It is sufficient today because all high-volume
 * ProConnect traffic (the nightly sync, bulk import) runs single-instance;
 * if that changes, this needs to move to a Postgres- or Redis-backed token
 * bucket rather than a module variable.
 */
let nextRequestSlot = 0

/**
 * Reserve the next outbound slot and wait for it.
 *
 * The read-then-write of `nextRequestSlot` is atomic in practice: JS is
 * single-threaded and there is no `await` between the read and the write, so
 * concurrent callers each claim a distinct slot before any of them sleeps.
 */
export async function acquireRateLimitSlot(): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextRequestSlot)
  nextRequestSlot = slot + MIN_REQUEST_INTERVAL_MS
  const wait = slot - now
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

/**
 * Generate a client-side `intuit-tid` correlation id.
 *
 * Intuit strongly recommends sending one and echoes it back on responses;
 * it is the single most useful thing to quote when opening a support ticket.
 * We persist it on every import job row.
 */
export function newIntuitTid(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Exposed for tests / diagnostics. */
export const PROCONNECT_MIN_REQUEST_INTERVAL_MS = MIN_REQUEST_INTERVAL_MS
