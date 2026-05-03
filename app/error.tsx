"use client"

/**
 * Route-level error boundary.
 *
 * Catches any unhandled exception thrown while rendering a route segment
 * under app/ (e.g. a child component blowing up because an API field is
 * unexpectedly undefined). Without this file, Next.js falls back to the
 * stock unstyled "Application error: a client-side exception has occurred"
 * page — so we render the ALFRED-themed card instead and surface the real
 * error message in a collapsible details section.
 */

import { useEffect } from "react"
import { AlfredErrorCard } from "@/components/alfred-error"

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to the browser console (and downstream Vercel logs) so we can
    // diagnose recurring crashes from the production logs.
    console.error("[v0] Route error boundary caught:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <AlfredErrorCard
        title="ALFRED here — this page didn't load cleanly."
        message="I ran into an unexpected issue while assembling this view. The technical details are below if you'd like to share them with the team."
        error={error}
        onRetry={reset}
      />
    </div>
  )
}
