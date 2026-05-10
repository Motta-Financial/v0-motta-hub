/**
 * Map the free-form "preferred team member" name a prospect typed/selected
 * on the Jotform intake form to a real `team_members.id`.
 *
 * Why a dedicated resolver vs. inlining the lookup at the call site:
 *   1. The Jotform field is unconstrained text/radio — values can be
 *      mis-spelled, missing a middle name, or partial ("Mark D"). We
 *      try progressively looser strategies so the team still gets
 *      auto-assigned for the common cases.
 *   2. We want one place where matching rules live so we can tweak
 *      precedence without combing through ingest code.
 *   3. The result is annotated with a `method` so the audit trail in
 *      `triage_notes` (and the UI) can explain why a row landed with a
 *      particular owner — exact match vs. fuzzy vs. unmatched.
 *
 * Matching order (most → least confident):
 *   1. case-insensitive exact match on `team_members.full_name`
 *   2. exact match on "first_name last_name"
 *   3. first-and-last name pair (handles "Mark Dwyer" vs "Mark M. Dwyer")
 *   4. last-name match when the prospect gave just a surname
 *
 * Always restricted to `is_active = true AND is_service_account = false`
 * so we never auto-assign to deactivated humans or system accounts.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export type ResolveMethod =
  | "full_name_exact"
  | "first_last_exact"
  | "first_last_fuzzy"
  | "last_name_only"
  | "unmatched"

export interface ResolveResult {
  team_member_id: string | null
  team_member_name: string | null
  method: ResolveMethod
  /** The raw value we tried to match — convenient for logging/UI. */
  input: string
}

interface TeamMemberRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  is_active: boolean
  is_service_account: boolean
}

/**
 * Normalize a name for comparison: strip whitespace, collapse inner
 * runs of whitespace, lowercase. Punctuation is preserved (some real
 * names have hyphens / apostrophes that we *don't* want to drop) but
 * we strip dots ("Mark M. Dwyer" → "mark m dwyer") so middle-initial
 * variants compare equal.
 */
function normalize(input: string | null | undefined): string {
  if (!input) return ""
  return input
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Split a normalized name into ["first", "last"] tokens. Anything
 * after the first token is treated as the surname so middle-name
 * variants ("Mark M Dwyer") still produce ("mark", "dwyer").
 */
function splitFirstLast(normalized: string): { first: string; last: string } | null {
  if (!normalized) return null
  const parts = normalized.split(" ").filter(Boolean)
  if (parts.length < 2) return null
  return { first: parts[0]!, last: parts[parts.length - 1]! }
}

export async function resolvePreferredTeamMember(
  supabase: SupabaseClient,
  rawName: string | null | undefined,
): Promise<ResolveResult> {
  const input = (rawName ?? "").trim()
  if (!input) {
    return { team_member_id: null, team_member_name: null, method: "unmatched", input: "" }
  }

  // Pull all candidate rows once. The team is small (<100 active humans)
  // so we filter in JS rather than running multiple round-trips with
  // different ILIKE patterns. This also makes the fuzzy passes free.
  const { data, error } = await supabase
    .from("team_members")
    .select("id, full_name, first_name, last_name, is_active, is_service_account")
    .eq("is_active", true)
    .eq("is_service_account", false)

  if (error) {
    console.log("[v0] resolvePreferredTeamMember query error:", error.message)
    return { team_member_id: null, team_member_name: null, method: "unmatched", input }
  }

  const candidates = (data ?? []) as TeamMemberRow[]
  if (candidates.length === 0) {
    return { team_member_id: null, team_member_name: null, method: "unmatched", input }
  }

  const target = normalize(input)
  const targetParts = splitFirstLast(target)

  const annotated = candidates.map((c) => ({
    row: c,
    full: normalize(c.full_name ?? `${c.first_name ?? ""} ${c.last_name ?? ""}`),
    composed: normalize(`${c.first_name ?? ""} ${c.last_name ?? ""}`),
    first: normalize(c.first_name ?? ""),
    last: normalize(c.last_name ?? ""),
  }))

  // 1. full_name exact match — most confident.
  const fullHit = annotated.find((c) => c.full && c.full === target)
  if (fullHit) {
    return {
      team_member_id: fullHit.row.id,
      team_member_name: fullHit.row.full_name,
      method: "full_name_exact",
      input,
    }
  }

  // 2. exact "first last" pair (covers the case where full_name is set
  // to a preferred-name variant on the team_members row).
  const composedHit = annotated.find((c) => c.composed && c.composed === target)
  if (composedHit) {
    return {
      team_member_id: composedHit.row.id,
      team_member_name: composedHit.row.full_name,
      method: "first_last_exact",
      input,
    }
  }

  if (targetParts) {
    // 3. first+last pair, tolerating middle names / suffixes on either side.
    const fuzzy = annotated.find(
      (c) => c.first && c.last && c.first === targetParts.first && c.last === targetParts.last,
    )
    if (fuzzy) {
      return {
        team_member_id: fuzzy.row.id,
        team_member_name: fuzzy.row.full_name,
        method: "first_last_fuzzy",
        input,
      }
    }
  }

  // 4. surname-only match — last-ditch attempt for one-word prospect
  // answers. Only fires when exactly one active teammate has that
  // surname so we never randomly pick between two "Smiths".
  const surnameCandidates = annotated.filter((c) => c.last && c.last === target)
  if (surnameCandidates.length === 1) {
    const c = surnameCandidates[0]!
    return {
      team_member_id: c.row.id,
      team_member_name: c.row.full_name,
      method: "last_name_only",
      input,
    }
  }

  return { team_member_id: null, team_member_name: null, method: "unmatched", input }
}
