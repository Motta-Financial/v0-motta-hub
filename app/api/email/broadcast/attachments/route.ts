/**
 * POST   /api/email/broadcast/attachments
 * DELETE /api/email/broadcast/attachments?pathname=...
 *
 * Upload/remove attachments for a firm-wide announcement (broadcast).
 * Same pattern as /api/debriefs/attachments — files land in Vercel Blob
 * before the announcement is submitted. The submit route persists the
 * blob metadata with the announcement row.
 *
 * Files are namespaced under `announcements/pending/` so a future GC
 * sweep can identify orphaned uploads (where someone uploaded but never
 * published the announcement).
 */

import { type NextRequest, NextResponse } from "next/server"
import { del, put } from "@vercel/blob"

// 25 MB ceiling — consistent with debriefs and prospects
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file supplied" }, { status: 400 })
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        {
          error: `File too large — max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB per attachment.`,
        },
        { status: 413 },
      )
    }

    const blob = await put(`announcements/pending/${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    })

    return NextResponse.json(
      {
        attachment: {
          url: blob.url,
          pathname: blob.pathname,
          name: file.name,
          content_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          uploaded_at: new Date().toISOString(),
        },
      },
      { status: 201 },
    )
  } catch (err: unknown) {
    console.error("[v0] POST /api/email/broadcast/attachments error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload attachment" },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const pathname = req.nextUrl.searchParams.get("pathname")
    const url = req.nextUrl.searchParams.get("url")
    const target = url || pathname
    if (!target) {
      return NextResponse.json(
        { error: "Missing pathname or url" },
        { status: 400 },
      )
    }
    await del(target)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("[v0] DELETE /api/email/broadcast/attachments error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove attachment" },
      { status: 500 },
    )
  }
}
