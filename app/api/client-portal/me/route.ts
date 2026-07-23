import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

/**
 * GET /api/client-portal/me
 * Returns the current portal user's profile and linked client snapshot.
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  // Pull the Karbon contact/org snapshot for the linked client
  const { data: contact } = await supabase
    .from("supabase_contacts")
    .select("id, first_name, last_name, email, phone_numbers, physical_addresses, client_manager_key, client_partner_key")
    .eq("id", portalUser.clientId)
    .maybeSingle()

  return NextResponse.json({
    portalUser,
    contact: contact ?? null,
  })
}
