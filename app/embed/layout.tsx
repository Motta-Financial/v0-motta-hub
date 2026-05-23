/**
 * Embed-only layout — strips chrome (sidebar, top nav, footer) so the
 * page renders bare inside an iframe on motta.cpa. The marketing site
 * supplies its own surrounding UI; we just need the form.
 *
 * Anything under /embed/* is public (no auth) and is allowed to be
 * framed by the marketing site. The frame-ancestors CSP that enables
 * this lives in next.config.mjs.
 */
import type { ReactNode } from "react"
import "../globals.css"

export const metadata = {
  title: "Motta CPA",
  // Tell crawlers not to index the embed itself — we want them indexing
  // the marketing page, not this bare frame.
  robots: { index: false, follow: false },
}

export default function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="bg-background">
      <body className="bg-background font-sans antialiased">
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  )
}
