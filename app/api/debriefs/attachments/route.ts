/**
 * POST /api/debriefs/attachments
 *
 * Uploads a single file to Vercel Blob for inclusion with a not-yet-
 * submitted debrief. Returns the blob metadata so the caller (the
 * DebriefForm) can stash it in form state and ship it on the final
 * POST /api/debriefs body alongside the rest of the debrief payload.
 *
 * Unlike /api/prospects/[id]/attachments (which appends to an existing
 * row), debriefs aren't persisted yet at upload time — the partner
 * uploads while still composing the form. So this route is "id-less":
 * it just hands files to Blob and returns the URLs. The debrief POST
 * route is what eventually persists those URLs on the row.
 *
 * Files land at `debriefs/pending/<random>/<original-name>` so we have a
 * clean "everything uploaded for a draft debrief" prefix if we ever
 * need to garbage-collect orphans (i.e. uploads where the partner never
 * actually submitted the form).
 *
 * DELETE /api/debriefs/attachments?pathname=...
 *
 * Removes an uploaded-but-not-yet-attached blob. Used when a partner
 * clicks the X on a queued attachment before submitting the debrief —
 * we don't want to leak the file into our Blob quota.
 */

import { type NextRequest, NextResponse } from "next/server"
import { del, put } from "@vercel/blob"

// Hard ceiling on individual file size. Matches the prospects route so
// the policy is consistent across both intake surfaces. Resend's combined
// payload cap is around 40 MB, so 25 MB per file leaves headroom for a
// few attachments at once.
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

    // Namespace under `debriefs/pending/` so a future GC sweep can
    // identify orphaned drafts (uploads not referenced by any debrief
    // row) just by listing the prefix. `addRandomSuffix: true` makes
    // collisions impossible when the same screenshot is uploaded twice.
    const blob = await put(`debriefs/pending/${file.name}`, file, {
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
  } catch (err: any) {
    console.error("[v0] POST /api/debriefs/attachments error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to upload attachment" },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const pathname = req.nextUrl.searchParams.get("pathname")
    const url = req.nextUrl.searchParams.get("url")
    // `del()` accepts a URL or pathname interchangeably; we prefer URL
    // when the client has it (more reliable across regions). Falling
    // back to pathname keeps the API friendly to either caller style.
    const target = url || pathname
    if (!target) {
      return NextResponse.json(
        { error: "Missing pathname or url" },
        { status: 400 },
      )
    }
    await del(target)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[v0] DELETE /api/debriefs/attachments error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to remove attachment" },
      { status: 500 },
    )
  }
}
