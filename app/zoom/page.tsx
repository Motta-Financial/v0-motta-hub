import { DashboardLayout } from "@/components/dashboard-layout"
import { ZoomDashboard } from "@/components/zoom-dashboard"
import { ZoomConnectStatusBanner } from "@/components/zoom-connect-status-banner"

/**
 * The Zoom OAuth callback redirects the user back to /zoom?success=true
 * or /zoom?error=<reason>. The dashboard component itself doesn't read
 * URL params, so we render a dismissable banner here that surfaces the
 * outcome of the install and points the user at the next step.
 *
 * `searchParams` is a Promise in Next.js 15+ App Router server pages.
 */
export default async function ZoomPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const params = await searchParams
  const status: "success" | "error" | null = params.success
    ? "success"
    : params.error
      ? "error"
      : null

  return (
    <DashboardLayout>
      {status && <ZoomConnectStatusBanner status={status} reason={params.error} />}
      <ZoomDashboard />
    </DashboardLayout>
  )
}
