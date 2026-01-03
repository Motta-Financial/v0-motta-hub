import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

// Create Supabase admin client with service role key for user management
function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables")
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// Generate a secure temporary password
function generateTempPassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%"
  let password = ""
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const dryRun = searchParams.get("dryRun") === "true"
    const activeOnly = searchParams.get("activeOnly") !== "false" // Default to active only

    const supabase = createAdminClient()

    // Get team members without auth_user_id
    let query = supabase
      .from("team_members")
      .select("id, full_name, email, is_active, auth_user_id")
      .is("auth_user_id", null)

    // Filter to active members only by default
    if (activeOnly) {
      query = query.eq("is_active", true)
    }

    // Exclude system accounts
    query = query.not("email", "ilike", "%@karbonhq.com").not("full_name", "eq", "Motta Financial")

    const { data: teamMembers, error: fetchError } = await query.order("full_name")

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!teamMembers || teamMembers.length === 0) {
      return NextResponse.json({
        message: "All team members already have auth accounts or no eligible members found",
        created: 0,
      })
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        message: `Would create ${teamMembers.length} auth users`,
        teamMembers: teamMembers.map((m) => ({
          id: m.id,
          name: m.full_name,
          email: m.email,
          isActive: m.is_active,
        })),
      })
    }

    const results: {
      success: Array<{ name: string; email: string; tempPassword: string }>
      failed: Array<{ name: string; email: string; error: string }>
    } = {
      success: [],
      failed: [],
    }

    // Create auth users for each team member
    for (const member of teamMembers) {
      if (!member.email) {
        results.failed.push({
          name: member.full_name,
          email: "N/A",
          error: "No email address",
        })
        continue
      }

      const tempPassword = generateTempPassword()

      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: member.email,
        password: tempPassword,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          full_name: member.full_name,
          team_member_id: member.id,
        },
      })

      if (authError) {
        // Check if user already exists
        if (authError.message.includes("already been registered")) {
          // Try to get existing user
          const { data: existingUsers } = await supabase.auth.admin.listUsers()
          const existingUser = existingUsers?.users?.find((u) => u.email?.toLowerCase() === member.email.toLowerCase())

          if (existingUser) {
            // Link existing user
            const { error: updateError } = await supabase
              .from("team_members")
              .update({ auth_user_id: existingUser.id })
              .eq("id", member.id)

            if (updateError) {
              results.failed.push({
                name: member.full_name,
                email: member.email,
                error: `User exists but failed to link: ${updateError.message}`,
              })
            } else {
              results.success.push({
                name: member.full_name,
                email: member.email,
                tempPassword: "(existing user - no password change)",
              })
            }
          } else {
            results.failed.push({
              name: member.full_name,
              email: member.email,
              error: authError.message,
            })
          }
        } else {
          results.failed.push({
            name: member.full_name,
            email: member.email,
            error: authError.message,
          })
        }
        continue
      }

      if (authData.user) {
        // Update team_members with auth_user_id
        const { error: updateError } = await supabase
          .from("team_members")
          .update({ auth_user_id: authData.user.id })
          .eq("id", member.id)

        if (updateError) {
          results.failed.push({
            name: member.full_name,
            email: member.email,
            error: `Auth user created but failed to link: ${updateError.message}`,
          })
        } else {
          results.success.push({
            name: member.full_name,
            email: member.email,
            tempPassword: tempPassword,
          })
        }
      }
    }

    return NextResponse.json({
      message: `Created ${results.success.length} auth users, ${results.failed.length} failed`,
      success: results.success,
      failed: results.failed,
      note: "IMPORTANT: Save the temporary passwords! Users should change their password on first login.",
    })
  } catch (error) {
    console.error("Error setting up auth users:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to setup auth users" },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()

    // Get team members with their auth status
    const { data: teamMembers, error } = await supabase
      .from("team_members")
      .select("id, full_name, email, is_active, auth_user_id")
      .order("full_name")

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const withAuth = teamMembers?.filter((m) => m.auth_user_id) || []
    const withoutAuth = teamMembers?.filter((m) => !m.auth_user_id) || []

    return NextResponse.json({
      total: teamMembers?.length || 0,
      withAuthAccount: withAuth.length,
      withoutAuthAccount: withoutAuth.length,
      members: teamMembers?.map((m) => ({
        id: m.id,
        name: m.full_name,
        email: m.email,
        isActive: m.is_active,
        hasAuthAccount: !!m.auth_user_id,
        authUserId: m.auth_user_id,
      })),
    })
  } catch (error) {
    console.error("Error fetching auth status:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch auth status" },
      { status: 500 },
    )
  }
}
