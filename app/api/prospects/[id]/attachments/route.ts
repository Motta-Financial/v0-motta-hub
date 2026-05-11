/**
 * POST   /api/prospects/[id]/attachments
 * DELETE /api/prospects/[id]/attachments?pathname=...
 *
 * Manages teammate-uploaded attachments on a prospect submission.
 * Stored in the project's public Vercel Blob store with
 * `addRandomSuffix: true` so URLs are unguessable (the same
 * "private-by-obscurity" pattern the profile avatar route uses).
 * The teammate-visible blob URL is what the UI renders directly
 * via <img src> / <a href> — no separate delivery route needed.
 *
 * Each attachment is a JSON object on the row's `attachments` array:
 *   {
 *     url,            -- private URL (never served publicly)
 *     pathname,       -- key used with `get()` to stream the file
 *     name,           -- original filename for display
 *     content_type,   -- MIME, used for the Content-Type response
 *     size_bytes,     -- raw byte count for UI display
 *     uploaded_at,    -- ISO timestamp
 *     uploaded_by_id, -- team_members.id of the teammate
 *     uploaded_by_name
 *   }
 */

import { type NextRequest, NextResponse } from "next/server"
import { del, put } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/server"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

// Hard ceiling on individual file size so a teammate can't accidentally
// blow through the project's blob quota. 25 MB is enough for very long
// screenshot threads and chunky PDFs but blocks runaway uploads.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

interface AttachmentRecord {
  url: string
  pathname: string
  name: string
  content_type: string
  size_bytes: number
  uploaded_at: string
  uploaded_by_id: string | null
  uploaded_by_name: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid prospect id" }, { status: 400 })
    }

    const formData = await req.formData()
    const file = formData.get("file")
    const uploadedById = (formData.get("uploaded_by_id") as string | null)?.trim() || null

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

    const supabase = createAdminClient()

    // Confirm the prospect exists + grab the row to mutate. Doing this
    // BEFORE uploading to blob avoids orphaned files when someone
    // mistypes the prospect id in the URL.
    const { data: existing, error: lookupError } = await supabase
      .from("prospect_submissions")
      .select("id, attachments")
      .eq("id", id)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!existing) {
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 })
    }

    // Optional: resolve the uploader's display name for the attachment
    // metadata so the detail page can render "Uploaded by Jane Doe"
    // without a second fetch.
    let uploadedByName: string | null = null
    if (uploadedById && isUuid(uploadedById)) {
      const { data: tm } = await supabase
        .from("team_members")
        .select("full_name")
        .eq("id", uploadedById)
        .maybeSingle()
      uploadedByName = tm?.full_name ?? null
    }

    // ── Upload to private Blob store ────────────────────────────────
    // The pathname is namespaced under the prospect id so a future
    // "delete all attachments when prospect deleted" cleanup is just
    // `list({ prefix: \`prospects/${id}/\` })`. addRandomSuffix makes
    // each upload's pathname unique even when the same screenshot is
    // re-uploaded.
    const blob = await put(`prospects/${id}/${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    })

    const record: AttachmentRecord = {
      url: blob.url,
      pathname: blob.pathname,
      name: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      uploaded_at: new Date().toISOString(),
      uploaded_by_id: uploadedById,
      uploaded_by_name: uploadedByName,
    }

    // ── Append to the row's JSONB array ─────────────────────────────
    // Read-modify-write is fine here because the form is single-user
    // and attachments are added sequentially. If concurrent uploads
    // ever become a real workflow we can move this to a Postgres
    // `jsonb_array_append` RPC instead.
    const nextAttachments = [...((existing.attachments as AttachmentRecord[]) ?? []), record]

    const { error: updateError } = await supabase
      .from("prospect_submissions")
      .update({ attachments: nextAttachments })
      .eq("id", id)

    if (updateError) {
      // Roll back the blob upload so we don't leave orphaned files
      // when the DB write fails. Fire-and-forget — surfacing this
      // would just confuse the teammate; the row never references it.
      void del(blob.url).catch(() => {})
      throw updateError
    }

    return NextResponse.json({ attachment: record }, { status: 201 })
  } catch (err: any) {
    console.error("[v0] POST /api/prospects/[id]/attachments error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to upload attachment" },
      { status: 500 },
    )
  }
}

/**
 * DELETE removes a single attachment. The pathname comes in via the
 * query string so the body stays empty (handy for `fetch(..., {
 * method: "DELETE" })` without serializing JSON).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid prospect id" }, { status: 400 })
    }
    const pathname = req.nextUrl.searchParams.get("pathname")
    if (!pathname) {
      return NextResponse.json({ error: "Missing pathname" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: existing, error: lookupError } = await supabase
      .from("prospect_submissions")
      .select("attachments")
      .eq("id", id)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!existing) {
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 })
    }

    const current = (existing.attachments as AttachmentRecord[] | null) ?? []
    const target = current.find((a) => a.pathname === pathname)
    if (!target) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
    }

    // Best-effort blob delete; if the file already vanished we still
    // want the metadata row gone.
    await del(target.url).catch((err) => {
      console.error("[v0] blob del failed (continuing):", err)
    })

    const next = current.filter((a) => a.pathname !== pathname)
    const { error: updateError } = await supabase
      .from("prospect_submissions")
      .update({ attachments: next })
      .eq("id", id)
    if (updateError) throw updateError

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[v0] DELETE /api/prospects/[id]/attachments error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to remove attachment" },
      { status: 500 },
    )
  }
}
