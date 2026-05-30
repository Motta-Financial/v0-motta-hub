/**
 * GET /api/zoom/recordings/stream?recordingId=<uuid>&fileId=<recording_file_id>
 *
 * Authenticated media proxy that lets a signed-in team member PLAY a Zoom
 * cloud recording directly inside the Hub (in a <video>/<audio> element)
 * instead of bouncing out to zoom.us.
 *
 * Resolution order for the bytes:
 *   1. If the recording file was already copied to private Vercel Blob
 *      (recording_files[].blob_pathname), stream from Blob.
 *   2. Otherwise stream Zoom's short-lived `download_url`, authenticated with
 *      the account-wide Server-to-Server token. The token/URL are NEVER sent
 *      to the browser.
 *
 * Range-aware: the client's `Range` header is forwarded so the browser can
 * seek, and we relay the upstream 206 + Content-Range. We also normalize the
 * Content-Type (Zoom serves recordings as application/octet-stream) so the
 * browser actually plays the media.
 */

import { NextRequest, NextResponse } from "next/server"
import { get } from "@vercel/blob"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getS2SAccessToken, isS2SConfigured } from "@/lib/zoom/s2s-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface ZoomFile {
  id?: string
  file_type?: string
  file_extension?: string
  recording_type?: string
  download_url?: string
  file_size?: number
  blob_pathname?: string | null
}

/** Map a Zoom file to a browser-playable MIME type. */
function mediaContentType(file: ZoomFile): string {
  const t = (file.file_type || "").toUpperCase()
  const ext = (file.file_extension || "").toUpperCase()
  if (t === "MP4" || ext === "MP4") return "video/mp4"
  if (t === "M4A" || ext === "M4A") return "audio/mp4"
  return "application/octet-stream"
}

export async function GET(req: NextRequest) {
  // ── Auth: signed-in team member only ──────────────────────────────────
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const recordingId = req.nextUrl.searchParams.get("recordingId")
  const fileId = req.nextUrl.searchParams.get("fileId")
  if (!recordingId || !fileId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 })
  }

  // ── Resolve the recording file (admin: service-role table) ────────────
  const admin = createAdminClient()
  const { data: rec, error } = await admin
    .from("zoom_recordings")
    .select("id, zoom_uuid, recording_files")
    .eq("id", recordingId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rec) return NextResponse.json({ error: "recording_not_found" }, { status: 404 })

  const files = Array.isArray(rec.recording_files) ? (rec.recording_files as ZoomFile[]) : []
  const file = files.find((f) => String(f.id) === String(fileId))
  if (!file) return NextResponse.json({ error: "file_not_found" }, { status: 404 })

  const contentType = mediaContentType(file)
  const rangeHeader = req.headers.get("range")

  try {
    // ── 1. Prefer a permanent Blob copy if one exists ───────────────────
    if (file.blob_pathname) {
      const result = await get(file.blob_pathname, {
        access: "private",
        ...(rangeHeader ? { headers: { range: rangeHeader } } : {}),
      })
      if (result && result.statusCode === 200 && result.stream) {
        const headers = new Headers()
        headers.set("Content-Type", contentType)
        headers.set("Accept-Ranges", "bytes")
        headers.set("Content-Disposition", "inline")
        const cr = result.headers.get("content-range")
        const cl = result.headers.get("content-length")
        if (cr) headers.set("Content-Range", cr)
        if (cl) headers.set("Content-Length", cl)
        else if (result.blob.size != null && !rangeHeader) {
          headers.set("Content-Length", String(result.blob.size))
        }
        const status = rangeHeader && cr ? 206 : 200
        return new NextResponse(result.stream as unknown as ReadableStream, { status, headers })
      }
      // fall through to Zoom if the blob read didn't pan out
    }

    // ── 2. Stream Zoom's download_url with the S2S token ────────────────
    if (!file.download_url) {
      return NextResponse.json({ error: "no_playable_source" }, { status: 404 })
    }
    if (!isS2SConfigured()) {
      return NextResponse.json({ error: "zoom_s2s_not_configured" }, { status: 503 })
    }

    const token = await getS2SAccessToken()
    const upstreamHeaders: Record<string, string> = { Authorization: `Bearer ${token}` }
    if (rangeHeader) upstreamHeaders.range = rangeHeader

    let upstream = await fetch(file.download_url, { headers: upstreamHeaders })

    // Some Zoom endpoints only accept the access_token query param on 401.
    if (upstream.status === 401) {
      const sep = file.download_url.includes("?") ? "&" : "?"
      const retryHeaders: Record<string, string> = {}
      if (rangeHeader) retryHeaders.range = rangeHeader
      upstream = await fetch(
        `${file.download_url}${sep}access_token=${encodeURIComponent(token)}`,
        { headers: retryHeaders },
      )
    }

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: "upstream_failed", status: upstream.status },
        { status: 502 },
      )
    }
    if (!upstream.body) {
      return NextResponse.json({ error: "empty_upstream" }, { status: 502 })
    }

    const headers = new Headers()
    headers.set("Content-Type", contentType)
    headers.set("Accept-Ranges", "bytes")
    headers.set("Content-Disposition", "inline")
    const cr = upstream.headers.get("content-range")
    const cl = upstream.headers.get("content-length")
    if (cr) headers.set("Content-Range", cr)
    if (cl) headers.set("Content-Length", cl)

    return new NextResponse(upstream.body, { status: upstream.status, headers })
  } catch (err) {
    console.error(
      "[v0] [Zoom Stream] failed:",
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json({ error: "stream_failed" }, { status: 500 })
  }
}
