/**
 * Team member utilities for user identification in API routes.
 */

import { createAdminClient } from "@/lib/supabase/server"

export interface TeamMember {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
  role: string | null
  is_active: boolean
}

/**
 * Get team member by Supabase auth user ID.
 * Falls back to email lookup for legacy accounts.
 */
export async function getTeamMemberByAuthId(
  authUserId: string,
  email?: string | null
): Promise<TeamMember | null> {
  const supabase = createAdminClient()

  // Try by auth_user_id first
  const { data: byAuth } = await supabase
    .from("team_members")
    .select("id, email, full_name, avatar_url, role, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle()

  if (byAuth) return byAuth

  // Fall back to email lookup
  if (email) {
    const { data: byEmail } = await supabase
      .from("team_members")
      .select("id, email, full_name, avatar_url, role, is_active")
      .eq("email", email)
      .maybeSingle()

    if (byEmail) return byEmail
  }

  return null
}

/**
 * Get team member by their Hub team_members.id
 */
export async function getTeamMemberById(
  teamMemberId: string
): Promise<TeamMember | null> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from("team_members")
    .select("id, email, full_name, avatar_url, role, is_active")
    .eq("id", teamMemberId)
    .maybeSingle()

  return data
}
