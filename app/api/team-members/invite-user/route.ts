import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
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

// POST: Invite users via SMTP email (uses inviteUserByEmail)
export async function POST(request: Request) {
  try {
    // Verify the calling user is authenticated
    const serverSupabase = await createServerClient()
    const {
      data: { user: caller },
      error: authError,
    } = await serverSupabase.auth.getUser()

    if (authError || !caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { action, users } = body

    if (!action || !users || !Array.isArray(users) || users.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields: action ('invite' | 'reset_password'), users (array)" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    const results: {
      sent: Array<{ email: string; full_name: string; action: string }>
      failed: Array<{ email: string; error: string }>
    } = {
      sent: [],
      failed: [],
    }

    for (const userEntry of users) {
      const { email, full_name, role, department, team_member_id } = userEntry

      if (!email) {
        results.failed.push({ email: "N/A", error: "No email address provided" })
        continue
      }

      try {
        if (action === "invite") {
          // Use inviteUserByEmail - sends a branded invite via your custom SMTP
          // This creates the auth user AND sends the invite email in one step
          const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
            data: {
              full_name: full_name || email.split("@")[0],
              team_member_id: team_member_id || null,
            },
            redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://mottahub-motta.vercel.app"}/auth/callback?type=recovery`,
          })

          if (inviteError) {
            // If user already exists, we can still send a password reset
            if (inviteError.message.includes("already been registered") || inviteError.message.includes("already exists")) {
              // User exists - link them if there's a team_member_id
              if (team_member_id) {
                const existingUsers = await supabase.auth.admin.listUsers()
                const existingUser = existingUsers.data?.users?.find(
                  (u) => u.email?.toLowerCase() === email.toLowerCase(),
                )
                if (existingUser) {
                  await supabase
                    .from("team_members")
                    .update({ auth_user_id: existingUser.id })
                    .eq("id", team_member_id)

                  // Send them a password reset instead
                  const { error: resetError } = await supabase.auth.admin.generateLink({
                    type: "recovery",
                    email: email,
                    options: {
                      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://mottahub-motta.vercel.app"}/auth/callback?type=recovery`,
                    },
                  })

                  if (resetError) {
                    results.failed.push({ email, error: `User exists, linked, but reset email failed: ${resetError.message}` })
                  } else {
                    results.sent.push({ email, full_name: full_name || email, action: "linked_and_reset_sent" })
                  }
                } else {
                  results.failed.push({ email, error: "User exists but could not be found to link" })
                }
              } else {
                results.failed.push({ email, error: `User already registered. Use 'Send Password Reset' instead.` })
              }
            } else {
              results.failed.push({ email, error: inviteError.message })
            }
            continue
          }

          // Successfully invited - link the new auth user to team_members
          if (inviteData.user && team_member_id) {
            await supabase
              .from("team_members")
              .update({ auth_user_id: inviteData.user.id })
              .eq("id", team_member_id)
          } else if (inviteData.user && !team_member_id) {
            // Create a team_member record for the new user
            const nameParts = (full_name || "").split(" ")
            const firstName = nameParts[0] || email.split("@")[0]
            const lastName = nameParts.slice(1).join(" ") || ""

            const { error: insertError } = await supabase.from("team_members").insert({
              email: email,
              first_name: firstName,
              last_name: lastName,
              full_name: full_name || firstName,
              auth_user_id: inviteData.user.id,
              role: role || "Team Member",
              department: department || "Unassigned",
              is_active: true,
            })

            if (insertError) {
              // Still count as sent since the invite went out
              results.sent.push({ email, full_name: full_name || email, action: "invite_sent_but_team_record_failed" })
              continue
            }
          }

          results.sent.push({ email, full_name: full_name || email, action: "invite_sent" })
        } else if (action === "reset_password") {
          // Send a password reset email via SMTP
          const { error: resetError } = await supabase.auth.admin.generateLink({
            type: "recovery",
            email: email,
            options: {
              redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://mottahub-motta.vercel.app"}/auth/callback?type=recovery`,
            },
          })

          if (resetError) {
            results.failed.push({ email, error: resetError.message })
          } else {
            results.sent.push({ email, full_name: full_name || email, action: "reset_password_sent" })
          }
        } else {
          results.failed.push({ email, error: `Unknown action: ${action}` })
        }
      } catch (err) {
        results.failed.push({
          email,
          error: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }

    return NextResponse.json({
      message: `Processed ${users.length} users: ${results.sent.length} sent, ${results.failed.length} failed`,
      sent: results.sent,
      failed: results.failed,
    })
  } catch (error) {
    console.error("Error in invite-user:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process invite" },
      { status: 500 },
    )
  }
}
