import { ClientPortalLayout, type PortalUserInfo } from "@/components/client-portal-layout"

/**
 * NOTE: Auth guard is temporarily bypassed so the portal UI can be
 * reviewed and iterated on in the preview without needing a live
 * portal_users row. Re-enable the Supabase auth block before going to
 * production (see the commented section below).
 */

interface PortalLayoutProps {
  children: React.ReactNode
}

const PREVIEW_USER: PortalUserInfo = {
  fullName: "Alex Johnson",
  email: "alex.johnson@example.com",
  role: "client",
}

export default function ClientPortalRouteLayout({ children }: PortalLayoutProps) {
  return (
    <ClientPortalLayout portalUser={PREVIEW_USER} unreadCount={2}>
      {children}
    </ClientPortalLayout>
  )
}

/*
 ── PRODUCTION AUTH (restore this, remove the stub above) ─────────────────────

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function ClientPortalRouteLayout({ children }: PortalLayoutProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/client-portal/login")

  const { data: portalUser } = await supabase
    .from("portal_users")
    .select("id, client_id, email, full_name, role, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (!portalUser || !portalUser.is_active) {
    await supabase.auth.signOut()
    redirect("/client-portal/login")
  }

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
*/
