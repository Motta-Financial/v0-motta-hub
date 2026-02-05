import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

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

/**
 * GET: Discover Supabase Auth users who don't have a team_members record yet
 */
export async function GET() {
  try {
    const supabase = createAdminClient()

    // Get all auth users
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers()
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 500 })
    }

    const authUsers = authData?.users || []

    // Get all team members
    const { data: teamMembers, error: tmError } = await supabase
      .from("team_members")
      .select("id, email, full_name, auth_user_id, is_active")

    if (tmError) {
      return NextResponse.json({ error: tmError.message }, { status: 500 })
    }

    // Normalize emails for comparison
    const teamMemberEmails = new Set(
      (teamMembers || []).map((tm) => tm.email.toLowerCase())
    )
    const linkedAuthIds = new Set(
      (teamMembers || []).filter((tm) => tm.auth_user_id).map((tm) => tm.auth_user_id)
    )

    // Find auth users not in team_members (by email) and not already linked
    const unlinkedAuthUsers = authUsers
      .filter((au) => {
        const email = au.email?.toLowerCase() || ""
        return !teamMemberEmails.has(email) && !linkedAuthIds.has(au.id)
      })
      .map((au) => ({
        auth_id: au.id,
        email: au.email || "",
        full_name: au.user_metadata?.full_name || null,
        created_at: au.created_at,
        last_sign_in_at: au.last_sign_in_at,
      }))

    // Find team members who have an auth user but auth_user_id is not set
    const unmatchedTeamMembers = (teamMembers || [])
      .filter((tm) => !tm.auth_user_id && tm.is_active)
      .map((tm) => {
        const matchingAuth = authUsers.find(
          (au) => au.email?.toLowerCase() === tm.email.toLowerCase()
        )
        return {
          team_member_id: tm.id,
          full_name: tm.full_name,
          email: tm.email,
          matching_auth_id: matchingAuth?.id || null,
          has_matching_auth: !!matchingAuth,
        }
      })
      .filter((tm) => tm.has_matching_auth)

    return NextResponse.json({
      unlinked_auth_users: unlinkedAuthUsers,
      unmatched_team_members: unmatchedTeamMembers,
      summary: {
        total_auth_users: authUsers.length,
        total_team_members: (teamMembers || []).length,
        unlinked_auth_users_count: unlinkedAuthUsers.length,
        unmatched_team_members_count: unmatchedTeamMembers.length,
      },
    })
  } catch (error) {
    console.error("Error discovering auth users:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to discover auth users" },
      { status: 500 }
    )
  }
}

/**
 * POST: Add unlinked auth users to team_members and/or link unmatched team members
 * Body: { auth_users_to_add: [{auth_id, email, full_name, role?, department?}], team_members_to_link: [{team_member_id, auth_id}] }
 */
export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const authUsersToAdd = body.auth_users_to_add || []
    const teamMembersToLink = body.team_members_to_link || []

    const results = {
      added: [] as Array<{ email: string; full_name: string; team_member_id: string }>,
      linked: [] as Array<{ email: string; full_name: string; team_member_id: string }>,
      failed: [] as Array<{ email: string; error: string }>,
    }

    // 1. Add new auth users as team members
    for (const user of authUsersToAdd) {
      try {
        // Extract name parts from email or full_name
        const fullName = user.full_name || deriveNameFromEmail(user.email)
        const nameParts = fullName.split(" ")
        const firstName = nameParts[0] || ""
        const lastName = nameParts.slice(1).join(" ") || ""

        const { data: newMember, error: insertError } = await supabase
          .from("team_members")
          .insert({
            email: user.email,
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
            auth_user_id: user.auth_id,
            role: user.role || "Team Member",
            department: user.department || "Unassigned",
            is_active: true,
          })
          .select("id, full_name, email")
          .single()

        if (insertError) {
          results.failed.push({ email: user.email, error: insertError.message })
        } else {
          results.added.push({
            email: newMember.email,
            full_name: newMember.full_name,
            team_member_id: newMember.id,
          })
        }
      } catch (err) {
        results.failed.push({
          email: user.email,
          error: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }

    // 2. Link existing team members to their auth accounts
    for (const link of teamMembersToLink) {
      try {
        const { data: updated, error: updateError } = await supabase
          .from("team_members")
          .update({ auth_user_id: link.auth_id })
          .eq("id", link.team_member_id)
          .select("id, full_name, email")
          .single()

        if (updateError) {
          results.failed.push({
            email: link.email || "unknown",
            error: updateError.message,
          })
        } else {
          results.linked.push({
            email: updated.email,
            full_name: updated.full_name,
            team_member_id: updated.id,
          })
        }
      } catch (err) {
        results.failed.push({
          email: link.email || "unknown",
          error: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }

    return NextResponse.json({
      message: `Added ${results.added.length}, linked ${results.linked.length}, failed ${results.failed.length}`,
      ...results,
    })
  } catch (error) {
    console.error("Error syncing auth users:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync auth users" },
      { status: 500 }
    )
  }
}

/**
 * Derive a display name from an email address
 */
function deriveNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] || ""
  return localPart
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}
