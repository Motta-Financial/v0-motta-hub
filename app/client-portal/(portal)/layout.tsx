import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { ClientPortalLayout, type PortalUserInfo } from "@/components/client-portal-layout"

interface PortalLayoutProps {
  children: React.ReactNode
}

export default async function ClientPortalRouteLayout({ children }: PortalLayoutProps) {
  const auth = await requirePortalAuth()

  if (!auth.ok) {
    // No session, no active portal_users row, or no granted entity access —
    // in every case the safest destination is the login screen. Also sign
    // out any stale session so a deactivated user can't keep hitting pages
    // that 403 forever.
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect("/client-portal/login")
  }

  const { portalUser } = auth

  // portal_messages has no read/unread tracking column, so we surface the
  // count of team-authored messages on the caller's linked entities as a
  // simple activity indicator rather than a true "unread" count.
  const orFilters = [
    portalUser.contactIds.length > 0 ? `contact_id.in.(${portalUser.contactIds.join(",")})` : null,
    portalUser.organizationIds.length > 0
      ? `organization_id.in.(${portalUser.organizationIds.join(",")})`
      : null,
  ].filter(Boolean) as string[]

  let unreadCount = 0
  if (orFilters.length > 0) {
    const supabase = await createClient()
    const { count } = await supabase
      .from("portal_messages")
      .select("id", { count: "exact", head: true })
      .or(orFilters.join(","))
      .eq("sender_role", "team")
    unreadCount = count ?? 0
  }

  const userInfo: PortalUserInfo = {
    fullName: portalUser.fullName,
    email: portalUser.email,
    role: "client",
  }

  return (
    <ClientPortalLayout portalUser={userInfo} unreadCount={unreadCount}>
      {children}
    </ClientPortalLayout>
  )
}
