/**
 * Tax client relationship — utilities for normalizing identifiers and
 * computing fuzzy name similarity. These are intentionally simple and
 * deterministic so the scorer is reproducible.
 */

const NAME_NOISE = new Set([
  "the",
  "and",
  "of",
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "llc",
  "lp",
  "llp",
  "pllc",
  "ltd",
  "limited",
  "pa",
  "pc",
  "psc",
  "trust",
  "estate",
  "dba",
])

/** Strip non-digits. Useful for EIN/SSN comparison. Returns null if blank. */
export function digitsOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const d = value.replace(/\D+/g, "")
  return d.length === 0 ? null : d
}

/** Last 4 digits, or null if fewer than 4 digits available. */
export function last4(value: string | null | undefined): string | null {
  const d = digitsOnly(value)
  if (!d || d.length < 4) return null
  return d.slice(-4)
}

/**
 * Normalize a name for matching: lowercase, strip punctuation, drop
 * common entity-suffix noise tokens, collapse whitespace. Returns
 * `null` if everything is noise (e.g. just "LLC").
 */
export function normalizeName(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value
    .toLowerCase()
    .replace(/[.,'"\-_/\\&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return null
  const tokens = cleaned.split(" ").filter((t) => t.length > 0 && !NAME_NOISE.has(t))
  if (tokens.length === 0) return null
  return tokens.join(" ")
}

/**
 * Token-set Jaccard similarity. Cheap, dependency-free, and good
 * enough at distinguishing "Acme Holdings" vs "Acme Holdings LLC" vs
 * "Acme Holdings of Texas" without false-positiving "Smith Family" vs
 * "Smith Construction".
 */
export function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const tokensA = new Set(a.split(" "))
  const tokensB = new Set(b.split(" "))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let intersection = 0
  for (const t of tokensA) if (tokensB.has(t)) intersection++
  const union = tokensA.size + tokensB.size - intersection
  return intersection / union
}

/** Returns true when both EIN/SSN fully match (digit-normalized). */
export function tinExact(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digitsOnly(a)
  const db = digitsOnly(b)
  if (!da || !db) return false
  return da === db
}
