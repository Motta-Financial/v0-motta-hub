import { ZoomDashboard } from "@/components/zoom-dashboard"
import { ZoomConnectStatusBanner } from "@/components/zoom-connect-status-banner"

/**
 * /meetings/zoom — Zoom recordings, participants, and ALFRED triage.
 * The Zoom OAuth callback still redirects to the legacy /zoom (which
 * forwards here) with ?success=true or ?error=<reason>, so we render
 * the same status banner pattern in case the params arrive here too.
 *
 * The DashboardLayout chrome + sticky meetings sub-nav are provided by
 * the parent app/meetings/layout.tsx.
 *
 * `searchParams` is a Promise in Next.js 15+ App Router server pages.
 */
export default async function MeetingsZoomPage({
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
