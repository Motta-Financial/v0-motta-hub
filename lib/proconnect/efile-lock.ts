/**
 * Post-e-file edit lock.
 *
 * Firm policy: once a return has been e-filed and ACCEPTED, its data is
 * final. Returns that are still in progress must stay fully editable.
 *
 * ─── WHY THIS IS NOT `efile_status === "ACK_SUCCEEDED"` ──────────────────
 * `proconnect_engagements.efile_status` is a HEADLINE — the single most
 * newsworthy status across every filing on the engagement (see
 * pickLatestEfile in ./sync). It answers "what is the latest e-file news
 * about this engagement", which is a different question from "has the
 * return itself been accepted", and the two disagree in both directions.
 *
 * Measured against all 919 live engagements on 2026-08-11:
 *
 *   naive   efile_status === "ACK_SUCCEEDED"           696 locked
 *   correct a RETURN filing is accepted                633 locked
 *   ── 66 returns the naive check locks and must not ──
 *   ── 3 returns the naive check misses and must lock ─
 *
 * The 66 are the case the tax partner caught in review: a TY2025 1040 whose
 * only accepted filing is `ind.us.ext` — Form 4868. The extension was
 * accepted; the return was never transmitted (its REGULAR filing carries
 * zero statuses). That return is in-progress 2026 work and has to stay
 * editable.
 *
 * The 3 are the mirror, and all three are the same shape: a STATE return
 * accepted, and then — an hour later, on the same day — the federal return
 * rejected. The headline reports the rejection because it is newer, so the
 * naive check leaves editable a return that Massachusetts is already
 * holding. Hence the predicate is EXISTENTIAL over filings rather than a
 * read of the headline, and "rejected returns stay editable" means "no
 * acceptance anywhere", not "the most recent word was a rejection".
 *
 * Those 3 are also the one place this predicate is stricter than the letter
 * of the policy, and it is a deliberate call worth knowing about: a return
 * whose FEDERAL filing was rejected is locked here if any STATE filing was
 * accepted, which blocks fixing the federal rejection in the Hub. The
 * argument for locking anyway is that the viewer edits one shared data set
 * — there is no per-jurisdiction editability to express — and altering data
 * an agency has already accepted is exactly the harm the lock exists to
 * prevent. If the firm decides federal-only is the rule, that is one
 * condition in isReturnFiling, not a redesign.
 *
 * ─── THE STATUS VOCABULARY ───────────────────────────────────────────────
 * Four codes, and only four, across 3,313 live status entries:
 *
 *   PENDING_EFE     queued at Intuit's e-file engine   → not filed yet
 *   PENDING_AGENCY  transmitted, awaiting the agency   → no acceptance yet
 *   ACK_SUCCEEDED   the agency accepted it             → THIS is "accepted"
 *   ACK_REJECTED    the agency rejected it             → fix and resubmit
 *
 * Note there is no status containing the word "ACCEPTED". Anything hunting
 * for one finds nothing and silently unlocks every filed return, so the
 * accepted code is pinned as a constant and any status outside these four
 * is treated as unrecognized — which locks (see below).
 *
 * ─── FAIL CLOSED ─────────────────────────────────────────────────────────
 * Every path that cannot prove a return is unfiled locks it. Unknown status
 * code, unreadable engagement, never-hydrated row: locked. The one thing
 * that is NOT "unknown" is a hydrated engagement with no filings — that is
 * a positive statement ("we looked, nothing is filed") and it unlocks, or
 * every in-progress return in the firm would be frozen. `efile_synced_at`
 * is what separates the two, which is why the cached reader below refuses
 * to answer without it.
 */

import {
  hydrateEngagementEfile,
  flattenFilings,
  latestStatusOf,
  type RawFiling,
  type RawTaxFiling,
} from "./sync"

// ═══════════════════════════════════════════════════════════════════════════
// Vocabulary
// ═══════════════════════════════════════════════════════════════════════════

/** The one status that means an agency accepted a filing. */
export const ACCEPTED_STATUS = "ACK_SUCCEEDED"

/**
 * Statuses that positively mean "not accepted (yet)". Kept as an explicit
 * allowlist rather than "anything that isn't ACK_SUCCEEDED": a code we have
 * never seen must not be assumed benign.
 */
export const NOT_ACCEPTED_STATUSES = new Set([
  "PENDING_EFE",
  "PENDING_AGENCY",
  "ACK_REJECTED",
])

/**
 * `filingKey.filingId` kind suffixes that are NOT the return itself.
 *
 *   ind.us       the 1040                      ← the return
 *   ind.us.ext   Form 4868                     ← extension
 *   ind.us.amd   Form 1040-X                   ← amended, see note below
 *   ind.us.fbar  FinCEN 114                    ← a separate filing entirely
 *
 * FBAR is typed REGULAR by Intuit but is filed to FinCEN, not with the
 * return — accepting it says nothing about whether the 1040 was filed.
 */
const NON_RETURN_FILING_KINDS = new Set(["ext", "fbar"])

// ═══════════════════════════════════════════════════════════════════════════
// The predicate
// ═══════════════════════════════════════════════════════════════════════════

export type LockCode =
  /** Locked: a filing of the return itself was accepted by an agency. */
  | "return_accepted"
  /** Locked: a return filing carries a status code we do not recognize. */
  | "unrecognized_status"
  /** Locked: e-file state has never been read for this engagement. */
  | "never_hydrated"
  /** Locked: could not read e-file state at write time. */
  | "lookup_failed"
  /** Open: we looked, and nothing has been filed. */
  | "not_filed"
  /** Open: filings exist, none of them is a filing of the return. */
  | "extension_only"
  /** Open: the return has been filed but not accepted (pending/rejected). */
  | "return_not_accepted"

export interface LockedFiling {
  filingId: string | null
  filingType: string | null
  filingLevel: string | null
  jurisdiction: string | null
  status: string | null
  userMessage: string | null
  statusUpdateTimestamp: string | null
  confirmationNumber: string | null
}

export interface LockDecision {
  locked: boolean
  code: LockCode
  /** One sentence, safe to show a preparer. */
  reason: string
  /** The filing that caused a lock, when there is one. */
  filing: LockedFiling | null
  /** How the decision was reached — a cached read is advisory only. */
  source: "live" | "cached"
  /** True when the lock is a fail-closed default rather than a real acceptance. */
  failedClosed: boolean
}

/** The kind suffix of `{entity}.{jurisdiction}[.{kind}]`, or null. */
function filingKindOf(f: RawFiling): string | null {
  const id = f.filingKey?.filingId
  if (!id) return null
  const parts = id.split(".")
  return parts.length >= 3 ? parts.slice(2).join(".").toLowerCase() : null
}

/**
 * Is this filing a filing OF THE RETURN, as opposed to an extension or a
 * companion form?
 *
 * Two independent signals — `filingType` and the `filingKey.filingId` kind
 * suffix — and the stricter one wins. They agree on all 2,383 live filings;
 * reading both means a future payload that drops or renames either still
 * classifies extensions correctly.
 *
 * AMENDED counts as a filing of the return: an accepted 1040-X is the IRS
 * holding a return from us, so locking is the safe direction. Amended
 * returns are otherwise unaddressed in the viewer — see the note in the
 * handoff; do not read this line as amended-return support.
 *
 * Anything unclassifiable counts as a return filing, so an unknown filing
 * kind that reports acceptance locks rather than unlocks.
 */
export function isReturnFiling(f: RawFiling): boolean {
  if (f.filingType === "EXTENSION") return false
  const kind = filingKindOf(f)
  if (kind && NON_RETURN_FILING_KINDS.has(kind)) return false
  // Everything else — REGULAR, AMENDED, and anything unrecognized — counts.
  return true
}

function describe(f: RawFiling, status: ReturnType<typeof latestStatusOf>): LockedFiling {
  return {
    filingId: f.filingKey?.filingId ?? null,
    filingType: f.filingType ?? null,
    filingLevel: f.filingLevel ?? null,
    jurisdiction: f.jurisdiction ?? null,
    status: status?.status ?? null,
    userMessage: status?.userMessage ?? null,
    statusUpdateTimestamp: status?.statusUpdateTimestamp ?? null,
    confirmationNumber: status?.confirmationNumber ?? null,
  }
}

function label(f: RawFiling): string {
  const level = f.filingLevel === "flState" ? f.jurisdiction || "state" : "federal"
  return `${level} ${(f.filingType || "return").toLowerCase()} filing`
}

/**
 * Decide the lock from a `taxFiling` payload.
 *
 * Pure — no I/O, no clock. Callers supply the payload and say whether they
 * trust it (`source`). Only ever pass a payload from the SINGLE-engagement
 * GET: the list endpoints return `filings: []` on every engagement, so a
 * list-derived payload would read as "nothing is filed" for every return in
 * the firm.
 */
export function evaluateEfileLock(
  taxFiling: RawTaxFiling | null | undefined,
  source: "live" | "cached" = "live",
): LockDecision {
  const filings = flattenFilings(taxFiling?.filings)
  const returnFilings = filings.filter(isReturnFiling)

  // Locked, in priority order: a real acceptance first, so the message names
  // the filing that actually locked the return.
  for (const f of returnFilings) {
    const status = latestStatusOf(f)
    if (status?.status === ACCEPTED_STATUS) {
      return {
        locked: true,
        code: "return_accepted",
        reason: `The ${label(f)} was accepted${
          status.statusUpdateTimestamp
            ? ` on ${status.statusUpdateTimestamp.slice(0, 10)}`
            : ""
        }. Filed returns are final and cannot be edited here.`,
        filing: describe(f, status),
        source,
        failedClosed: false,
      }
    }
  }

  // Then anything we cannot classify — locked, but honestly labelled.
  for (const f of returnFilings) {
    const status = latestStatusOf(f)
    const code = status?.status
    if (code && !NOT_ACCEPTED_STATUSES.has(code)) {
      return {
        locked: true,
        code: "unrecognized_status",
        reason: `The ${label(f)} reports e-file status "${code}", which this Hub does not recognize. Locked until someone confirms whether it means the return was accepted.`,
        filing: describe(f, status),
        source,
        failedClosed: true,
      }
    }
  }

  // A filing with no status history has not been transmitted. ProConnect
  // creates the REGULAR filing row as soon as the return exists, so
  // "there is a REGULAR filing" is not evidence that anything was filed —
  // 154 live filings carry zero statuses.
  if (!filings.some((f) => latestStatusOf(f))) {
    return {
      locked: false,
      code: "not_filed",
      reason: "Nothing has been e-filed for this return.",
      filing: null,
      source,
      failedClosed: false,
    }
  }

  if (!returnFilings.some((f) => latestStatusOf(f))) {
    return {
      locked: false,
      code: "extension_only",
      reason:
        "The only e-file activity on this return is an extension or companion filing — the return itself has not been transmitted.",
      filing: null,
      source,
      failedClosed: false,
    }
  }

  return {
    locked: false,
    code: "return_not_accepted",
    reason:
      "The return has been transmitted but no agency has accepted it, so it can still be corrected and resubmitted.",
    filing: null,
    source,
    failedClosed: false,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Readers
// ═══════════════════════════════════════════════════════════════════════════

function closed(code: LockCode, reason: string, source: "live" | "cached"): LockDecision {
  return { locked: true, code, reason, filing: null, source, failedClosed: true }
}

/**
 * AUTHORITATIVE read — refetches the engagement from ProConnect.
 *
 * This is what the write path must call. Deriving the lock from the cached
 * `efile_*` columns is not safe on its own: those columns are hydrated by a
 * separate per-engagement pass, and a list-derived upsert that reintroduced
 * them would blank them nightly (it has happened once already — see the
 * warning on mapEngagementRow). A cached read of a blanked column reports
 * "not filed", which silently unlocks every filed return overnight. So the
 * boundary refetches and fails closed when it cannot.
 *
 * Goes through hydrateEngagementEfile rather than fetchEngagement directly
 * so the same call also refreshes the cached columns — the read that guards
 * the write keeps the display honest for free.
 *
 * @param engagementId The engagement id, which for a return is the same id
 *   the return endpoints take (`proconnect_returns_with_data` joins the two
 *   on equality; 49 of 49 sampled snapshot return_ids matched an
 *   engagement_id, 2026-08-11).
 */
export async function resolveReturnLock(engagementId: string): Promise<LockDecision> {
  let result
  try {
    result = await hydrateEngagementEfile(engagementId)
  } catch (err) {
    return closed(
      "lookup_failed",
      `Could not read this return's e-file status from ProConnect (${
        err instanceof Error ? err.message : "unknown error"
      }), so it is treated as filed. Try again in a moment.`,
      "live",
    )
  }

  // A DB-write failure is not a lookup failure: the filings we just read are
  // as authoritative as they were going to be. Only a failed GET blocks.
  if (!result.fetchedOk) {
    return closed(
      "lookup_failed",
      result.notFound
        ? "ProConnect no longer has this engagement, so its e-file status cannot be confirmed."
        : `Could not read this return's e-file status from ProConnect (${result.error ?? "request failed"}), so it is treated as filed. Try again in a moment.`,
      "live",
    )
  }

  return evaluateEfileLock(result.taxFiling, "live")
}

/**
 * ADVISORY read, from the cached columns — for rendering a badge without
 * an API call per page view. Never gate a write on this.
 *
 * `efile_synced_at` is load-bearing: without it, "no filings" is ambiguous
 * between "we looked and nothing is filed" and "we have never looked", and
 * only the first of those is safe to unlock.
 */
export function lockFromCachedEfile(row: {
  efile_filings?: unknown
  efile_synced_at?: string | null
}): LockDecision {
  if (!row.efile_synced_at) {
    return closed(
      "never_hydrated",
      "This return's e-file status has never been read from ProConnect, so it is treated as filed until it has been.",
      "cached",
    )
  }
  return evaluateEfileLock(row.efile_filings as RawTaxFiling | null, "cached")
}
