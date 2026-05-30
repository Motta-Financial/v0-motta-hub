/**
 * PATCH  /api/resources/documents/[id]   — replace the file (version bump + re-ingest)
 *                                            OR edit metadata (title/description/etc.)
 * DELETE /api/resources/documents/[id]    — archive (default) or hard-delete (?hard=true)
 *
 * Replace semantics: the row id is STABLE. Uploading a new file bumps `version`,
 * pushes the prior file metadata onto `version_history`, swaps the blob, and
 * re-runs ALFRED ingest so the summary + service-line tags reflect the update.
 */

import { type NextRequest, NextResponse } from "next/server"
import { del, put } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/server"
import { ingestResourceDocument } from "@/lib/resources/ingest"

export const maxDuration = 120

const MAX_RESOURCE_BYTES = 25 * 1024 * 1024

const VALID_CATEGORIES = new Set([
  "client-resources",
  "templates",
  "team-instructions",
  "sop",
  "other",
])
const VALID_AUDIENCES = new Set(["team", "client"])

const SELECT_COLS =
  "id, title, description, category, audience, file_url, file_name, mime_type, file_size_bytes, version, status, ai_summary, ai_keywords, service_line_codes, ingest_error, ingested_at, uploaded_by_id, uploaded_by_name, is_archived, created_at, updated_at"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let newBlobUrl: string | null = null
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid resource id" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: existing, error: lookupError } = await supabase
      .from("resource_documents")
      .select("*")
      .eq("id", id)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!existing) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 })
    }

    const contentType = req.headers.get("content-type") || ""

    // ── Path A: metadata-only edit (JSON body) ──────────────────────
    if (contentType.includes("application/json")) {
      const body = await req.json()
      const patch: Record<string, unknown> = {}
      if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim()
      if (typeof body.description === "string") patch.description = body.description.trim() || null
      if (typeof body.category === "string" && VALID_CATEGORIES.has(body.category))
        patch.category = body.category
      if (typeof body.audience === "string" && VALID_AUDIENCES.has(body.audience))
        patch.audience = body.audience
      // Allow manual override / correction of the auto-tags.
      if (Array.isArray(body.service_line_codes)) {
        patch.service_line_codes = body.service_line_codes
          .filter((c: unknown): c is string => typeof c === "string")
          .map((c: string) => c.toUpperCase().trim())
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
      }
      const { data: updated, error: updErr } = await supabase
        .from("resource_documents")
        .update(patch)
        .eq("id", id)
        .select(SELECT_COLS)
        .single()
      if (updErr) throw updErr
      return NextResponse.json({ document: updated })
    }

    // ── Path B: file replacement (multipart) ────────────────────────
    const formData = await req.formData()
    const file = formData.get("file")
    const replacedById = (formData.get("uploaded_by_id") as string | null)?.trim() || null

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No replacement file supplied" }, { status: 400 })
    }
    if (file.size > MAX_RESOURCE_BYTES) {
      return NextResponse.json(
        { error: `File too large — max ${MAX_RESOURCE_BYTES / (1024 * 1024)} MB.` },
        { status: 413 },
      )
    }

    const category = existing.category as string
    const blob = await put(`resources/${category}/${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    })
    newBlobUrl = blob.url

    // Record the version being superseded.
    const priorVersion = {
      version: existing.version,
      file_url: existing.file_url,
      file_pathname: existing.file_pathname,
      file_name: existing.file_name,
      mime_type: existing.mime_type,
      file_size_bytes: existing.file_size_bytes,
      replaced_at: new Date().toISOString(),
      replaced_by_id: replacedById && isUuid(replacedById) ? replacedById : null,
    }
    const history = Array.isArray(existing.version_history) ? existing.version_history : []

    // Set to processing while ALFRED re-reads.
    const { error: stageErr } = await supabase
      .from("resource_documents")
      .update({
        file_url: blob.url,
        file_pathname: blob.pathname,
        file_name: file.name,
        mime_type: file.type || null,
        file_size_bytes: file.size,
        version: (existing.version as number) + 1,
        version_history: [...history, priorVersion],
        status: "processing",
      })
      .eq("id", id)
    if (stageErr) {
      void del(blob.url).catch(() => {})
      throw stageErr
    }

    // ── ALFRED re-reads the new version ─────────────────────────────
    const ingest = await ingestResourceDocument({
      fileUrl: blob.url,
      fileName: file.name,
      mimeType: file.type || null,
      title: existing.title as string,
      description: existing.description as string | null,
      category,
      audience: existing.audience as string,
    })

    const { data: updated, error: updErr } = await supabase
      .from("resource_documents")
      .update({
        status: ingest.status,
        extracted_text: ingest.extractedText,
        ai_summary: ingest.summary,
        ai_keywords: ingest.keywords,
        service_line_codes: ingest.serviceLineCodes,
        ingest_error: ingest.error ?? null,
        ingested_at: new Date().toISOString(),
        ingest_model: ingest.model,
      })
      .eq("id", id)
      .select(SELECT_COLS)
      .single()
    if (updErr) throw updErr

    // Best-effort cleanup of the superseded blob (keep history metadata only).
    if (existing.file_url) void del(existing.file_url as string).catch(() => {})

    return NextResponse.json({ document: updated })
  } catch (err: any) {
    console.error("[v0] PATCH /api/resources/documents/[id] error:", err)
    if (newBlobUrl) void del(newBlobUrl).catch(() => {})
    return NextResponse.json(
      { error: err?.message ?? "Failed to update resource" },
      { status: 500 },
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid resource id" }, { status: 400 })
    }
    const hard = req.nextUrl.searchParams.get("hard") === "true"
    const supabase = createAdminClient()

    if (!hard) {
      // Soft delete keeps the file + metadata but hides it everywhere
      // (including from ALFRED, whose view filters is_archived = false).
      const { data: updated, error } = await supabase
        .from("resource_documents")
        .update({ is_archived: true })
        .eq("id", id)
        .select("id, is_archived")
        .maybeSingle()
      if (error) throw error
      if (!updated) return NextResponse.json({ error: "Resource not found" }, { status: 404 })
      return NextResponse.json({ ok: true, archived: true })
    }

    // Hard delete: remove the current blob + all historical blobs, then the row.
    const { data: existing, error: lookupErr } = await supabase
      .from("resource_documents")
      .select("file_url, version_history")
      .eq("id", id)
      .maybeSingle()
    if (lookupErr) throw lookupErr
    if (!existing) return NextResponse.json({ error: "Resource not found" }, { status: 404 })

    const urls: string[] = []
    if (existing.file_url) urls.push(existing.file_url as string)
    if (Array.isArray(existing.version_history)) {
      for (const v of existing.version_history as { file_url?: string }[]) {
        if (v?.file_url) urls.push(v.file_url)
      }
    }
    await Promise.all(urls.map((u) => del(u).catch(() => {})))

    const { error: delErr } = await supabase.from("resource_documents").delete().eq("id", id)
    if (delErr) throw delErr

    return NextResponse.json({ ok: true, deleted: true })
  } catch (err: any) {
    console.error("[v0] DELETE /api/resources/documents/[id] error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete resource" },
      { status: 500 },
    )
  }
}
