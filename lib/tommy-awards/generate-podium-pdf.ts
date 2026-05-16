/**
 * Tommy Awards — Weekly Recap PDF Generator
 *
 * Produces a printable / shareable PDF version of the Friday Tommy
 * recap, mirroring what teammates receive in the recap email:
 *   - MOTTA ALLIANCE — TOMMY AWARDS header strip
 *   - Generated F1-podium hero image (3:2) rendered full-width
 *   - Week label + total ballots
 *   - ALFRED Ai's narrated summary (auto-wrapped to page width)
 *   - The top-three podium with point totals
 *
 * The PDF is uploaded to Vercel Blob and the public URL is returned.
 * The cron route attaches the file to the recap email AND persists the
 * URL on `tommy_weekly_recaps.podium_pdf_url` so the new "Weekly
 * Tommy's" tab on the Motta Alliance page can link straight to it.
 *
 * pdf-lib is intentionally the only PDF dependency — it's already
 * vendored in this project for other PDF flows and runs in Node + edge.
 * Resolves to `null` on failure so the caller can degrade gracefully
 * (the email still ships, just without the attachment).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib"
import { put } from "@vercel/blob"

// ── Brand palette (matches the dark Motta Alliance theme) ──────────
const COLOR_BG = rgb(15 / 255, 20 / 255, 12 / 255) // #0F140C — page background
const COLOR_PANEL = rgb(22 / 255, 28 / 255, 18 / 255) // slightly lighter panel
const COLOR_OLIVE = rgb(168 / 255, 197 / 255, 102 / 255) // #A8C566 — accent
const COLOR_AMBER = rgb(230 / 255, 168 / 255, 92 / 255) // #E6A85C — gold accent
const COLOR_CREAM = rgb(244 / 255, 239 / 255, 232 / 255) // #F4EFE8 — body copy
const COLOR_MUTED = rgb(184 / 255, 179 / 255, 170 / 255) // #B8B3AA — secondary copy

// US Letter portrait — chosen over A4 so partners forwarding to US
// clients get a familiar default. 0.5" inner margin.
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 36

/**
 * Simple greedy word-wrap that breaks `text` into lines that fit
 * within `maxWidth` when rendered with `font` at `size`. pdf-lib
 * doesn't ship a layout engine so we do this ourselves rather than
 * pulling in a heavier dependency.
 */
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = []
  // Preserve intentional paragraph breaks ("\n\n") — they translate
  // straight into blank lines so ALFRED's paragraphs stay separated.
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n/)
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      out.push("")
      continue
    }
    const words = paragraph.split(/\s+/)
    let line = ""
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      const width = font.widthOfTextAtSize(candidate, size)
      if (width <= maxWidth) {
        line = candidate
      } else {
        if (line) out.push(line)
        // Word longer than the line? Hard-break it character by character.
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = ""
          for (const ch of word) {
            const chunkCandidate = chunk + ch
            if (font.widthOfTextAtSize(chunkCandidate, size) > maxWidth) {
              out.push(chunk)
              chunk = ch
            } else {
              chunk = chunkCandidate
            }
          }
          line = chunk
        } else {
          line = word
        }
      }
    }
    if (line) out.push(line)
  }
  return out
}

/**
 * Sanitize text so pdf-lib's WinAnsi encoder doesn't blow up. ALFRED
 * occasionally emits curly quotes / em-dashes / non-breaking spaces;
 * we replace the most common offenders with WinAnsi-safe equivalents
 * rather than failing the whole PDF render.
 */
function sanitizeForPdf(input: string): string {
  return input
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2000-\u200B]/g, " ")
}

export interface PodiumPdfWinner {
  name: string
  rank: number
  totalPoints: number
  first?: number
  second?: number
  third?: number
}

export interface PodiumPdfResult {
  pdfUrl: string
  byteLength: number
}

/**
 * Build the PDF in-memory, upload to Vercel Blob, return the public
 * URL. Returns null if anything blows up — the caller (cron route) is
 * tolerant of a missing attachment.
 */
export async function generatePodiumPdf(opts: {
  weekId: string
  weekLabel: string
  aiSummary: string
  topThree: ReadonlyArray<PodiumPdfWinner>
  totalBallots: number
  podiumImageUrl: string | null
}): Promise<PodiumPdfResult | null> {
  try {
    const pdfDoc = await PDFDocument.create()
    pdfDoc.setTitle(`Tommy Awards Recap — ${opts.weekLabel}`)
    pdfDoc.setAuthor("ALFRED Ai — Motta Financial Alliance")
    pdfDoc.setSubject("Weekly Tommy Awards Recap")
    pdfDoc.setProducer("MOTTA HUB")
    pdfDoc.setCreator("MOTTA HUB · Tommy Awards")
    pdfDoc.setCreationDate(new Date())

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

    // ── Try to embed the generated podium image ──────────────────
    // gpt-image-2 typically returns PNG; we try PNG first, then JPG,
    // then degrade to no image. Resolving the fetch with `cache:
    // "no-store"` keeps us off any stale Vercel edge cache when the
    // image was uploaded seconds ago.
    let podiumImage: PDFImage | null = null
    if (opts.podiumImageUrl) {
      try {
        const res = await fetch(opts.podiumImageUrl, { cache: "no-store" })
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer())
          try {
            podiumImage = await pdfDoc.embedPng(bytes)
          } catch {
            try {
              podiumImage = await pdfDoc.embedJpg(bytes)
            } catch (innerErr) {
              console.warn("[tommy-pdf] could not embed podium image:", innerErr)
            }
          }
        }
      } catch (err) {
        console.warn("[tommy-pdf] failed to fetch podium image:", err)
      }
    }

    // ── First page: cover ────────────────────────────────────────
    const page: PDFPage = pdfDoc.addPage([PAGE_W, PAGE_H])
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: COLOR_BG })

    // Top header strip
    const headerH = 56
    page.drawRectangle({
      x: 0,
      y: PAGE_H - headerH,
      width: PAGE_W,
      height: headerH,
      color: COLOR_PANEL,
    })
    page.drawRectangle({
      x: 0,
      y: PAGE_H - headerH - 2,
      width: PAGE_W,
      height: 2,
      color: COLOR_OLIVE,
    })
    page.drawText("MOTTA ALLIANCE", {
      x: MARGIN,
      y: PAGE_H - 28,
      size: 11,
      font: fontBold,
      color: COLOR_OLIVE,
    })
    page.drawText("TOMMY AWARDS — WEEKLY DISPATCH", {
      x: MARGIN,
      y: PAGE_H - 44,
      size: 8,
      font: fontBold,
      color: COLOR_MUTED,
    })
    const weekDateText = sanitizeForPdf(opts.weekLabel.toUpperCase())
    const weekDateW = fontBold.widthOfTextAtSize(weekDateText, 9)
    page.drawText(weekDateText, {
      x: PAGE_W - MARGIN - weekDateW,
      y: PAGE_H - 28,
      size: 9,
      font: fontBold,
      color: COLOR_AMBER,
    })
    const ballotsText = `${opts.totalBallots} BALLOTS`
    const ballotsW = font.widthOfTextAtSize(ballotsText, 8)
    page.drawText(ballotsText, {
      x: PAGE_W - MARGIN - ballotsW,
      y: PAGE_H - 44,
      size: 8,
      font,
      color: COLOR_MUTED,
    })

    let cursorY = PAGE_H - headerH - 24

    // ── Podium image, full content width, 3:2 aspect ─────────────
    const contentW = PAGE_W - MARGIN * 2
    if (podiumImage) {
      const targetH = contentW * (2 / 3)
      // Image frame (faint olive border)
      page.drawRectangle({
        x: MARGIN - 1,
        y: cursorY - targetH - 1,
        width: contentW + 2,
        height: targetH + 2,
        borderColor: COLOR_OLIVE,
        borderWidth: 1,
        color: COLOR_PANEL,
      })
      page.drawImage(podiumImage, {
        x: MARGIN,
        y: cursorY - targetH,
        width: contentW,
        height: targetH,
      })
      cursorY -= targetH + 18
    }

    // ── Title block ──────────────────────────────────────────────
    page.drawText("OPERATION TOMMY", {
      x: MARGIN,
      y: cursorY,
      size: 9,
      font: fontBold,
      color: COLOR_OLIVE,
    })
    cursorY -= 16
    page.drawText("This Week's Podium", {
      x: MARGIN,
      y: cursorY,
      size: 18,
      font: fontBold,
      color: COLOR_CREAM,
    })
    cursorY -= 20

    // ── Top-three list ───────────────────────────────────────────
    const RANK_LABELS = ["1st", "2nd", "3rd"]
    const RANK_COLORS = [COLOR_AMBER, COLOR_OLIVE, COLOR_AMBER]
    for (const winner of opts.topThree) {
      const idx = Math.max(0, Math.min(2, winner.rank - 1))
      const labelText = `${RANK_LABELS[idx]}.`
      page.drawText(labelText, {
        x: MARGIN,
        y: cursorY,
        size: 12,
        font: fontBold,
        color: RANK_COLORS[idx]!,
      })
      page.drawText(sanitizeForPdf(winner.name), {
        x: MARGIN + 36,
        y: cursorY,
        size: 12,
        font: fontBold,
        color: COLOR_CREAM,
      })
      const ptsText = `${winner.totalPoints} pts`
      const ptsW = fontBold.widthOfTextAtSize(ptsText, 12)
      page.drawText(ptsText, {
        x: PAGE_W - MARGIN - ptsW,
        y: cursorY,
        size: 12,
        font: fontBold,
        color: COLOR_OLIVE,
      })
      // Sub-line — vote breakdown.
      const breakdownParts: string[] = []
      if (winner.first) breakdownParts.push(`${winner.first}x1st`)
      if (winner.second) breakdownParts.push(`${winner.second}x2nd`)
      if (winner.third) breakdownParts.push(`${winner.third}x3rd`)
      if (breakdownParts.length > 0) {
        page.drawText(breakdownParts.join("  ·  "), {
          x: MARGIN + 36,
          y: cursorY - 13,
          size: 9,
          font,
          color: COLOR_MUTED,
        })
      }
      cursorY -= 30
    }

    cursorY -= 8

    // Divider rule
    page.drawRectangle({
      x: MARGIN,
      y: cursorY,
      width: contentW,
      height: 1,
      color: COLOR_OLIVE,
      opacity: 0.4,
    })
    cursorY -= 18

    // ── ALFRED summary ───────────────────────────────────────────
    page.drawText("ALFRED'S RECAP", {
      x: MARGIN,
      y: cursorY,
      size: 9,
      font: fontBold,
      color: COLOR_OLIVE,
    })
    cursorY -= 16

    const summarySize = 10.5
    const summaryLineHeight = 15
    const lines = wrapText(
      sanitizeForPdf(opts.aiSummary || ""),
      fontOblique,
      summarySize,
      contentW,
    )
    // Auto-paginate when the summary overflows. Tommy recaps are
    // 3-4 short paragraphs in practice so this is rarely triggered,
    // but we want to be safe rather than clip ALFRED mid-sentence.
    let activePage = page
    for (const line of lines) {
      if (cursorY < MARGIN + summaryLineHeight) {
        // Open a fresh continuation page with the same dark theme.
        activePage = pdfDoc.addPage([PAGE_W, PAGE_H])
        activePage.drawRectangle({
          x: 0,
          y: 0,
          width: PAGE_W,
          height: PAGE_H,
          color: COLOR_BG,
        })
        cursorY = PAGE_H - MARGIN
      }
      if (line) {
        activePage.drawText(line, {
          x: MARGIN,
          y: cursorY,
          size: summarySize,
          font: fontOblique,
          color: COLOR_CREAM,
        })
      }
      cursorY -= summaryLineHeight
    }

    // Footer
    const footerText = `Generated by ALFRED Ai · ${new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`
    activePage.drawText(footerText, {
      x: MARGIN,
      y: 24,
      size: 8,
      font,
      color: COLOR_MUTED,
    })
    const brandText = "MOTTA FINANCIAL ALLIANCE"
    const brandW = fontBold.widthOfTextAtSize(brandText, 8)
    activePage.drawText(brandText, {
      x: PAGE_W - MARGIN - brandW,
      y: 24,
      size: 8,
      font: fontBold,
      color: COLOR_OLIVE,
    })

    const bytes = await pdfDoc.save()

    // Upload to Vercel Blob with a stable, human-readable filename.
    // We allow overwrites so re-running the cron for a given week
    // (e.g. after fixing the recap) replaces the previous PDF.
    const safeLabel = opts.weekLabel
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "")
    const filename = `tommy-awards/recap-${safeLabel}-${opts.weekId}.pdf`
    // pdf-lib's `save()` returns a Uint8Array; @vercel/blob's `put`
    // wants a Buffer (or Blob / Readable / ReadableStream / File). We
    // wrap into a Buffer with no copy so the upload accepts it.
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const uploaded = await put(filename, buffer, {
      access: "public",
      contentType: "application/pdf",
      allowOverwrite: true,
    })

    return { pdfUrl: uploaded.url, byteLength: bytes.byteLength }
  } catch (err) {
    console.error("[tommy-pdf] generation failed:", err)
    return null
  }
}
