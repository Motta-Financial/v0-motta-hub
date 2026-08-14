import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

/**
 * GET /api/client-portal/me
 * Returns the current portal user's profile and every linked contact/
 * organization snapshot. A single login can be tied to more than one
 * entity (e.g. a personal 1040 contact plus a business organization),
 * so this returns arrays rather than a single "clientId" record.
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

  return NextResponse.json({
    portalUser,
    contacts: contacts ?? [],
    organizations: organizations ?? [],
  })
}
