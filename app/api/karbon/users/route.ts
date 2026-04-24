import { type NextRequest, NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"

function getSupabaseClient() {
  return tryCreateAdminClient()
}

function mapKarbonUserToSupabase(user: any) {
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
    start_date: user.StartDate ? user.StartDate.split("T")[0] : null,
    is_active: user.IsActive !== false,
    karbon_url: userKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/team/${userKey}` : null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!process.env.KARBON_BEARER_TOKEN || !process.env.KARBON_ACCESS_KEY) {
      return NextResponse.json({ error: "Missing Karbon API credentials" }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const importToSupabase = searchParams.get("import") === "true"

    const response = await fetch("https://api.karbonhq.com/v3/Users", {
      headers: {
        Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
        AccessKey: process.env.KARBON_ACCESS_KEY,
      },
    })

    if (!response.ok) {
      throw new Error(`Karbon API error: ${response.status}`)
    }

    const data = await response.json()
    const usersArray = data.value || []

    let importResult = null
    if (importToSupabase) {
      const supabase = getSupabaseClient()
      if (!supabase) {
        importResult = { error: "Supabase not configured" }
      } else {
        let synced = 0
        let updated = 0
        let created = 0
        let errors = 0
        const errorDetails: string[] = []

        const { data: existingMembers } = await supabase
          .from("team_members")
          .select("id, email, karbon_user_key, full_name")

        const existingByEmail = new Map(
          (existingMembers || []).filter((m: any) => m.email).map((m: any) => [m.email.toLowerCase(), m]),
        )
        const existingByKarbonKey = new Map(
          (existingMembers || []).filter((m: any) => m.karbon_user_key).map((m: any) => [m.karbon_user_key, m]),
        )

        for (const user of usersArray) {
          const mapped = mapKarbonUserToSupabase(user)
          const email = mapped.email?.toLowerCase()

          // Check if user exists by karbon_user_key or email
          const existingByKey = mapped.karbon_user_key ? existingByKarbonKey.get(mapped.karbon_user_key) : null
          const existingByEmailMatch = email ? existingByEmail.get(email) : null
          const existing = existingByKey || existingByEmailMatch

          try {
            if (existing) {
              // Update existing record
              const { error: updateError } = await supabase
                .from("team_members")
                .update({
                  ...mapped,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existing.id)

              if (updateError) {
                errors++
                errorDetails.push(`Update ${mapped.full_name}: ${updateError.message}`)
              } else {
                updated++
                synced++
              }
            } else {
              // Insert new record
              const { error: insertError } = await supabase.from("team_members").insert({
                ...mapped,
                created_at: new Date().toISOString(),
              })

              if (insertError) {
                errors++
                errorDetails.push(`Insert ${mapped.full_name}: ${insertError.message}`)
              } else {
                created++
                synced++
              }
            }
          } catch (err) {
            errors++
            errorDetails.push(`${mapped.full_name}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        importResult = {
          success: errors === 0,
          synced,
          updated,
          created,
          errors,
          total: usersArray.length,
          errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 10) : undefined,
        }
      }
    }

    const allUsers = usersArray.map((user: any) => ({
      userKey: user.UserKey || user.MemberKey,
      fullName: user.FullName || `${user.FirstName || ""} ${user.LastName || ""}`.trim(),
      firstName: user.FirstName,
      lastName: user.LastName,
      email: user.EmailAddress || user.Email,
      title: user.Title || user.JobTitle,
      department: user.Department,
      role: user.Role || user.UserRole,
      isActive: user.IsActive !== false,
      avatarUrl: user.AvatarUrl || user.ProfileImageUrl,
      phoneNumber: user.PhoneNumber || user.WorkPhone,
      mobileNumber: user.MobileNumber || user.Mobile,
      timezone: user.TimeZone || user.Timezone,
      startDate: user.StartDate,
      lastLoginDate: user.LastLoginDate,
      createdDate: user.CreatedDate,
    }))

    return NextResponse.json({
      users: allUsers,
      count: allUsers.length,
      activeCount: allUsers.filter((u: any) => u.isActive).length,
      inactiveCount: allUsers.filter((u: any) => !u.isActive).length,
      importResult,
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon users:", error)
    return NextResponse.json(
      { error: "Failed to fetch users", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
