/**
 * GET /api/zoom/recordings/file?pathname=zoom/<uuid>/<id>.<ext>
 *
 * Authenticated proxy that streams a PRIVATE Vercel Blob (recording media or
 * transcript VTT) to a signed-in team member. Private blobs aren't directly
 * URL-accessible, so the UI links here instead of to the blob URL.
 *
 * We only allow pathnames under the `zoom/` prefix to prevent this from being
 * used as a generic blob reader.
 */

import { NextRequest, NextResponse } from "next/server"
import { get } from "@vercel/blob"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pathname = req.nextUrl.searchParams.get("pathname")
  if (!pathname || !pathname.startsWith("zoom/")) {
    return NextResponse.json({ error: "invalid_pathname" }, { status: 400 })
  }

  try {
    const result = await get(pathname, { access: "private" })
    if (!result || !result.stream) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    const headers = new Headers()
    if (result.blob.contentType) headers.set("Content-Type", result.blob.contentType)
    if (result.blob.size != null) headers.set("Content-Length", String(result.blob.size))
    // Inline for VTT/text, attachment for media.
    const isText = (result.blob.contentType || "").startsWith("text/")
    headers.set(
      "Content-Disposition",
      `${isText ? "inline" : "attachment"}; filename="${pathname.split("/").pop()}"`,
    )

    return new NextResponse(result.stream as unknown as ReadableStream, { headers })
  } catch (err) {
    console.error("[v0] [Zoom Blob Proxy] failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 })
  }
}
