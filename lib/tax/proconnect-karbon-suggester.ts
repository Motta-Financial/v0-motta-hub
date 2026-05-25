/**
 * Karbon co-occurrence suggester for ProConnect preparer profiles.
 *
 * ProConnect's API does NOT expose names or emails for the 13 staff
 * profile GUIDs (raw_json.assignee is just `{ authId, profileId }`), so
 * the standard name/email matcher in `proconnect-profile-match.ts` has
 * nothing to bite onto. This module derives candidates from a
 * different signal: which Karbon teammate is most often assigned to
 * the SAME client / tax year that ProConnect attributes to a given
 * profile_id.
 *
 * Algorithm:
 *   1. Pull every (profile_id, client display_name, tax_year) tuple
 *      from `proconnect_engagements` join `proconnect_clients`.
 *   2. Pull every (assignee_full_name, client_name, tax_year) tuple
 *      from `work_items_enriched` (Karbon work-items joined with the
 *      teammate roster).
 *   3. Inner-join by lower(client name) and tax_year (or nulls), count
 *      co-occurrences per (profile_id, assignee_full_name).
 *   4. Translate top-N assignee names back to team_members.id by
 *      normalised name match, then surface each as a candidate with
 *      score = min(0.85, 0.55 + 0.30 * confidence_pct), matchedOn =
 *      ["karbon_cooccurrence:<match_ct>/<total>"].
 *
 * We cap the score at 0.85 so the bulk auto-linker (threshold 0.85)
 * doesn't fire on a Karbon-only signal — operators must confirm
 * Karbon-derived suggestions in the UI. Once they do, the team_member
 * link sticks and downstream rollups (preparer leaderboard, /tax KPIs,
 * /tax/returns Preparer column) start showing the right name.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  ProfileMatchCandidate,
  TeamMemberLite,
} from "./proconnect-profile-match"

export type KarbonSuggestion = ProfileMatchCandidate & {
  matchCount: number
  totalCooccurrences: number
}

type KarbonSuggestionsByProfile = Map<string, KarbonSuggestion[]>

/** Normalise a name for comparison: lowercase, strip punctuation, collapse whitespace. */
function norm(s: string | null | undefined): string {
  if (!s) return ""
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Match a karbon assignee_full_name back to one of our team_members rows. */
function findTeamMember(
  name: string,
  teamMembers: TeamMemberLite[],
): TeamMemberLite | null {
  const target = norm(name)
  if (!target) return null
  for (const tm of teamMembers) {
    if (norm(tm.full_name) === target) return tm
  }
  // Fallback: match by first+last token overlap (handles "Andrew Gianares"
  // vs a team_member where full_name is "Andrew J. Gianares").
  const targetTokens = new Set(target.split(" ").filter(Boolean))
  for (const tm of teamMembers) {
    const tmFull = norm(tm.full_name)
    if (!tmFull) continue
    const tmTokens = new Set(tmFull.split(" ").filter(Boolean))
    const overlap = [...targetTokens].filter((t) => tmTokens.has(t)).length
    if (overlap >= 2) return tm
  }
  return null
}

/**
 * Run the cross-reference SQL once and return Karbon suggestions for
 * every profile_id that had at least one co-occurring Karbon work item.
 */
export async function loadKarbonSuggestions(
  supabase: SupabaseClient<any, any, any>,
  teamMembers: TeamMemberLite[],
): Promise<KarbonSuggestionsByProfile> {
  // We can't easily express the windowed SQL in PostgREST, so call a
  // dedicated RPC. We provision the RPC alongside this code (script
  // 211_karbon_proconnect_suggester.sql).
  const { data, error } = await supabase.rpc(
    "proconnect_profile_karbon_candidates",
  )
  const out: KarbonSuggestionsByProfile = new Map()
  if (error || !Array.isArray(data)) return out

  type Row = {
    assignee_profile_id: string
    karbon_assignee_name: string
    match_count: number
    profile_total: number
  }

  for (const r of data as Row[]) {
    const tm = findTeamMember(r.karbon_assignee_name, teamMembers)
    if (!tm) continue // Karbon name has no Hub teammate row — skip.
    const confidence =
      r.profile_total > 0 ? r.match_count / r.profile_total : 0
    // Score curve: tiny matches (<3) cap at 0.60, otherwise scale up to 0.85.
    const base = r.match_count < 3 ? 0.55 : 0.6
    const score = Math.min(0.85, base + 0.3 * confidence)

    const cand: KarbonSuggestion = {
      teamMemberId: tm.id,
      fullName: tm.full_name || r.karbon_assignee_name,
      email: tm.email,
      role: tm.role,
      isActive: tm.is_active,
      score,
      matchedOn: [
        `karbon_cooccurrence:${r.match_count}/${r.profile_total}`,
      ],
      matchCount: r.match_count,
      totalCooccurrences: r.profile_total,
    }
    const existing = out.get(r.assignee_profile_id) || []
    existing.push(cand)
    out.set(r.assignee_profile_id, existing)
  }

  // Sort each profile's candidates by score desc.
  for (const [k, arr] of out) {
    arr.sort((a, b) => b.score - a.score)
    out.set(k, arr)
  }

  return out
}
