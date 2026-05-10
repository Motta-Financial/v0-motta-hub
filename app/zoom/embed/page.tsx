import type { Metadata } from "next"

/**
 * Zoom Apps "Home URL" surface.
 *
 * This page is rendered inside an iframe by the Zoom desktop / web
 * client when a user opens the Motta Hub app from inside a Zoom
 * meeting (Apps panel). The OWASP security headers required by
 * Zoom's marketplace validator are configured at the path level in
 * `next.config.mjs` -> headers().
 *
 * Right now this is intentionally a placeholder — the data sync
 * webhook + recordings pipeline lands first. Once that's live the
 * plan is to:
 *   - call zoomSdk.config({ capabilities: ['getMeetingContext', ...] })
 *   - resolve the current meeting's host / participants to the
 *     matched Karbon contact (using the same matcher we built for
 *     intake / feedback)
 *   - render: linked client, last debrief, open work items, "create
 *     debrief" button that pre-fills from the meeting transcript.
 *
 * Until then we just need a real, headers-compliant page so Zoom
 * stops failing the OWASP validator on the Surface tab.
 */
export const metadata: Metadata = {
  title: "Motta Hub | Zoom App",
  description: "Motta Hub in-meeting client context for Zoom.",
  // Embedded in Zoom — don't index in search engines.
  robots: { index: false, follow: false },
}

export default function ZoomEmbedPage() {
  return (
    <main className="min-h-screen bg-background text-foreground font-sans">
      <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {/* Inline mark — avoids any external asset loads, which
              keeps the CSP tight. */}
          <span aria-hidden className="text-lg font-semibold">
            M
          </span>
        </div>
        <h1 className="text-balance text-xl font-semibold tracking-tight">Motta Hub</h1>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          You&apos;re viewing the Motta Hub Zoom App. Once a meeting is in progress, this panel will show
          the matched client profile, recent debriefs, and open work items.
        </p>
        <p className="text-xs text-muted-foreground">
          {"This experience is in development. Open "}
          <a
            href="https://motta.cpa"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            motta.cpa
          </a>
          {" for the full Hub."}
        </p>
      </div>
    </main>
  )
}
