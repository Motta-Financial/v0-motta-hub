/**
 * Motta Hub legacy client ID derivation.
 *
 * Format: STATE_LASTNAME_FIRSTNAME_PHONE4
 * Pattern: ^[A-Z]{2}_[A-Z0-9]+_[A-Z0-9]+_\d{4}$
 *
 * Spec: v0_memories/user/motta-hub-data-model.md
 */

const NAME_SUFFIXES = new Set([
  "JR",
  "SR",
  "II",
  "III",
  "IV",
  "V",
  "MD",
  "PHD",
  "ESQ",
  "CPA",
  "DDS",
  "DO",
])

const US_STATES: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "PUERTO RICO": "PR",
}

const VALID_STATE_CODES = new Set(Object.values(US_STATES))

export const LEGACY_ID_PATTERN = /^[A-Z]{2}_[A-Z0-9]+_[A-Z0-9]+_\d{4}$/

export function isValidLegacyId(value: unknown): value is string {
  return typeof value === "string" && LEGACY_ID_PATTERN.test(value)
}

export function normalizeState(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim().toUpperCase()
  if (!trimmed) return null
  if (VALID_STATE_CODES.has(trimmed)) return trimmed
  if (US_STATES[trimmed]) return US_STATES[trimmed]
  return null
}

/**
 * Strip to digits, drop leading 1 for 11-digit US numbers, return last 4.
 */
export function extractPhone4(input: string | null | undefined): string | null {
  if (!input) return null
  let digits = String(input).replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  if (digits.length < 4) return null
  return digits.slice(-4)
}

/**
 * Format a digit-string-or-arbitrary value as "(XXX) XXX-XXXX" if
 * possible, else return the original input. Storage stays digit-rich.
 */
export function formatPhoneDisplay(input: string | null | undefined): string | null {
  if (!input) return null
  let digits = String(input).replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  if (digits.length !== 10) return input
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * Tokenize a name: strip suffixes, drop single-letter middle initials,
 * uppercase, alphanumerics only.
 */
function tokenizeName(input: string): string[] {
  return input
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/\./g, "").toUpperCase())
    .filter(Boolean)
    .filter((t) => !NAME_SUFFIXES.has(t))
    .filter((t) => !/^[A-Z]$/.test(t)) // single-letter middle initial
    .map((t) => t.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean)
}

export interface LegacyIdInput {
  /** Full display name. Used only when first/last not provided. */
  name?: string | null
  first_name?: string | null
  last_name?: string | null
  state?: string | null
  /** Any phone field — primary, mobile, work, etc. */
  phone?: string | null
}

export interface LegacyIdResult {
  legacy_id: string | null
  /** Why we couldn't derive — empty when legacy_id is set. */
  reasons: string[]
}

/**
 * Pure function: contact-shaped input → legacy ID or null with reasons.
 *
 * Returns null (with reasons populated) for:
 *   - missing/invalid state
 *   - missing/invalid phone (<4 digits)
 *   - unparseable name (no last name)
 */
export function deriveLegacyMottaClientId(input: LegacyIdInput): LegacyIdResult {
  const reasons: string[] = []

  const state = normalizeState(input.state)
  if (!state) reasons.push("state")

  const phone4 = extractPhone4(input.phone)
  if (!phone4) reasons.push("phone")

  // Prefer explicit first/last when both are present.
  let firstName: string | null = null
  let lastName: string | null = null

  const explicitFirst = input.first_name ? tokenizeName(input.first_name).join("") : ""
  const explicitLast = input.last_name ? tokenizeName(input.last_name).join("") : ""

  if (explicitFirst && explicitLast) {
    firstName = explicitFirst
    lastName = explicitLast
  } else if (input.name) {
    const tokens = tokenizeName(input.name)
    if (tokens.length >= 2) {
      firstName = tokens[0]
      lastName = tokens[tokens.length - 1]
    } else if (tokens.length === 1 && explicitFirst) {
      // Have a first but the full-name only had one token — bail.
      reasons.push("name")
    } else {
      reasons.push("name")
    }
  } else if (explicitFirst && !explicitLast) {
    reasons.push("name")
  } else if (!explicitFirst && explicitLast) {
    reasons.push("name")
  } else {
    reasons.push("name")
  }

  if (!state || !phone4 || !firstName || !lastName) {
    return { legacy_id: null, reasons }
  }

  const candidate = `${state}_${lastName}_${firstName}_${phone4}`

  if (!LEGACY_ID_PATTERN.test(candidate)) {
    return { legacy_id: null, reasons: [...reasons, "pattern"] }
  }

  return { legacy_id: candidate, reasons: [] }
}
