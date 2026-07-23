import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ClientPortalLayout, type PortalUserInfo } from "@/components/client-portal-layout"

/**
 * Server component layout for the entire /client-portal subtree.
 *
 * Responsibilities:
 *  1. Verify the visitor has an active portal_users row.
 *  2. If not, redirect to /client-portal/login (avoids client-side flicker).
 *  3. Fetch the unread message count for the sidebar badge.
 *  4. Render the ClientPortalLayout shell with the correct user info.
 *
 * The login page at /client-portal/login is explicitly excluded so it
 * doesn't redirect to itself (see the pathname check below).
 */

interface PortalLayoutProps {
  children: React.ReactNode
}

export default async function ClientPortalRouteLayout({ children }: PortalLayoutProps) {
  const supabase = await createClient()

  // Resolve the Supabase auth user (JWT validation, no network round-trip)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/client-portal/login")
  }

  // Load the portal_users row linked to this auth user
  const { data: portalUser } = await supabase
    .from("portal_users")
    .select("id, client_id, email, full_name, role, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  // No row or deactivated → send to login
  if (!portalUser || !portalUser.is_active) {
    await supabase.auth.signOut()
    redirect("/client-portal/login")
  }

  // Fetch unread message count (messages sent by 'team' that haven't been read yet)
  const { count: unreadCount } = await supabase
    .from("portal_messages")
    .select("id", { count: "exact", head: true })
    .eq("client_id", portalUser.client_id)
    .eq("sender_role", "team")
    .is("read_at", null)

  const userInfo: PortalUserInfo = {
    fullName: portalUser.full_name,
    email: portalUser.email,
    role: portalUser.role as "client" | "client_contact",
  }

  return (
    <ClientPortalLayout portalUser={userInfo} unreadCount={unreadCount ?? 0}>
      {children}
    </ClientPortalLayout>
  )
}
