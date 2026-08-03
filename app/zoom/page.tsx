import { redirect } from "next/navigation"

/**
 * Legacy /zoom — the Zoom dashboard moved under the new top-level
 * Meetings section at /meetings/zoom. This route forwards there,
 * preserving the ?success / ?error query the Zoom OAuth callback may
 * append, so the connect status banner still renders post-install.
 *
 * NOTE: /zoom/embed is a SEPARATE route (app/zoom/embed/page.tsx) and
 * is unaffected by this redirect.
 *
 * `searchParams` is a Promise in Next.js 15+ App Router server pages.
 */
export default async function LegacyZoomPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.success) qs.set("success", params.success)
  if (params.error) qs.set("error", params.error)
  const query = qs.toString()
  redirect(`/meetings/zoom${query ? `?${query}` : ""}`)
}
