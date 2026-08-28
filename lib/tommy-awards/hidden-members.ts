/**
 * Single source of truth for who is excluded from the Tommy Awards.
 *
 * These lists used to be copy-pasted into every route that touched the
 * awards (ballot init, leaderboard, YTD stats, Tommy stats, the weekly
 * recap and the Friday reminder email), which made it easy for one
 * surface to drift out of sync with the others. Import from here instead.
 *
 * Matching is case- and whitespace-insensitive so near-duplicate rows in
 * `team_members` (e.g. "ALFRED Ai" and "ALFRED AI") are both caught.
 */

/**
 * Hidden from every Tommy Awards surface — ballot dropdowns, leaderboards,
 * YTD/Tommy stats, the weekly recap and the reminder email.
 */
export const TOMMY_HIDDEN_MEMBERS = [
  "Grace Cha",
  "Beth Nietupski",
  "Andrew Gianares",
  // ALFRED is the Hub's assistant, not a teammate. Two team_members rows
  // exist with different casing; both are listed for clarity (the
  // case-insensitive match below would catch either on its own).
  "ALFRED Ai",
  "ALFRED AI",
]

/**
 * Additionally hidden from the ballot itself — they neither cast a ballot
 * nor appear as nominees, but they still count on the leaderboard.
 */
export const TOMMY_BALLOT_HIDDEN_MEMBERS = [
  ...TOMMY_HIDDEN_MEMBERS,
  "Matthew Pereira",
  "Mark Dwyer",
]

const normalize = (name: string | null | undefined) => (name ?? "").trim().toLowerCase()

const HIDDEN_SET = new Set(TOMMY_HIDDEN_MEMBERS.map(normalize))
const BALLOT_HIDDEN_SET = new Set(TOMMY_BALLOT_HIDDEN_MEMBERS.map(normalize))

/** True when `name` should not appear anywhere in the Tommy Awards. */
export function isHiddenFromTommyAwards(name: string | null | undefined): boolean {
  return HIDDEN_SET.has(normalize(name))
}

/** True when `name` should not appear in the ballot's voter/nominee dropdowns. */
export function isHiddenFromTommyBallot(name: string | null | undefined): boolean {
  return BALLOT_HIDDEN_SET.has(normalize(name))
}
