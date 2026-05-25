/**
 * ProConnect profile <-> team_member matcher.
 *
 * ProConnect's API doesn't expose user names/emails for the 13 staff
 * profile GUIDs, so we have to do the matching from the Hub side using
 * any seed data the operator has typed onto the `proconnect_profiles`
 * row (full_name, email, notes) AND the activity attribution we have
 * (engagement count). The `team_members` roster includes BOTH active
 * and inactive teammates so historical preparers (e.g. someone who
 * left mid-season) still surface as candidates.
 *
 * Matching layers in increasing strictness:
 *  - email exact (case insensitive) -> 0.99
 *  - first + last exact -> 0.95
 *  - last + first-initial exact -> 0.85
 *  - normalized full-name exact -> 0.93
 *  - first OR last + token overlap >= 1 -> 0.65 .. 0.80
 *  - email local-part contains team_member first or last -> 0.75
 *
 * Anything below 0.5 is dropped. We always return up to N candidates
 * sorted by score so the operator can confirm even when multiple
 * teammates share a last name.
 */

export type TeamMemberLite = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  role: string | null
  is_active: boolean
}

export type ProfileSeed = {
  profileId: string
  fullName: string | null
  email: string | null
  notes: string | null
}

export type ProfileMatchCandidate = {
  teamMemberId: string
  fullName: string
  email: string | null
  role: string | null
  isActive: boolean
  score: number
  matchedOn: string[]
}

const norm = (s: string | null | undefined) =>
  (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s@.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

const tokens = (s: string | null | undefined) =>
  norm(s).split(/[\s.]+/).filter(Boolean)

function emailLocalPart(email: string | null | undefined): string {
  if (!email) return ""
  const at = email.indexOf("@")
  return (at >= 0 ? email.slice(0, at) : email).toLowerCase()
}

function nameTokensFromSeed(seed: ProfileSeed): {
  first: string | null
  last: string | null
  full: string[]
} {
  // Prefer explicit full_name; fall back to email local-part if it looks like
  // first.last / firstlast. We deliberately do NOT mine notes for names — too
  // noisy. Operators can paste the canonical name into full_name.
  const full = tokens(seed.fullName)
  if (full.length >= 2) {
    return { first: full[0], last: full[full.length - 1], full }
  }
  if (full.length === 1) {
    return { first: full[0], last: null, full }
  }
  const local = emailLocalPart(seed.email)
  if (local.includes(".")) {
    const [first, ...rest] = local.split(".")
    const last = rest.length ? rest[rest.length - 1] : null
    return { first: first || null, last, full: [first, last].filter(Boolean) as string[] }
  }
  return { first: null, last: null, full: [] }
}

/**
 * Score a single (profile seed, team_member) pair.
 * Returns { score, matchedOn } where matchedOn is a list of human-readable
 * reasons used so the UI can explain "why this was suggested".
 */
export function scorePair(
  seed: ProfileSeed,
  tm: TeamMemberLite,
): { score: number; matchedOn: string[] } {
  const matched: string[] = []
  let score = 0

  // Email exact (handles common cases like a @mottafinancial vs @gmail differently)
  if (seed.email && tm.email) {
    if (seed.email.toLowerCase() === tm.email.toLowerCase()) {
      matched.push("email")
      score = Math.max(score, 0.99)
    }
  }

  const seedNames = nameTokensFromSeed(seed)
  const tmFirst = norm(tm.first_name)
  const tmLast = norm(tm.last_name)
  const tmFullTokens = tokens(tm.full_name || `${tm.first_name || ""} ${tm.last_name || ""}`)

  // First + last exact
  if (seedNames.first && seedNames.last && tmFirst && tmLast) {
    if (seedNames.first === tmFirst && seedNames.last === tmLast) {
      matched.push("first+last")
      score = Math.max(score, 0.95)
    } else if (seedNames.last === tmLast && tmFirst.startsWith(seedNames.first[0] || "")) {
      // "j. doe" style
      matched.push("last+first-initial")
      score = Math.max(score, 0.85)
    } else if (seedNames.first === tmFirst && seedNames.last.startsWith(tmLast[0] || "")) {
      matched.push("first+last-initial")
      score = Math.max(score, 0.78)
    }
  }

  // Normalized full-name exact (handles middle names, suffix differences)
  if (seedNames.full.length && tmFullTokens.length) {
    const a = seedNames.full.join(" ")
    const b = tmFullTokens.join(" ")
    if (a === b) {
      matched.push("full-name")
      score = Math.max(score, 0.93)
    } else if (
      seedNames.full[0] === tmFullTokens[0] &&
      seedNames.full[seedNames.full.length - 1] === tmFullTokens[tmFullTokens.length - 1]
    ) {
      matched.push("first+last (within full name)")
      score = Math.max(score, 0.9)
    }
  }

  // Last name only — common surnames produce multiple candidates and that's fine
  if (seedNames.last && tmLast && seedNames.last === tmLast && score < 0.7) {
    matched.push("last-name only")
    score = Math.max(score, 0.65)
  }
  if (seedNames.first && tmFirst && seedNames.first === tmFirst && score < 0.7) {
    matched.push("first-name only")
    score = Math.max(score, 0.6)
  }

  // Email local-part heuristics (catches "tmotta@..." vs missing seed email,
  // and matches inactive Motta domain accounts)
  const seedLocal = emailLocalPart(seed.email)
  const tmLocal = emailLocalPart(tm.email)
  if (seedLocal && tmLocal && seedLocal === tmLocal) {
    matched.push("email-local")
    score = Math.max(score, 0.85)
  }
  if (tmFirst && tmLast && seedLocal) {
    // tmotta, tom.motta, motta.tom
    const firstInitial = tmFirst[0] || ""
    const localCandidates = [
      `${tmFirst}.${tmLast}`,
      `${tmLast}.${tmFirst}`,
      `${tmFirst}${tmLast}`,
      `${firstInitial}${tmLast}`,
      `${tmFirst}${tmLast[0] || ""}`,
    ]
    if (localCandidates.includes(seedLocal)) {
      matched.push("email pattern")
      score = Math.max(score, 0.82)
    }
  }

  // Symmetric: seed first/last vs tm email local
  if (seedNames.first && seedNames.last && tmLocal) {
    const seedFirstInitial = seedNames.first[0] || ""
    const candidates = [
      `${seedNames.first}.${seedNames.last}`,
      `${seedNames.last}.${seedNames.first}`,
      `${seedNames.first}${seedNames.last}`,
      `${seedFirstInitial}${seedNames.last}`,
    ]
    if (candidates.includes(tmLocal)) {
      matched.push("seed name -> tm email")
      score = Math.max(score, 0.8)
    }
  }

  return { score, matchedOn: matched }
}

/**
 * Rank `teamMembers` against a profile seed.
 *
 * Inactive teammates are NOT excluded — historical preparers must surface so
 * old engagements get attributed correctly. Inactive matches are flagged via
 * `isActive` so the UI can render a muted badge.
 *
 * If `seed.teamMemberId` is already set, we still return candidates so the
 * operator can swap; the existing match is just not auto-applied here.
 */
export function rankTeamMembers(
  seed: ProfileSeed,
  teamMembers: TeamMemberLite[],
  options: { minScore?: number; limit?: number } = {},
): ProfileMatchCandidate[] {
  const minScore = options.minScore ?? 0.5
  const limit = options.limit ?? 5

  const scored = teamMembers
    .map((tm) => {
      const { score, matchedOn } = scorePair(seed, tm)
      return { tm, score, matchedOn }
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || (a.tm.is_active ? -1 : 1))

  return scored.slice(0, limit).map((x) => ({
    teamMemberId: x.tm.id,
    fullName: x.tm.full_name || `${x.tm.first_name || ""} ${x.tm.last_name || ""}`.trim(),
    email: x.tm.email,
    role: x.tm.role,
    isActive: x.tm.is_active,
    score: Number(x.score.toFixed(2)),
    matchedOn: x.matchedOn,
  }))
}

/**
 * Returns the autoselectable candidate, if any. Used for the "Auto-link
 * obvious matches" button. We require:
 *  - top score >= 0.85
 *  - clear separation (top - second) >= 0.10  OR  no second candidate
 * to avoid same-last-name false positives.
 */
export function pickAutolinkCandidate(
  ranked: ProfileMatchCandidate[],
): ProfileMatchCandidate | null {
  if (ranked.length === 0) return null
  const [top, second] = ranked
  if (top.score < 0.85) return null
  if (!second) return top
  if (top.score - second.score < 0.1) return null
  return top
}
