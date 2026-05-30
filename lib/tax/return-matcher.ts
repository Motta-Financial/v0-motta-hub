/**
 * Tax return → Karbon work item / Ignition proposal matcher.
 *
 * Pure, DB-free functions so they can be unit-tested and reused by the
 * backfill script, the nightly ProConnect sync, and the TaxReturn webhook.
 *
 * Matching is deterministic and conservative: we only auto-link when the
 * (client + return type + tax year) signal is unambiguous. Anything fuzzy is
 * surfaced as `needs_review` for a human, and manual links always win.
 */

// ── Canonical return types ──────────────────────────────────────────────────
// ProConnect `return_type` values seen in the data: 1040, 1120S, 1120, 1065,
// 1041, 990, 709. We normalize everything to these tokens.
export type ReturnType = "1040" | "1120S" | "1120" | "1065" | "1041" | "990" | "709"

const RETURN_TYPES: ReturnType[] = ["1040", "1120S", "1120", "1065", "1041", "990", "709"]

export function normalizeReturnType(raw: string | null | undefined): ReturnType | null {
  if (!raw) return null
  const s = raw.toString().trim().toUpperCase().replace(/\s+/g, "")
  // 1120S / 1120-S / 1120SE -> 1120S ; 1120C / 1120-C -> 1120
  if (/^1120-?S/.test(s)) return "1120S"
  if (/^1120-?C/.test(s)) return "1120"
  if (/^1120/.test(s)) return "1120"
  if (/^1040/.test(s)) return "1040"
  if (/^1065/.test(s)) return "1065"
  if (/^1041/.test(s)) return "1041"
  if (/^990/.test(s)) return "990"
  if (/^709/.test(s)) return "709"
  const direct = RETURN_TYPES.find((t) => t === s)
  return direct ?? null
}

/**
 * Pull a return-type code out of free text (a work-item template name or an
 * Ignition service name). Handles `(1040)`, `(1120s)`, `(1120C)`, `(709)`,
 * `(990)`, and bare codes like "Amended 1040" or "1040 Individual ...".
 * Order matters: check the S-corp variant before the bare 1120.
 */
export function parseReturnTypeFromText(text: string | null | undefined): ReturnType | null {
  if (!text) return null
  const t = text.toUpperCase()
  if (/\b1120-?S\b/.test(t) || /\(1120S\)/.test(t)) return "1120S"
  if (/\b1120-?C\b/.test(t) || /\(1120C?\)/.test(t)) return "1120"
  if (/\b1120\b/.test(t)) return "1120"
  if (/\b1065\b/.test(t)) return "1065"
  if (/\b1041\b/.test(t)) return "1041"
  if (/\b990\b/.test(t)) return "990"
  if (/\b709\b/.test(t)) return "709"
  if (/\b1040\b/.test(t)) return "1040"
  // Word-based fallbacks (no code present).
  if (/\bS-?CORP/.test(t)) return "1120S"
  if (/\bC-?CORP/.test(t)) return "1120"
  if (/\bPARTNERSHIP\b/.test(t)) return "1065"
  if (/\bGIFT\b/.test(t)) return "709"
  if (/\bNON ?PROFIT\b/.test(t)) return "990"
  if (/\bESTATE\b|\bTRUST\b/.test(t)) return "1041"
  if (/\bINDIVIDUAL\b/.test(t)) return "1040"
  return null
}

/**
 * Extract a real 4-digit tax year from free text. Placeholder tokens used in
 * Karbon templates (20XX, YR, YYYY, 202X) deliberately fail to parse so we
 * fall back to the structured `tax_year` column instead.
 */
export function parseYearFromText(text: string | null | undefined): number | null {
  if (!text) return null
  const m = text.match(/\b(20\d{2})\b/)
  if (!m) return null
  const yr = Number.parseInt(m[1], 10)
  if (yr < 2000 || yr > 2100) return null
  return yr
}

// ── Input shapes (subset of the DB rows) ────────────────────────────────────
export interface EngagementLike {
  engagement_id: string
  tax_year: number | null
  return_type: string | null
}

export interface WorkItemLike {
  id: string
  karbon_work_item_key?: string | null
  work_template_name?: string | null
  title?: string | null
  tax_year?: number | null
}

export interface ProposalServiceLike {
  id: string
  proposal_id: string | null
  service_name: string | null
}

export interface WorkItemMatch {
  workItem: WorkItemLike | null
  linkSource: "auto" | "none"
  confidence: number
  status: "linked" | "needs_review" | "no_match"
}

/**
 * Match an engagement to one of the client's tax work items.
 *
 * @param engagement      the ProConnect return
 * @param candidates      the client's TAX work items (already scoped to the
 *                        same Hub client by the caller)
 */
export function matchEngagementToWorkItem(
  engagement: EngagementLike,
  candidates: WorkItemLike[],
): WorkItemMatch {
  const engType = normalizeReturnType(engagement.return_type)
  const engYear = engagement.tax_year ?? null

  if (!engType || candidates.length === 0) {
    return { workItem: null, linkSource: "none", confidence: 0, status: "no_match" }
  }

  // Score each candidate on (return type, year) agreement.
  const scored = candidates.map((wi) => {
    const wiText = `${wi.work_template_name ?? ""} ${wi.title ?? ""}`
    const wiType = parseReturnTypeFromText(wiText)
    const wiYear = parseYearFromText(wiText) ?? wi.tax_year ?? null

    let score = 0
    const typeMatch = wiType !== null && wiType === engType
    if (typeMatch) score += 0.6
    // Year agreement (only counts when both sides have a real year).
    const yearKnown = engYear !== null && wiYear !== null
    const yearMatch = yearKnown && wiYear === engYear
    if (yearMatch) score += 0.4
    else if (engYear !== null && wiYear === null) score += 0.1 // template lacks year

    return { wi, score, typeMatch, yearMatch, yearKnown }
  })

  // Only consider candidates whose return type matches — never cross types.
  const typed = scored.filter((s) => s.typeMatch)
  if (typed.length === 0) {
    return { workItem: null, linkSource: "none", confidence: 0, status: "no_match" }
  }

  // Prefer exact year matches.
  const exact = typed.filter((s) => s.yearMatch)
  if (exact.length === 1) {
    return { workItem: exact[0].wi, linkSource: "auto", confidence: 1, status: "linked" }
  }
  if (exact.length > 1) {
    // Same type + same year on multiple work items → ambiguous.
    return { workItem: exact[0].wi, linkSource: "none", confidence: 0.5, status: "needs_review" }
  }

  // No exact-year match.
  const yearless = typed.filter((s) => !s.yearKnown)

  if (engYear === null) {
    // The engagement itself has no year. If there's exactly one candidate of
    // the right type, accept it; otherwise surface for review.
    if (typed.length === 1) {
      return { workItem: typed[0].wi, linkSource: "auto", confidence: 0.7, status: "linked" }
    }
    const best = typed.sort((a, b) => b.score - a.score)[0]
    return { workItem: best.wi, linkSource: "none", confidence: best.score, status: "needs_review" }
  }

  // The engagement HAS a year but no work item shares it.
  if (yearless.length === 0) {
    // Every candidate is for a DIFFERENT, known year — this is almost always a
    // past/already-filed return with no active Karbon work item. Report
    // honestly as no_match rather than pointing at a wrong-year work item.
    return { workItem: null, linkSource: "none", confidence: 0, status: "no_match" }
  }
  if (yearless.length === 1) {
    // A single rolling/year-less template (e.g. "(Returning Client)") may well
    // cover this year — let a human confirm.
    return { workItem: yearless[0].wi, linkSource: "none", confidence: 0.5, status: "needs_review" }
  }
  // Multiple year-less templates → ambiguous.
  const best = yearless.sort((a, b) => b.score - a.score)[0]
  return { workItem: best.wi, linkSource: "none", confidence: best.score, status: "needs_review" }
}

export interface ProposalMatch {
  service: ProposalServiceLike | null
  linkSource: "auto" | "none"
}

/**
 * Match an engagement to one of the client's Ignition proposal services by
 * detecting the return-type code/keyword in the service name. Conservative:
 * only auto-links when exactly one service of the right type exists.
 */
export function matchEngagementToProposalService(
  engagement: EngagementLike,
  services: ProposalServiceLike[],
): ProposalMatch {
  const engType = normalizeReturnType(engagement.return_type)
  if (!engType || services.length === 0) return { service: null, linkSource: "none" }

  const typed = services.filter((s) => parseReturnTypeFromText(s.service_name) === engType)
  if (typed.length === 1) return { service: typed[0], linkSource: "auto" }
  // Ambiguous or none → leave for manual linking.
  return { service: null, linkSource: "none" }
}
