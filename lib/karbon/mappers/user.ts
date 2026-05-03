/**
 * Pure mapper: Karbon User JSON -> Supabase team_members row.
 *
 * IMPORTANT: Karbon's /Users list endpoint returns ONLY these fields:
 *   - Id (the user key, NOT "UserKey")
 *   - Name (a single full-name string, e.g. "Andrew Gianares")
 *   - EmailAddress
 *
 * It does NOT return FirstName, LastName, FullName, UserKey, Title, Role,
 * Department, PhoneNumber, AvatarUrl, etc. We derive first/last names by
 * splitting Name on whitespace, with email fallback for the local-only
 * accounts (Caleb, Amy, etc.) that aren't provisioned in Karbon.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

function splitName(name: string | null | undefined): { first: string | null; last: string | null } {
  if (!name) return { first: null, last: null }
  const trimmed = name.trim()
  if (!trimmed) return { first: null, last: null }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

/**
 * Derive a display name from an email like "Amy.Sparaco@MottaFinancial.com"
 * -> "Amy Sparaco". Used as a last-resort fallback when Karbon has no
 * record for this user but their email follows the firstname.lastname
 * convention.
 */
function deriveNameFromEmail(email: string | null | undefined): {
  first: string | null
  last: string | null
  full: string | null
} {
  if (!email) return { first: null, last: null, full: null }
  const local = email.split("@")[0]
  if (!local) return { first: null, last: null, full: null }
  const parts = local
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
  if (parts.length === 0) return { first: null, last: null, full: null }
  if (parts.length === 1) return { first: parts[0], last: null, full: parts[0] }
  return {
    first: parts[0],
    last: parts.slice(1).join(" "),
    full: parts.join(" "),
  }
}

export function mapKarbonUserToSupabase(user: any) {
  // Karbon list endpoint uses `Id`; legacy code occasionally references the
  // never-actually-returned `UserKey`/`MemberKey`, so we check those last.
  const userKey: string | null = user.Id || user.UserKey || user.MemberKey || null

  const email: string | null = user.EmailAddress || user.Email || null

  // Karbon list endpoint returns a single `Name` field. Detail or other
  // shapes may include explicit FirstName/LastName/FullName, so we look for
  // those first when present.
  const explicitFull: string | null = user.FullName || user.Name || null
  const fromName = splitName(explicitFull)
  const fromEmail = deriveNameFromEmail(email)

  const firstName = user.FirstName || fromName.first || fromEmail.first || null
  const lastName = user.LastName || fromName.last || fromEmail.last || null

  const computedFull = [firstName, lastName].filter(Boolean).join(" ").trim()
  const fullName = explicitFull?.trim() || computedFull || fromEmail.full || email || null

  return {
    karbon_user_key: userKey,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    email,
    title: user.Title || user.JobTitle || null,
    role: user.Role || user.UserRole || null,
    department: user.Department || null,
    phone_number: user.PhoneNumber || user.WorkPhone || null,
    mobile_number: user.MobileNumber || user.Mobile || null,
    avatar_url: user.AvatarUrl || user.ProfileImageUrl || null,
    timezone: user.TimeZone || user.Timezone || null,
    start_date: user.StartDate ? String(user.StartDate).split("T")[0] : null,
    is_active: user.IsActive !== false,
    karbon_url: userKey ? `${KARBON_TENANT_PREFIX}/team/${userKey}` : null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
