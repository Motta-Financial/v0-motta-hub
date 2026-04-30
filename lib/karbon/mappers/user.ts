/**
 * Pure mapper: Karbon User JSON -> Supabase team_members row.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

export function mapKarbonUserToSupabase(user: any) {
  const firstName = user.FirstName || null
  const lastName = user.LastName || null
  const fullName = user.FullName || `${firstName || ""} ${lastName || ""}`.trim() || "Unknown User"
  const userKey = user.UserKey || user.MemberKey

  return {
    karbon_user_key: userKey,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    email: user.EmailAddress || user.Email || null,
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
