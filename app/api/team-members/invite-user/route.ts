import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { sendEmail, buildPasswordResetEmailHtml } from "@/lib/email"

/**
 * POST /api/team-members/invite-user
 * Body: { action: 'invite' | 'reset_password', users: TeamMemberInput[] }
 *
 * Admin-only. Sends recovery / invitation links via Resend, with a recovery
 * `token_hash` minted by Supabase admin.generateLink(). The email link points
 * at /auth/confirm which calls verifyOtp() and lands the user on
 * /auth/reset-password with a real session cookie.
 *
 * Why we don't rely on Supabase's built-in email sender:
 *   - admin.generateLink() does NOT send the email — it only returns the link.
 *   - inviteUserByEmail() DOES send via Supabase SMTP, but the link Supabase
 *     bakes in depends on the project's email-template configuration AND on
 *     PKCE code-verifier cookies that don't survive cross-device opens.
 * Resend gives us delivery we control end-to-end.
 */

interface UserInput {
  email: string
  full_name?: string | null
  role?: string | null
  department?: string | null
  team_member_id?: string | null
}

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables")
  }

  return createSupabaseAdminClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function resolveSiteUrl(request: NextRequest): string {
  const origin = request.headers.get("origin")
  if (origin) return origin.replace(/\/$/, "")
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_BASE_URL
  if (envUrl) {
    const normalized = envUrl.startsWith("http") ? envUrl : `https://${envUrl}`
    return normalized.replace(/\/$/, "")
  }
  return "https://mottahub-motta.vercel.app"
}

/**
 * Build the user-facing confirmation URL we send by email.
 * Always points at /auth/confirm so verifyOtp() runs on our server.
 */
function buildActionUrl(siteUrl: string, tokenHash: string, mode: "recovery" | "invite") {
  const url = new URL(`${siteUrl}/auth/confirm`)
  url.searchParams.set("token_hash", tokenHash)
  url.searchParams.set("type", mode)
  url.searchParams.set("next", "/auth/reset-password")
  return url.toString()
}

async function findExistingAuthUser(admin: ReturnType<typeof createAdminClient>, email: string) {
  // listUsers paginates; for now we have <500 users so a single page is fine.
  const lower = email.toLowerCase()
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) return null
  return data.users.find((u) => u.email?.toLowerCase() === lower) ?? null
}

export async function POST(request: NextRequest) {
  try {
    // Caller must be a logged-in user (middleware already enforces auth, but
    // we defensively re-check so this can't be hit unauthenticated even if
    // middleware config drifts).
    const serverSupabase = await createServerClient()
    const {
      data: { user: caller },
      error: authError,
    } = await serverSupabase.auth.getUser()

    if (authError || !caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { action, users }: { action: "invite" | "reset_password"; users: UserInput[] } = body

    if (!action || !users || !Array.isArray(users) || users.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields: action ('invite' | 'reset_password'), users (array)" },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    const siteUrl = resolveSiteUrl(request)

    const results: {
      sent: Array<{ email: string; full_name: string; action: string }>
      failed: Array<{ email: string; error: string }>
    } = { sent: [], failed: [] }

    for (const userEntry of users) {
      const { email, full_name, role, department, team_member_id } = userEntry

      if (!email) {
        results.failed.push({ email: "N/A", error: "No email address provided" })
        continue
      }

      const displayName = full_name || email.split("@")[0]

      try {
        if (action === "invite") {
          // 1. Make sure an auth user exists. If not, create one (no email
          //    sent — we'll send our own Resend invite below).
          let authUser = await findExistingAuthUser(admin, email)

          if (!authUser) {
            const { data: created, error: createErr } = await admin.auth.admin.createUser({
              email,
              email_confirm: true, // Trust the admin invite; no separate confirm email.
              user_metadata: {
                full_name: displayName,
                team_member_id: team_member_id || null,
              },
            })
            if (createErr || !created.user) {
              results.failed.push({
                email,
                error: createErr?.message || "Could not create auth user",
              })
              continue
            }
            authUser = created.user
          }

          // 2. Link / create the team_members row.
          if (team_member_id) {
            await admin
              .from("team_members")
              .update({ auth_user_id: authUser.id })
              .eq("id", team_member_id)
          } else {
            // No team_member_id provided — only insert a new row if one
            // doesn't already exist for this email (avoid duplicates).
            const { data: existingTm } = await admin
              .from("team_members")
              .select("id, auth_user_id")
              .ilike("email", email)
              .maybeSingle()

            if (existingTm) {
              if (!existingTm.auth_user_id) {
                await admin
                  .from("team_members")
                  .update({ auth_user_id: authUser.id })
                  .eq("id", existingTm.id)
              }
            } else {
              const nameParts = (displayName || "").split(" ")
              const firstName = nameParts[0] || email.split("@")[0]
              const lastName = nameParts.slice(1).join(" ") || ""
              const { error: insertErr } = await admin.from("team_members").insert({
                email,
                first_name: firstName,
                last_name: lastName,
                full_name: displayName,
                auth_user_id: authUser.id,
                role: role || "Team Member",
                department: department || "Unassigned",
                is_active: true,
              })
              if (insertErr) {
                console.warn("[invite-user] team_member insert failed:", insertErr.message)
              }
            }
          }

          // 3. Generate an invite token_hash and email it via Resend.
          //    Use type='recovery' so the user lands on /auth/reset-password
          //    to set their first password. (Supabase's 'invite' type would
          //    work too but recovery is identical from the user's perspective
          //    and we already have the recovery handler wired up.)
          const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
            type: "recovery",
            email,
            options: {
              redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/auth/reset-password")}`,
            },
          })

          if (linkErr || !linkData?.properties?.hashed_token) {
            results.failed.push({
              email,
              error: linkErr?.message || "Could not generate invite link",
            })
            continue
          }

          const actionUrl = buildActionUrl(siteUrl, linkData.properties.hashed_token, "recovery")
          const html = buildPasswordResetEmailHtml({
            recipientName: displayName,
            actionUrl,
            mode: "invite",
            expiresInHours: 24,
          })

          const sendResult = await sendEmail({
            to: email,
            subject: "You're invited to Motta Hub",
            html,
          })

          if (!sendResult.success) {
            results.failed.push({
              email,
              error: `Auth account ready but invite email failed: ${sendResult.error}`,
            })
            continue
          }

          results.sent.push({ email, full_name: displayName, action: "invite_sent" })
        } else if (action === "reset_password") {
          // Make sure the auth user exists; if not, surface a clean error
          // instead of silently sending a "reset" for a non-existent account.
          const authUser = await findExistingAuthUser(admin, email)
          if (!authUser) {
            results.failed.push({
              email,
              error:
                "No auth account found for this email. Use 'Send Invite' to create the account first.",
            })
            continue
          }

          const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
            type: "recovery",
            email,
            options: {
              redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/auth/reset-password")}`,
            },
          })

          if (linkErr || !linkData?.properties?.hashed_token) {
            results.failed.push({
              email,
              error: linkErr?.message || "Could not generate reset link",
            })
            continue
          }

          const actionUrl = buildActionUrl(siteUrl, linkData.properties.hashed_token, "recovery")
          const html = buildPasswordResetEmailHtml({
            recipientName: displayName,
            actionUrl,
            mode: "reset",
            expiresInHours: 1,
          })

          const sendResult = await sendEmail({
            to: email,
            subject: "Reset your Motta Hub password",
            html,
          })

          if (!sendResult.success) {
            results.failed.push({
              email,
              error: `Reset email failed: ${sendResult.error}`,
            })
            continue
          }

          results.sent.push({ email, full_name: displayName, action: "reset_password_sent" })
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
