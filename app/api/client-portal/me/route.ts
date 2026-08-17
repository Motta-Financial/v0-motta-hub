import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

interface TeamMemberSnapshot {
  karbon_user_key: string
  first_name: string | null
  last_name: string | null
  title: string | null
  role: string | null
  email: string | null
}

/**
 * GET /api/client-portal/me
 * Returns the current portal user's profile and every linked contact/
 * organization snapshot. A single login can be tied to more than one
 * entity (e.g. a personal 1040 contact plus a business organization),
 * so this returns arrays rather than a single "clientId" record.
 *
 * Also resolves `client_manager_key`/`client_partner_key` (raw Karbon
 * user keys) against `team_members` so the "Your Team" card can show
 * real names/titles instead of just an opaque key — those two fields
 * are the only handle the portal has on which staff members work this
 * account.
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  const [{ data: contacts }, { data: organizations }] = await Promise.all([
    portalUser.contactIds.length > 0
      ? supabase
          .from("contacts")
          .select(
            "id, full_name, first_name, last_name, primary_email, phone_primary, mailing_address_line1, mailing_city, mailing_state, mailing_zip_code, client_manager_key, client_partner_key",
          )
          .in("id", portalUser.contactIds)
      : Promise.resolve({ data: [] }),
    portalUser.organizationIds.length > 0
      ? supabase
          .from("organizations")
          .select("id, name, primary_email, phone, client_manager_key, client_partner_key")
          .in("id", portalUser.organizationIds)
      : Promise.resolve({ data: [] }),
  ])

  const teamKeys = Array.from(
    new Set(
      [...(contacts ?? []), ...(organizations ?? [])].flatMap((e) => [
        e.client_manager_key,
        e.client_partner_key,
      ]),
    ),
  ).filter((k): k is string => Boolean(k))

  let team: Record<string, TeamMemberSnapshot> = {}
  if (teamKeys.length > 0) {
    // Reads the view, not team_members. The table is staff-only
    // (scripts/399, 400) because a portal session could otherwise read and
    // write all 23 rows including auth_user_id, phone numbers and the Karbon
    // keys. RLS filters rows, not columns, so the client-safe column list
    // lives in portal_team_directory. Same shape as before — this query is
    // unchanged apart from the source.
    const { data: teamRows } = await supabase
      .from("portal_team_directory")
      .select("karbon_user_key, first_name, last_name, title, role, email")
      .in("karbon_user_key", teamKeys)

    team = Object.fromEntries(
      (teamRows ?? []).map((t) => [t.karbon_user_key as string, t]),
    )
  }

  return NextResponse.json({
    portalUser,
    contacts: contacts ?? [],
    organizations: organizations ?? [],
    team,
  })
}
