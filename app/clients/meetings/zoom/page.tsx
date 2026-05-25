import { ZoomDashboard } from "@/components/zoom-dashboard"
import { ZoomConnectStatusBanner } from "@/components/zoom-connect-status-banner"

/**
 * /clients/meetings/zoom — Zoom recordings, participants, and ALFRED
 * triage. The Zoom OAuth callback redirects to this page (or the
 * legacy /zoom — which also still works) with ?success=true or
 * ?error=&lt;reason&gt;, so we render the same status banner pattern.
 *
 * The DashboardLayout chrome + sticky meetings sub-nav are provided
 * by the parent app/clients/meetings/layout.tsx.
 *
 * `searchParams` is a Promise in Next.js 15+ App Router server pages.
 */
export default async function ClientMeetingsZoomPage({
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
    <>
      {status && <ZoomConnectStatusBanner status={status} reason={params.error} />}
      <ZoomDashboard />
    </>
  )
}
