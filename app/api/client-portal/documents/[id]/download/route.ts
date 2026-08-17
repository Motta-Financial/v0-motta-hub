/**
 * GET /api/client-portal/documents/[id]/download
 *
 * Authenticated download proxy for `documents` rows. Files are uploaded
 * to Vercel Blob with `access: "private"` (see
 * work-items/[id]/documents/route.ts) precisely so nobody can fetch a
 * tax document just by having the raw blob URL — the only path to the
 * bytes is this route, which re-checks the caller actually owns the
 * document (RLS also enforces this at the DB layer, but we check
 * explicitly here so we can 404 cleanly and scope the Blob fetch).
 */

import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { applyPortalEntityFilter } from "@/lib/portal/entity-filter"
import { createClient } from "@/lib/supabase/server"
import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 })
  }

  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const supabase = await createClient()

  const baseQuery = supabase
    .from("documents")
    .select("id, name, mime_type, storage_path")
    .eq("id", id)

  const { data: doc, error } = await applyPortalEntityFilter(baseQuery, auth.portalUser).maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!doc || !doc.storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const blob = await get(doc.storage_path, {
      access: "private",
      token: process.env.CLIENT_PORTAL_BLOB_READ_WRITE_TOKEN,
    })

    if (!blob || !blob.stream) {
      return NextResponse.json({ error: "File not found in storage" }, { status: 404 })
    }

    const filename = doc.name || "document"

    return new NextResponse(blob.stream, {
      headers: {
        "Content-Type": doc.mime_type || blob.blob.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (err: any) {
    console.error("[v0] GET document download error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to download document" },
      { status: 500 },
    )
  }
}
