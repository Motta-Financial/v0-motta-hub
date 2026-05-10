// Dual-strategy auth resolver for the ALFRED public surface.
//
// Browsers running on `alfred.motta.cpa` reach the Hub's APIs in one
// of two ways:
//
//   A. With a Supabase Bearer token in `Authorization: Bearer ...`.
//      This is what the alfred.motta.cpa frontend uses after the user
//      signs in over there with their Hub Supabase credentials.
//
//   B. With a Supabase session cookie scoped to `.motta.cpa`. This
//      happens when the user is already signed into the Hub and the
//      browser ships the cookie cross-subdomain (see
//      lib/supabase/server.ts for the cookie domain config).
//
// In either case we resolve the verified Supabase auth user, then look
// up the matching `team_members` row -- ALFRED's identity scoping (My
// work items / My deadlines, conversation ownership, etc.) is keyed
// off `team_members.id`, NOT `auth.users.id`, so this lookup is the
// canonical translation.
//
// The legacy `currentUser` field on the chat request body is treated
// as an UNTRUSTED hint and discarded here: identity comes only from a
// signature we can verify (cookie or Bearer), never from the body.

import { createAdminClient, createClient } from "@/lib/supabase/server"
import type { SupabaseClient } from "@supabase/supabase-js"

// Mirrors the legacy `CurrentUser` shape consumed by app/api/alfred/chat
// so existing code (identity preamble, getMyWorkItems, etc.) keeps
// working with no further changes.
export interface ResolvedAlfredUser {
  authUserId: string
  teamMemberId: string
  fullName: string | null
  email: string
  role: string | null
  department: string | null
  karbonUserKey: string | null
  /**
   * True only for the singleton ALFRED service account row. Routes can
   * use this to allow / disallow service-account-initiated traffic.
   */
  isServiceAccount: boolean
}

/**
 * Resolve the calling team member from either an `Authorization: Bearer`
 * header (preferred) or the Supabase session cookie. Returns `null`
 * when neither produces a valid auth user, OR when the auth user has
 * no matching `team_members` row.
 *
 * IMPORTANT: never trust the request body for identity. Always call
 * this and act on the returned object.
 */
export async function resolveAlfredUser(
  request: Request,
): Promise<ResolvedAlfredUser | null> {
  // ── Strategy A: Authorization: Bearer ─────────────────────────────
  const authHeader =
    request.headers.get("authorization") || request.headers.get("Authorization")

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token) {
      try {
        // The admin client knows how to validate a JWT against Supabase's
        // auth API via getUser(token). It will return error.user when the
        // token is expired, revoked, or malformed.
        const admin = createAdminClient()
        const { data, error } = await admin.auth.getUser(token)
        if (!error && data?.user) {
          const tm = await loadTeamMember(admin, data.user.id, data.user.email ?? null)
          if (tm) return tm
          // Auth user exists but isn't onboarded into team_members yet.
          // Fall through and try the cookie path -- in practice a
          // cross-domain Bearer call won't have a cookie either, but
          // this keeps the two paths symmetrical.
        }
      } catch {
        // Network / config error talking to Supabase Auth. Fall through
        // to cookie strategy so misconfiguration doesn't take down the
        // legacy logged-in path.
      }
    }
  }

  // ── Strategy B: Supabase session cookie ──────────────────────────
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (!error && data?.user) {
      // We deliberately switch to the admin client for the team_members
      // lookup. RLS on team_members is unrelated to ALFRED scoping and
      // bypassing it here keeps a single shape regardless of strategy.
      const admin = createAdminClient()
      const tm = await loadTeamMember(admin, data.user.id, data.user.email ?? null)
      if (tm) return tm
    }
  } catch {
    // Same rationale as above -- don't bubble infra errors out as 500s.
  }

  return null
}

async function loadTeamMember(
  admin: SupabaseClient,
  authUserId: string,
  email: string | null,
): Promise<ResolvedAlfredUser | null> {
  // Primary key: auth_user_id. This is the link the existing middleware
  // uses for the deactivation check, so we mirror it.
  const primary = await admin
    .from("team_members")
    .select(
      "id, full_name, email, role, title, department, karbon_user_key, is_active, is_service_account",
    )
    .eq("auth_user_id", authUserId)
    .maybeSingle()

  let row = primary.data

  // Fallback: email lookup. team_members.email is canonical and is also
  // what middleware falls back to. Case-insensitive because the
  // `Info@mottafinancial.com` casing varies between Karbon, Auth, and
  // CRM imports.
  if (!row && email) {
    const fallback = await admin
      .from("team_members")
      .select(
        "id, full_name, email, role, title, department, karbon_user_key, is_active, is_service_account",
      )
      .ilike("email", email)
      .maybeSingle()
    row = fallback.data
  }

  if (!row) return null

  return {
    authUserId,
    teamMemberId: row.id,
    fullName: row.full_name ?? null,
    email: row.email,
    // Match the chat client's preference: title (the Karbon-synced job
    // title) wins over `role` (the Hub permission role) for prompt
    // strings shown to ALFRED.
    role: row.title ?? row.role ?? null,
    department: row.department ?? null,
    karbonUserKey: row.karbon_user_key ?? null,
    isServiceAccount: row.is_service_account === true,
  }
}
