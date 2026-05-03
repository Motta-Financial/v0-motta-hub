import { type NextRequest, NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { mapKarbonUserForSync, mapKarbonUserToSupabase } from "@/lib/karbon/mappers/user"

function getSupabaseClient() {
  return tryCreateAdminClient()
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
              // Update existing record -- ONLY refresh the Karbon-link fields.
              // The platform profile (role, title, department, is_active,
              // names, contact info, manager, start date, avatar, etc.) is
              // managed in-app and must not be clobbered by a sync.
              const syncFields = mapKarbonUserForSync(user)
              const { error: updateError } = await supabase
                .from("team_members")
                .update(syncFields)
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

    // Project the Karbon list response into a stable client-side shape.
    // Karbon's /Users list endpoint returns Id, Name, EmailAddress only —
    // we run it through the shared mapper so first/last names are derived
    // consistently (split on whitespace, with email fallback).
    const allUsers = usersArray.map((user: any) => {
      const mapped = mapKarbonUserToSupabase(user)
      return {
        userKey: mapped.karbon_user_key,
        fullName: mapped.full_name,
        firstName: mapped.first_name,
        lastName: mapped.last_name,
        email: mapped.email,
        title: mapped.title,
        department: mapped.department,
        role: mapped.role,
        isActive: mapped.is_active,
        avatarUrl: mapped.avatar_url,
        phoneNumber: mapped.phone_number,
        mobileNumber: mapped.mobile_number,
        timezone: mapped.timezone,
        startDate: mapped.start_date,
        lastLoginDate: user.LastLoginDate || null,
        createdDate: user.CreatedDate || null,
      }
    })

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
