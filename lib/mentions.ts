/**
 * @mentions — shared parsing utilities.
 *
 * The convention (per product direction) is **first-name mentions**:
 * "@Dat", "@Caleb", "@Mark". A two-word form ("@Caleb Long") is also
 * supported so partners with shared first names can be disambiguated,
 * but the picker always defaults to the first-name form because that's
 * what the team naturally types in Slack/Karbon today.
 *
 * Storage strategy: we deliberately store the raw text as-is. No
 * markdown, no `<@uuid>` placeholders, no DB schema changes. Mentions
 * are resolved at *render time* against the live team-members
 * directory. This means:
 *
 *  - Old messages keep working when someone's name changes (we re-match
 *    against current names) — the display stays in sync.
 *  - We don't need a migration to backfill any existing comments.
 *  - The same parser runs on the server (notification fan-out) and the
 *    client (highlighted rendering + textarea picker) — one source of
 *    truth, no drift.
 *
 * Ambiguity rule: if two active teammates share a first name, the
 * single-token form ("@Caleb") is left as plain text — we'd rather
 * under-resolve than wrongly notify the other Caleb. The picker still
 * works (it lists both, user picks one and the inserted text becomes
 * the two-token form "@Caleb Long" which always resolves uniquely).
 */

export interface MentionMember {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  email?: string | null
}

export type MentionToken =
  | { kind: "text"; text: string }
  | { kind: "mention"; member: MentionMember; raw: string }

/**
 * Resolve a typed name fragment ("Dat", "Caleb Long") to a single
 * teammate, or null if the fragment is ambiguous / unknown.
 *
 * Match precedence:
 *   1. Exact full_name (case-insensitive). Always unique by definition.
 *   2. Exact first_name match — but only if exactly ONE active member
 *      has that first name. Two Carolines? "@Caroline" stays unresolved
 *      so we don't ping the wrong person.
 */
export function findMember(
  query: string,
  members: MentionMember[],
): MentionMember | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  // 1. Full-name exact match — highest precedence.
  const fullExact = members.find(
    (m) => (m.full_name || "").trim().toLowerCase() === q,
  )
  if (fullExact) return fullExact

  // 2. Single-word: unique first-name match, else null.
  if (!q.includes(" ")) {
    const firstHits = members.filter(
      (m) => (m.first_name || "").trim().toLowerCase() === q,
    )
    if (firstHits.length === 1) return firstHits[0]
  }

  return null
}

/**
 * Tokenize text into an ordered sequence of plain-text and mention
 * spans. Used by both the read-only renderer (`<MentionText>`) and the
 * server-side notification fan-out.
 *
 * Walks the string left-to-right, on every "@" attempts the longest
 * match first ("@Caleb Long") then falls back to the single-token form
 * ("@Caleb"). Anything that doesn't resolve to an actual teammate is
 * preserved verbatim as plain text — twitter handles, email-like
 * fragments, "@everyone", etc. all stay untouched.
 */
export function tokenizeMentions(
  text: string,
  members: MentionMember[],
): MentionToken[] {
  if (!text) return []
  const result: MentionToken[] = []

  // Capture an `@` followed by one word, optionally a second word
  // separated by a single space. Word chars include letters, digits,
  // apostrophes, hyphens, dots — covers names like O'Brien, Mary-Jane,
  // J.A. Trailing punctuation outside the word class is left in the
  // surrounding text run.
  const re = /@([A-Za-z][\w'.\-]*)(?:[ \t]+([A-Za-z][\w'.\-]*))?/g
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index

    // Reject mid-word `@` (e.g. inside an email "foo@bar.com" — the
    // char before isn't whitespace/start-of-string, so it's clearly
    // not a mention). Skip to next match without consuming.
    if (start > 0 && !/\s/.test(text[start - 1])) {
      // Advance regex past this `@` so we don't loop forever.
      re.lastIndex = start + 1
      continue
    }

    const oneWord = m[1]
    const twoWord = m[2] ? `${m[1]} ${m[2]}` : null

    // Try the two-word form first — if "Caleb Long" resolves, we want
    // to consume both words even though "Caleb" alone would also have
    // matched. Falls back to single-word on failure.
    let matched: { member: MentionMember; raw: string; consumed: number } | null = null
    if (twoWord) {
      const found = findMember(twoWord, members)
      if (found) matched = { member: found, raw: `@${twoWord}`, consumed: m[0].length }
    }
    if (!matched) {
      const found = findMember(oneWord, members)
      if (found) {
        const raw = `@${oneWord}`
        matched = { member: found, raw, consumed: raw.length }
      }
    }

    if (start > cursor) {
      result.push({ kind: "text", text: text.slice(cursor, start) })
    }

    if (matched) {
      result.push({ kind: "mention", member: matched.member, raw: matched.raw })
      cursor = start + matched.consumed
      // Reset regex lastIndex in case we consumed less than m[0]
      // (single-word match when a two-word candidate was offered).
      re.lastIndex = cursor
    } else {
      // Unresolved — leave the `@` and the candidate word(s) as text
      // so users still see what they typed. Advance past just the `@`
      // so a later word boundary still gets a chance to match.
      result.push({ kind: "text", text: text.slice(start, start + 1) })
      cursor = start + 1
      re.lastIndex = cursor
    }
  }
  if (cursor < text.length) {
    result.push({ kind: "text", text: text.slice(cursor) })
  }
  return result
}

/** Distinct team_member_ids actually mentioned in `text`. */
export function extractMentionIds(
  text: string,
  members: MentionMember[],
): string[] {
  const ids = new Set<string>()
  for (const t of tokenizeMentions(text, members)) {
    if (t.kind === "mention") ids.add(t.member.id)
  }
  return Array.from(ids)
}

/**
 * Given a textarea value and the current caret position, detect whether
 * the user is currently composing a mention (i.e. an `@` immediately
 * preceding the caret with no whitespace in between). Returns the start
 * index of the `@` and the partial query the user has typed so far, or
 * null if not in mention context. Used by `<MentionTextarea>` to drive
 * the picker popover.
 */
export function detectActiveMentionToken(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  // Scan backwards from caret to find an `@`. Bail if we cross a
  // whitespace, newline, or another `@` first — those terminate any
  // possible mention token.
  for (let i = caret - 1; i >= 0; i--) {
    const c = text[i]
    if (c === "@") {
      // Must be at start-of-string or preceded by whitespace.
      if (i === 0 || /\s/.test(text[i - 1])) {
        const query = text.slice(i + 1, caret)
        // Reject if the partial token contains anything outside the
        // allowed mention character class (so typing "@foo!" closes
        // the picker instead of showing nonsense matches).
        if (query === "" || /^[A-Za-z][\w'.\-]*(?: [A-Za-z][\w'.\-]*)?$/.test(query)) {
          return { start: i, query }
        }
        return null
      }
      return null
    }
    if (c === "\n" || c === "\r") return null
    // A space before another non-space + `@` is fine; we keep scanning.
  }
  return null
}

/**
 * Filter the directory by a partial query, ranked best-match first.
 * Used by the picker popover. Matching strategy:
 *   - first_name `startsWith` query (highest priority — what people type)
 *   - full_name  `startsWith` query
 *   - full_name  `includes`   query (fallback)
 * Members are deduped and capped at `limit` (default 8).
 */
export function searchMembers(
  query: string,
  members: MentionMember[],
  limit = 8,
): MentionMember[] {
  const q = query.trim().toLowerCase()
  if (!q) return members.slice(0, limit)

  const seen = new Set<string>()
  const out: MentionMember[] = []
  const push = (m: MentionMember) => {
    if (!seen.has(m.id)) {
      seen.add(m.id)
      out.push(m)
    }
  }

  for (const m of members) {
    if ((m.first_name || "").toLowerCase().startsWith(q)) push(m)
    if (out.length >= limit) return out
  }
  for (const m of members) {
    if ((m.full_name || "").toLowerCase().startsWith(q)) push(m)
    if (out.length >= limit) return out
  }
  for (const m of members) {
    if ((m.full_name || "").toLowerCase().includes(q)) push(m)
    if (out.length >= limit) return out
  }
  return out
}
