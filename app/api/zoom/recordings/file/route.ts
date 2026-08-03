/**
 * GET /api/zoom/recordings/file?pathname=zoom/<uuid>/<id>.<ext>
 *
 * Authenticated proxy that streams a PRIVATE Vercel Blob (recording media or
 * transcript VTT) to a signed-in team member. Private blobs aren't directly
 * URL-accessible, so the UI links here instead of to the blob URL.
 *
 * Supports HTTP Range requests so the media can be streamed and seeked inside
 * an in-Hub <video>/<audio> element (returns 206 Partial Content). By default
 * media is served `inline` for playback; pass `?download=1` to force an
 * attachment download instead.
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

  const forceDownload = req.nextUrl.searchParams.get("download") === "1"
  const rangeHeader = req.headers.get("range")

  try {
    // Forward the client's Range header to the blob origin so it can answer
    // with a partial (206) response. This is what makes <video> seeking work.
    const result = await get(pathname, {
      access: "private",
      ...(rangeHeader ? { headers: { range: rangeHeader } } : {}),
    })

    if (!result || result.statusCode === 304 || !result.stream) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    const filename = pathname.split("/").pop() || "recording"
    const contentType = result.blob.contentType || "application/octet-stream"
    const isText = contentType.startsWith("text/")

    const headers = new Headers()
    headers.set("Content-Type", contentType)
    headers.set("Accept-Ranges", "bytes")
    // Text (VTT) and media both render inline unless an explicit download is
    // requested via ?download=1.
    headers.set(
      "Content-Disposition",
      `${forceDownload && !isText ? "attachment" : "inline"}; filename="${filename}"`,
    )

    // Relay range metadata from the origin response when present.
    const originContentRange = result.headers.get("content-range")
    const originContentLength = result.headers.get("content-length")
    const originStatus = Number(result.headers.get("x-status") || 0)

    if (originContentRange) headers.set("Content-Range", originContentRange)
    if (originContentLength) {
      headers.set("Content-Length", originContentLength)
    } else if (result.blob.size != null && !rangeHeader) {
      headers.set("Content-Length", String(result.blob.size))
    }

    // If we asked for a range and the origin honored it, surface 206 so the
    // browser knows partial content was returned.
    const status = rangeHeader && (originContentRange || originStatus === 206) ? 206 : 200

    return new NextResponse(result.stream as unknown as ReadableStream, {
      status,
      headers,
    })
  } catch (err) {
    console.error("[v0] [Zoom Blob Proxy] failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 })
  }
}
