/**
 * GET  /api/client-portal/work-items/[id]/documents
 * POST /api/client-portal/work-items/[id]/documents
 *
 * Per-task document attachments. Reuses the existing `documents` table
 * (which already carries `work_item_id`) rather than introducing a
 * parallel store, so files uploaded by a client in the portal show up
 * against the same work item on the internal hub side.
 *
 * Uploads go to the Vercel Blob store with `addRandomSuffix: true` so
 * URLs are unguessable — the same private-by-obscurity pattern the
 * prospect attachment route uses.
 */

import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { del, put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

// 25 MB ceiling — generous for tax packets and scanned PDFs, but stops a
// runaway upload from eating the project's blob quota.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const DOCUMENT_FIELDS =
  "id, name, file_type, mime_type, file_size_bytes, storage_url, document_type, tax_year, status, uploaded_at, uploaded_by_role, created_at"

async function assertOwnsWorkItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workItemId: string,
  clientId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const { data, error } = await supabase
    .from("work_items")
    .select("id")
    .eq("id", workItemId)
    .eq("client_key", clientId)
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    }
  }
  if (!data) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    }
  }
  return { ok: true }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid work item id" }, { status: 400 })
  }

  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const supabase = await createClient()
  const owns = await assertOwnsWorkItem(supabase, id, auth.portalUser.clientId)
  if (!owns.ok) return owns.response

  const { data, error } = await supabase
    .from("documents")
    .select(DOCUMENT_FIELDS)
    .eq("work_item_id", id)
    .order("uploaded_at", { ascending: false, nullsFirst: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ documents: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid work item id" }, { status: 400 })
    }

    const auth = await requirePortalAuth()
    if (!auth.ok) return auth.response

    const { portalUser } = auth

    const formData = await req.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file supplied" }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `File too large — max ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB per upload.`,
        },
        { status: 413 },
      )
    }

    const supabase = await createClient()

    // Verify ownership BEFORE uploading so a bad id can't leave an
    // orphaned blob behind.
    const owns = await assertOwnsWorkItem(supabase, id, portalUser.clientId)
    if (!owns.ok) return owns.response

    const blob = await put(`client-portal/${portalUser.clientId}/${id}/${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    })

    const extension = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : null

    const { data, error } = await supabase
      .from("documents")
      .insert({
        work_item_id: id,
        name: file.name,
        file_type: extension,
        mime_type: file.type || "application/octet-stream",
        file_size_bytes: file.size,
        storage_path: blob.pathname,
        storage_url: blob.url,
        status: "uploaded",
        uploaded_by_role: "client",
        uploaded_at: new Date().toISOString(),
      })
      .select(DOCUMENT_FIELDS)
      .single()

    if (error) {
      // Roll back the blob so we don't strand a file no row points at.
      void del(blob.url).catch(() => {})
      throw error
    }

    return NextResponse.json({ document: data }, { status: 201 })
  } catch (err: any) {
    console.error("[v0] POST portal task document error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to upload document" },
      { status: 500 },
    )
  }
}
