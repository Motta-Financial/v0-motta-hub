/**
 * Canonical ProConnect-active preparer registry.
 *
 * Source of truth: ProConnect's "Average time spent in return per user"
 * report for tax year 2025 (11 users, screenshotted 2026-05-25). Anyone
 * who opened, edited, reviewed, or signed a ProConnect return in 2025
 * appears in this report — so this list is exhaustive for "people whose
 * GUIDs we'd ever need to map" for the current season.
 *
 * Why this exists:
 *  - ProConnect's API does NOT expose user names or emails on
 *    `assigneeProfileId`, so the Karbon co-occurrence suggester
 *    (`proconnect-karbon-suggester.ts`) was returning false positives
 *    where an accounting-side teammate happened to share a client +
 *    tax-year with a ProConnect engagement. Filtering Karbon hints
 *    against this registry kills that noise.
 *  - `team_members.full_name` doesn't always match how someone appears
 *    in ProConnect (e.g. Micaela is "Palacios" in the Hub but
 *    "Verastegui" in ProConnect). Aliases let both spellings resolve
 *    to the same teammate without renaming Hub records.
 *
 * UPDATE THIS LIST when ProConnect's report changes (new hire, name
 * change, departure). The `returnsWorkedOn2025` numbers are advisory —
 * we never auto-link by volume because ProConnect's "worked on" count
 * is not the same shape as our `assigneeProfileId` count (worked-on
 * = anyone who touched the return; assignee = single primary). They're
 * useful as UI hints next to a candidate row.
 */

export type CanonicalPreparer = {
  /** Canonical full name as it appears in ProConnect's report. */
  canonicalName: string
  /** Other spellings that may appear in Karbon, email signatures, the
   *  Hub `team_members.full_name`, etc. Used by the matcher to resolve
   *  any of these strings back to this preparer. ALL aliases must be
   *  in `lower-case-no-punctuation` form. */
  aliases: string[]
  /** ProConnect's "Returns worked on" count for TY2025 — used as an
   *  advisory hint in the UI, never as an auto-link signal. */
  returnsWorkedOn2025: number
  /** Average time spent per return (minutes), TY2025. Pure UI hint. */
  avgMinutesPerReturn2025: number
  /** "firm" = a non-personal account (e.g. "Motta Financial" in
   *  ProConnect represents the firm-level admin user, not a person).
   *  Surfaced as a distinct badge in the mapping UI. */
  kind?: "person" | "firm"
}

export const CANONICAL_PREPARERS_TY2025: CanonicalPreparer[] = [
  {
    canonicalName: "Mark Dwyer",
    aliases: ["mark dwyer", "m dwyer", "m. dwyer"],
    returnsWorkedOn2025: 202,
    avgMinutesPerReturn2025: 170,
  },
  {
    // Micaela appears as "Verastegui" in ProConnect but
    // "Palacios" in team_members. Per user instruction, do NOT rename
    // the Hub record — alias map handles both.
    canonicalName: "Micaela Verastegui",
    aliases: [
      "micaela verastegui",
      "micaela palacios",
      "micaela verastegui palacios",
      "micaela palacios verastegui",
    ],
    returnsWorkedOn2025: 139,
    avgMinutesPerReturn2025: 225,
  },
  {
    canonicalName: "Andrew Gianares",
    aliases: ["andrew gianares", "andrew j gianares", "a gianares"],
    returnsWorkedOn2025: 49,
    avgMinutesPerReturn2025: 65,
  },
  {
    canonicalName: "Dat Le",
    aliases: ["dat le", "d le"],
    returnsWorkedOn2025: 268,
    avgMinutesPerReturn2025: 110,
  },
  {
    canonicalName: "Caroline Buckley",
    aliases: ["caroline buckley", "c buckley"],
    returnsWorkedOn2025: 5,
    avgMinutesPerReturn2025: 1,
  },
  {
    canonicalName: "Matthew Pereira",
    aliases: ["matthew pereira", "matt pereira", "m pereira"],
    returnsWorkedOn2025: 2,
    avgMinutesPerReturn2025: 3,
  },
  {
    canonicalName: "Motta Financial",
    aliases: ["motta financial", "motta financial llc", "motta"],
    returnsWorkedOn2025: 43,
    avgMinutesPerReturn2025: 69,
    kind: "firm",
  },
  {
    canonicalName: "Thameem JA",
    aliases: ["thameem ja", "thameem", "thameem j a"],
    returnsWorkedOn2025: 8,
    avgMinutesPerReturn2025: 14,
  },
  {
    canonicalName: "Sophia Echevarria",
    aliases: ["sophia echevarria", "s echevarria"],
    returnsWorkedOn2025: 91,
    avgMinutesPerReturn2025: 4,
  },
  {
    canonicalName: "Ganesh Vasan",
    aliases: ["ganesh vasan", "g vasan"],
    returnsWorkedOn2025: 10,
    avgMinutesPerReturn2025: 9,
  },
  {
    canonicalName: "Grace Cha",
    aliases: ["grace cha", "g cha"],
    returnsWorkedOn2025: 129,
    avgMinutesPerReturn2025: 12,
  },
]

/** Lower-cased no-punctuation normalize, mirroring the suggester. */
function normName(s: string | null | undefined): string {
  if (!s) return ""
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Resolve any name spelling (from Karbon, ProConnect, an email
 * signature, etc.) to its canonical preparer entry, or null if the
 * name doesn't belong to a known ProConnect user.
 */
export function resolveCanonicalPreparer(
  name: string | null | undefined,
): CanonicalPreparer | null {
  const n = normName(name)
  if (!n) return null
  for (const p of CANONICAL_PREPARERS_TY2025) {
    if (p.aliases.includes(n)) return p
    if (normName(p.canonicalName) === n) return p
  }
  return null
}

/**
 * Returns true when the name (in any spelling) is a known ProConnect
 * preparer. Used by the Karbon suggester to filter out false-positive
 * candidates whose Karbon co-occurrence is high but who never actually
 * touch ProConnect returns (typical for accounting-only staff sharing a
 * client roster).
 */
export function isCanonicalPreparer(
  name: string | null | undefined,
): boolean {
  return resolveCanonicalPreparer(name) !== null
}

/**
 * Returns ALL aliases for a teammate's full_name as it appears in the
 * Hub — e.g. "Micaela Palacios" returns
 * ["micaela palacios", "micaela verastegui", ...]. Used by the
 * string-similarity matcher so the seed-name lookup catches both
 * spellings.
 */
export function aliasesForHubName(
  hubFullName: string | null | undefined,
): string[] {
  const p = resolveCanonicalPreparer(hubFullName)
  if (!p) return []
  return [...new Set([normName(p.canonicalName), ...p.aliases])]
}
