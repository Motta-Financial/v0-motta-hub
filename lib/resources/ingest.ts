/**
 * Resource document ingest — "ALFRED reads the document".
 * ────────────────────────────────────────────────────────────────────────
 * When a teammate uploads (or replaces) a resource on the /resources page,
 * we hand the file to Claude to:
 *   1. produce a faithful plain-text rendering ALFRED can later cite
 *      (`extracted_text`),
 *   2. write a short human summary (`ai_summary`),
 *   3. pull a handful of keywords (`ai_keywords`), and
 *   4. auto-tag it to one or more canonical service lines
 *      (`service_line_codes`, validated against public.service_lines).
 *
 * Why Claude instead of a PDF parser: the codebase already reads PDFs natively
 * through the AI Gateway (see app/api/motta-alliance/issues/route.ts) by passing
 * a `{ type: "file", mediaType: "application/pdf", data: Buffer }` content part.
 * That handles scanned/image PDFs, images, and plain text uniformly without a
 * brittle parsing dependency. Text-like files are decoded and sent as text.
 *
 * This module is pure logic: callers (the API routes) persist the result.
 */

import { generateObject } from "ai"
import { z } from "zod"
import { CLAUDE_SONNET } from "@/lib/ai/models"
import { createAdminClient } from "@/lib/supabase/server"

// ── Supported inputs ────────────────────────────────────────────────────────
// Claude reads PDFs + images natively as file parts. Text-like files are
// decoded to a string. Anything else (e.g. .docx, .xlsx) can't be read
// reliably without conversion, so we tag from title/description metadata only.
const PDF_TYPES = new Set(["application/pdf"])
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
])

function isTextLike(mime: string | null, fileName: string): boolean {
  const m = (mime || "").toLowerCase()
  if (m.startsWith("text/")) return true
  if (
    [
      "application/json",
      "application/csv",
      "text/csv",
      "application/xml",
      "text/markdown",
    ].includes(m)
  )
    return true
  return /\.(txt|md|markdown|csv|json|xml|html?|rtf)$/i.test(fileName)
}

export interface IngestInput {
  fileUrl: string
  fileName: string
  mimeType: string | null
  /** Teammate-provided context that improves tagging. */
  title: string
  description?: string | null
  category?: string | null
  audience?: string | null
}

export interface IngestResult {
  status: "ready" | "failed"
  extractedText: string | null
  summary: string | null
  keywords: string[]
  serviceLineCodes: string[]
  model: string
  error?: string
}

/**
 * Loads the canonical service-line codes from the DB so the model can only
 * pick real ones. Falls back to the known seed set if the table is empty.
 */
async function loadServiceLineCatalog(): Promise<
  { code: string; name: string; category: string | null }[]
> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("service_lines")
      .select("code, name, category, is_active")
      .eq("is_active", true)
      .order("display_order", { nullsFirst: false })
    if (data && data.length > 0) {
      return data.map((r) => ({
        code: String(r.code),
        name: String(r.name),
        category: r.category ? String(r.category) : null,
      }))
    }
  } catch (err) {
    console.error("[v0] resource ingest: failed to load service_lines:", err)
  }
  // Fallback mirrors scripts seed so tagging still works offline.
  return [
    { code: "TAX", name: "Tax Preparation", category: "Tax" },
    { code: "TAX-PLAN", name: "Tax Planning", category: "Tax" },
    { code: "ACCT", name: "Accounting", category: "Accounting" },
    { code: "PAYROLL", name: "Payroll", category: "Accounting" },
    { code: "ADVISORY", name: "Advisory", category: "Advisory" },
    { code: "CFO", name: "CFO Services", category: "Advisory" },
    { code: "AUDIT", name: "Audit & Assurance", category: "Assurance" },
    { code: "ESTATE", name: "Estate Planning", category: "Tax" },
  ]
}

/** Cap stored text so a giant doc can't bloat the row / ALFRED context. */
const MAX_EXTRACTED_CHARS = 60_000

/**
 * Reads a resource document with Claude and returns structured metadata.
 * Never throws — failures come back as { status: "failed", error }.
 */
export async function ingestResourceDocument(
  input: IngestInput,
): Promise<IngestResult> {
  const model = CLAUDE_SONNET
  const base: Omit<IngestResult, "status"> = {
    extractedText: null,
    summary: null,
    keywords: [],
    serviceLineCodes: [],
    model,
  }

  try {
    const catalog = await loadServiceLineCatalog()
    const validCodes = new Set(catalog.map((c) => c.code))
    const catalogText = catalog
      .map((c) => `- ${c.code}: ${c.name}${c.category ? ` (${c.category})` : ""}`)
      .join("\n")

    const mime = input.mimeType
    const isPdf = mime ? PDF_TYPES.has(mime.toLowerCase()) : /\.pdf$/i.test(input.fileName)
    const isImage = mime ? IMAGE_TYPES.has(mime.toLowerCase()) : false
    const textLike = isTextLike(mime, input.fileName)

    // Build the document content part for the model.
    const docParts: any[] = []
    let metadataOnly = false

    if (isPdf || isImage) {
      const res = await fetch(input.fileUrl)
      if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`)
      const buf = Buffer.from(await res.arrayBuffer())
      docParts.push({
        type: "file",
        data: buf,
        mediaType: isPdf ? "application/pdf" : (mime || "image/png"),
        filename: input.fileName,
      })
    } else if (textLike) {
      const res = await fetch(input.fileUrl)
      if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`)
      let text = await res.text()
      if (text.length > MAX_EXTRACTED_CHARS) text = text.slice(0, MAX_EXTRACTED_CHARS)
      docParts.push({ type: "text", text: `DOCUMENT CONTENTS:\n\n${text}` })
    } else {
      // Unsupported binary (e.g. .docx, .xlsx). Tag from metadata only.
      metadataOnly = true
    }

    const promptHeader =
      `You are ALFRED, the firm's assistant, reading a document that a teammate uploaded to the firm "Resources" knowledge base. ` +
      `Your job is to make it findable and useful later.\n\n` +
      `Document metadata provided by the uploader:\n` +
      `- Title: ${input.title}\n` +
      (input.description ? `- Description: ${input.description}\n` : "") +
      (input.category ? `- Section: ${input.category}\n` : "") +
      (input.audience ? `- Audience: ${input.audience}\n` : "") +
      `- File name: ${input.fileName}\n\n` +
      `Canonical service lines (tag with ZERO OR MORE of these CODES only — never invent a code):\n${catalogText}\n\n` +
      (metadataOnly
        ? `The file type could not be read directly. Infer the summary, keywords, and service-line tags from the metadata above. Leave extractedText empty.`
        : `Read the document and: (1) produce a faithful, clean plain-text rendering in extractedText (preserve headings, lists, and key figures; this is what ALFRED will cite later), (2) write a 2-4 sentence summary, (3) list 3-8 lowercase keywords, (4) choose the service-line CODES this document relates to.`)

    const { object } = await generateObject({
      model,
      schema: z.object({
        extractedText: z
          .string()
          .describe(
            "Faithful plain-text rendering of the document, or empty string if it could not be read.",
          ),
        summary: z.string().describe("2-4 sentence plain-language summary."),
        keywords: z.array(z.string()).describe("3-8 short lowercase keywords/phrases."),
        serviceLineCodes: z
          .array(z.string())
          .describe("Zero or more canonical service-line CODES this document relates to."),
      }),
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: promptHeader }, ...docParts],
        },
      ],
    })

    // Validate model output against the real catalog so a hallucinated code
    // never lands in the DB.
    const codes = Array.from(
      new Set((object.serviceLineCodes || []).map((c) => c.toUpperCase().trim())),
    ).filter((c) => validCodes.has(c))

    let extracted = (object.extractedText || "").trim() || null
    if (extracted && extracted.length > MAX_EXTRACTED_CHARS) {
      extracted = extracted.slice(0, MAX_EXTRACTED_CHARS)
    }

    return {
      ...base,
      status: "ready",
      extractedText: extracted,
      summary: (object.summary || "").trim() || null,
      keywords: (object.keywords || []).map((k) => k.toLowerCase().trim()).filter(Boolean).slice(0, 8),
      serviceLineCodes: codes,
    }
  } catch (err: any) {
    console.error("[v0] resource ingest failed:", err)
    return {
      ...base,
      status: "failed",
      error: err?.message ?? "Ingest failed",
    }
  }
}
