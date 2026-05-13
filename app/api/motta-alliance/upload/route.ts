/**
 * POST /api/motta-alliance/upload
 *
 * Pre-flight PDF upload for the Motta Alliance "Issue New Edition"
 * dialog. The dialog uploads the chosen file the moment it's selected
 * (or "Upload" is clicked) so the second submit step — which calls
 * Claude to read the PDF, persists the issue, and emails the team —
 * doesn't have to push a 20 MB blob through a JSON body.
 *
 * Mirrors /api/debriefs/attachments:
 *   - Returns {url, pathname, name, content_type, size_bytes}
 *   - Files land under `motta-alliance/pending/` so a future GC sweep
 *     can identify abandoned uploads (where the partner never clicked
 *     Submit) just by listing that prefix.
 *
 * Only PDFs are accepted; everything else is rejected with 415 so the
 * second route doesn't have to second-guess what's in the blob.
 */

import { type NextRequest, NextResponse } from "next/server"
import { put } from "@vercel/blob"

// Hard ceiling. Matches /api/debriefs/attachments. Resend caps the
// combined email payload around 40 MB, so 25 MB per file leaves room
// for the email HTML + headers without bouncing.
const MAX_PDF_BYTES = 25 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file supplied" }, { status: 400 })
    }

    // Belt-and-suspenders content-type check. Browsers sometimes lie
    // about MIME, so we also accept anything that ends in `.pdf` and
    // let Claude reject it later if it's actually not a PDF.
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf")
    if (!isPdf) {
      return NextResponse.json(
        { error: "Only PDF files are supported for Motta Alliance issues." },
        { status: 415 },
      )
    }

    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        {
          error: `File too large — max ${MAX_PDF_BYTES / (1024 * 1024)} MB per issue.`,
        },
        { status: 413 },
      )
    }

    const blob = await put(`motta-alliance/pending/${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/pdf",
    })

    return NextResponse.json(
      {
        attachment: {
          url: blob.url,
          pathname: blob.pathname,
          name: file.name,
          content_type: "application/pdf",
          size_bytes: file.size,
          uploaded_at: new Date().toISOString(),
        },
      },
      { status: 201 },
    )
  } catch (err: any) {
    console.error("[motta-alliance/upload] error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Failed to upload PDF" },
      { status: 500 },
    )
  }
}
