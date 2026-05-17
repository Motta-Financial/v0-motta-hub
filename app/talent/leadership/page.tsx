import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardLayout } from "@/components/dashboard-layout"
import { FirmHoursDashboard } from "@/components/leadership/firm-hours-dashboard"
import { LEADERSHIP_ROLES } from "@/lib/auth/leadership-roles"

export const metadata = {
  title: "Leadership | Motta Hub",
  description: "Firm-wide hours, utilization, and operational health — PPD only.",
}

export const dynamic = "force-dynamic"

/**
 * /talent/leadership — restricted to PPD (Partner / Principal /
 * Director). The same allowlist used by `requireLeadership()` in the
 * API guard is applied here, server-side, so non-PPD users never even
 * receive the page HTML.
 *
 * The current scope is firm-wide hours (the "Firm Hours" tab). Future
 * tabs (Utilization deep-dive, Engagement profitability, Compensation
 * planning) will live alongside it as siblings under this same route.
 */
export default async function LeadershipPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login?redirect=/talent/leadership")
  }

  // Look up the caller's role. Mirrors `loadCallerLeadershipStatus`'s
  // two-step lookup pattern (auth_user_id first, email fallback).
  let role: string | null = null
  let isActive = true
  {
    const byAuth = await supabase
      .from("team_members")
      .select("role, is_active")
      .eq("auth_user_id", user.id)
      .maybeSingle()
    if (byAuth.data) {
      role = byAuth.data.role
      isActive = byAuth.data.is_active !== false
    } else if (user.email) {
      const byEmail = await supabase
        .from("team_members")
        .select("role, is_active")
        .eq("email", user.email)
        .maybeSingle()
      if (byEmail.data) {
        role = byEmail.data.role
        isActive = byEmail.data.is_active !== false
      }
    }
  }

  const isLeadership =
    isActive && !!role && (LEADERSHIP_ROLES as readonly string[]).includes(role)

  if (!isLeadership) {
    // Non-leadership users get bounced to the parent Talent page rather
    // than seeing a 403 — the entry point doesn't exist for them in
    // the sidebar either, so they only land here by typing the URL.
    redirect("/teammates")
  }

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Leadership</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Firm-wide operational visibility for Partners, Principals, and Directors.
          </p>
        </header>

        <FirmHoursDashboard />
      </div>
    </DashboardLayout>
  )
}
