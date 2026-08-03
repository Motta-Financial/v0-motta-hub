/**
 * GET  /api/resources/documents          — list resources (optional ?category=&audience=&serviceLine=)
 * POST /api/resources/documents          — upload a new resource (multipart)
 *
 * Firm-wide "Resources" knowledge base. On upload we:
 *   1. store the file in Vercel Blob (private-by-obscurity, same as other uploads),
 *   2. insert a row with status='processing',
 *   3. have ALFRED read it (extract text + summarize + auto-tag service lines),
 *   4. update the row with the ingest result.
 *
 * Ingest runs inline so the response carries the tags; the model reads PDFs /
 * images natively via the AI Gateway.
 */

import { type NextRequest, NextResponse } from "next/server"
import { del, put } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/server"
import { ingestResourceDocument } from "@/lib/resources/ingest"

// Claude reading a chunky PDF can take a while; give the route room.
export const maxDuration = 120

const MAX_RESOURCE_BYTES = 25 * 1024 * 1024 // 25 MB, matches other upload routes

const VALID_CATEGORIES = new Set([
  "client-resources",
  "templates",
  "team-instructions",
  "sop",
  "other",
])
const VALID_AUDIENCES = new Set(["team", "client"])

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const sp = req.nextUrl.searchParams
    const category = sp.get("category")
    const audience = sp.get("audience")
    const serviceLine = sp.get("serviceLine")
    const includeArchived = sp.get("includeArchived") === "true"

    let query = supabase
      .from("resource_documents")
      .select(
        "id, title, description, category, audience, file_url, file_name, mime_type, file_size_bytes, version, status, ai_summary, ai_keywords, service_line_codes, ingest_error, ingested_at, uploaded_by_id, uploaded_by_name, is_archived, created_at, updated_at",
      )
      .order("created_at", { ascending: false })

    if (!includeArchived) query = query.eq("is_archived", false)
    if (category && VALID_CATEGORIES.has(category)) query = query.eq("category", category)
    if (audience && VALID_AUDIENCES.has(audience)) query = query.eq("audience", audience)
    if (serviceLine) query = query.contains("service_line_codes", [serviceLine.toUpperCase()])

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ documents: data ?? [] })
  } catch (err: any) {
    console.error("[v0] GET /api/resources/documents error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to list resources" },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  let uploadedBlobUrl: string | null = null
  try {
    const formData = await req.formData()
    const file = formData.get("file")
    const title = (formData.get("title") as string | null)?.trim()
    const description = (formData.get("description") as string | null)?.trim() || null
    const categoryRaw = (formData.get("category") as string | null)?.trim() || "client-resources"
    const audienceRaw = (formData.get("audience") as string | null)?.trim() || "team"
    const uploadedById = (formData.get("uploaded_by_id") as string | null)?.trim() || null

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file supplied" }, { status: 400 })
    }
    if (!title) {
      return NextResponse.json({ error: "A title is required" }, { status: 400 })
    }
    if (file.size > MAX_RESOURCE_BYTES) {
      return NextResponse.json(
        { error: `File too large — max ${MAX_RESOURCE_BYTES / (1024 * 1024)} MB.` },
        { status: 413 },
      )
    }

    const category = VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : "client-resources"
    const audience = VALID_AUDIENCES.has(audienceRaw) ? audienceRaw : "team"

    const supabase = createAdminClient()

    // Resolve uploader name for display.
    let uploadedByName: string | null = null
    if (uploadedById && isUuid(uploadedById)) {
      const { data: tm } = await supabase
        .from("team_members")
        .select("full_name")
        .eq("id", uploadedById)
        .maybeSingle()
      uploadedByName = tm?.full_name ?? null
    }

    // ── Store in Blob ───────────────────────────────────────────────
    const blob = await put(`resources/${category}/${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    })
    uploadedBlobUrl = blob.url

    // ── Insert processing row ───────────────────────────────────────
    const { data: row, error: insertError } = await supabase
      .from("resource_documents")
      .insert({
        title,
        description,
        category,
        audience,
        file_url: blob.url,
        file_pathname: blob.pathname,
        file_name: file.name,
        mime_type: file.type || null,
        file_size_bytes: file.size,
        status: "processing",
        uploaded_by_id: uploadedById && isUuid(uploadedById) ? uploadedById : null,
        uploaded_by_name: uploadedByName,
      })
      .select("*")
      .single()

    if (insertError) {
      void del(blob.url).catch(() => {})
      throw insertError
    }

    // ── ALFRED reads the document ───────────────────────────────────
    const ingest = await ingestResourceDocument({
      fileUrl: blob.url,
      fileName: file.name,
      mimeType: file.type || null,
      title,
      description,
      category,
      audience,
    })

    const { data: updated, error: updateError } = await supabase
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
      .eq("id", row.id)
      .select(
        "id, title, description, category, audience, file_url, file_name, mime_type, file_size_bytes, version, status, ai_summary, ai_keywords, service_line_codes, ingest_error, ingested_at, uploaded_by_id, uploaded_by_name, is_archived, created_at, updated_at",
      )
      .single()

    if (updateError) throw updateError

    return NextResponse.json({ document: updated }, { status: 201 })
  } catch (err: any) {
    console.error("[v0] POST /api/resources/documents error:", err)
    if (uploadedBlobUrl) void del(uploadedBlobUrl).catch(() => {})
    return NextResponse.json(
      { error: err?.message ?? "Failed to upload resource" },
      { status: 500 },
    )
  }
}
