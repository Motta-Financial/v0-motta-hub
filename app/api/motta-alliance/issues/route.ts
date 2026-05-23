/**
 * POST /api/motta-alliance/issues   — publish a new edition
 * GET  /api/motta-alliance/issues   — list published editions
 *
 * The publish flow is a single end-to-end action invoked by the
 * "Issue New Edition" dialog on /motta-alliance:
 *
 *   1. Resolve the calling team member (cookie or bearer). The issuer
 *      ends up stamped on the row + the email's "Issued by ..." line.
 *   2. Load the most-recent published editions so Claude has continuity
 *      context — character arcs, prior cliffhangers, in-universe lore.
 *   3. Fetch the just-uploaded PDF bytes from Blob, ship them to Claude
 *      as a native PDF document part, and ask for a 2-4 paragraph
 *      story-preview teaser. Falls back to a deterministic placeholder
 *      if the model fails so we still ship the edition.
 *   4. INSERT the row (with `ai_summary` set so the gallery can render
 *      the preview as a tooltip / inline blurb).
 *   5. Build the email HTML with `buildMottaAllianceIssueHtml` and send
 *      it via Resend, attaching the PDF as a real attachment alongside.
 *   6. UPDATE the row with delivery counts so future debugging can tell
 *      who didn't receive the email.
 *
 * The GET surface is read-only and used by the gallery to render the
 * uploaded editions alongside the seeded constants.
 */

import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { createAdminClient } from "@/lib/supabase/server"
import { resolveAlfredUser } from "@/lib/alfred/resolve-user"
import {
  buildMottaAllianceIssueHtml,
  sendEmail,
  resolveRecipientsForCategory,
} from "@/lib/email"
import { QUESTION_RESEARCH_MODEL } from "@/lib/ai/models"
import { logAIUsage } from "@/lib/ai/config"

export const maxDuration = 120
export const dynamic = "force-dynamic"

interface IssueSubmitBody {
  title: string
  issueNumber: string
  series?: string | null
  arc?: string | null
  tagline?: string | null
  characters?: string[]
  variant?: string | null
  pdfUrl: string
  pdfPathname?: string | null
  pdfFilename: string
  pdfSizeBytes?: number | null
}

/** Strip everything except a-z 0-9 dashes so the slug is URL-safe and
 *  friendly as a downloaded filename. Keeps the human-typed casing for
 *  display fields; this is just the persistence handle. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

/* ─────────────────────────────────────────────────────────────────────
 * GET /api/motta-alliance/issues
 * ───────────────────────────────────────────────────────────────────── */
export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("motta_alliance_issues")
    .select(
      "id, slug, series, issue_number, title, arc, tagline, characters, pdf_url, variant, ai_summary, created_by_name, published_at, email_sent_at, email_sent_count",
    )
    .order("published_at", { ascending: false })

  if (error) {
    console.error("[motta-alliance/issues GET] error:", error)
    return NextResponse.json(
      { error: "Failed to load editions", details: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ issues: data ?? [] })
}

/* ─────────────────────────────────────────────────────────────────────
 * POST /api/motta-alliance/issues
 * ───────────────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────
  const user = await resolveAlfredUser(req)
  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    )
  }

  let body: IssueSubmitBody
  try {
    body = (await req.json()) as IssueSubmitBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // ── 2. Validate ────────────────────────────────────────────────────
  if (!body.title || !body.title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 })
  }
  if (!body.issueNumber || !body.issueNumber.trim()) {
    return NextResponse.json(
      { error: "Issue number is required (e.g. \"Issue 3\")" },
      { status: 400 },
    )
  }
  if (!body.pdfUrl || !body.pdfFilename) {
    return NextResponse.json(
      { error: "Upload a PDF before submitting" },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  // ── 3. Previous-issue context for Claude ──────────────────────────
  // We pass titles + arcs + Claude-generated summaries from the most
  // recent editions so the new preview stays consistent with established
  // lore. Five is enough for continuity without blowing the token budget.
  const { data: priorIssues } = await supabase
    .from("motta_alliance_issues")
    .select("issue_number, title, arc, tagline, characters, ai_summary, published_at")
    .order("published_at", { ascending: false })
    .limit(5)

  // ── 4. Fetch the uploaded PDF bytes ───────────────────────────────
  // The blob is public so we can fetch it directly. We then convert to
  // base64 because the AI SDK file part wants either a URL or a binary
  // payload — the simplest cross-runtime path is a Buffer.
  let pdfBuffer: Buffer | null = null
  try {
    const res = await fetch(body.pdfUrl)
    if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`)
    const ab = await res.arrayBuffer()
    pdfBuffer = Buffer.from(ab)
  } catch (err) {
    console.error("[motta-alliance/issues] PDF fetch failed:", err)
    // Don't bail — we can still publish; Claude just gets the metadata.
  }

  // ── 5. AI summary ─────────────────────────────────────────────────
  const aiStarted = Date.now()
  let aiSummary = ""
  let aiSuccess = false
  let aiError: string | undefined

  try {
    const priorContext =
      (priorIssues ?? [])
        .map((p) => {
          const header = `${p.issue_number} — ${p.title}${p.arc ? ` (${p.arc})` : ""}`
          const cast =
            Array.isArray(p.characters) && p.characters.length > 0
              ? `\nFeatured: ${p.characters.join(", ")}`
              : ""
          const summary = p.ai_summary ? `\n${p.ai_summary}` : ""
          return `### ${header}${cast}${summary}`
        })
        .join("\n\n") || "(no prior editions on file yet)"

    const metaBlock = [
      `Series: ${body.series || "Motta Alliance"}`,
      `Issue: ${body.issueNumber}`,
      `Title: ${body.title}`,
      body.arc ? `Story arc: ${body.arc}` : null,
      body.tagline ? `Cover tagline: "${body.tagline}"` : null,
      Array.isArray(body.characters) && body.characters.length > 0
        ? `Featured characters: ${body.characters.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n")

    const userPrompt = `A new edition of the Motta Alliance comic book series has just been published. Read the attached PDF and write a 2–4 paragraph "story preview" that the team will read in the announcement email.

PREVIOUS EDITIONS (for continuity):
${priorContext}

NEW EDITION METADATA:
${metaBlock}

WRITING GUIDELINES:
- Open with a hook that connects to the prior arc when relevant.
- Tease the storyline without giving away the ending — this is a preview, not a recap.
- Match the firm's voice: confident, witty, slightly cinematic, never silly.
- Reference the featured characters by name so teammates see themselves in the story.
- Keep it to 120–220 words total. No bullet lists. No headings. Pure prose.
- Do NOT mention the PDF, attachments, or that you're an AI.
- End on a single line that nudges the reader to open the issue.`

    // Anthropic via the Vercel AI Gateway accepts inline PDF documents
    // as a "file" part on a user message. When we couldn't fetch the
    // PDF we just send the metadata + prior issues and let Claude write
    // a meta-summary; the body of the email will still ship.
    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "file"; data: Buffer; mediaType: string; filename?: string }
    > = [{ type: "text", text: userPrompt }]
    if (pdfBuffer) {
      userContent.push({
        type: "file",
        data: pdfBuffer,
        mediaType: "application/pdf",
        filename: body.pdfFilename,
      })
    }

    const result = await generateText({
      model: QUESTION_RESEARCH_MODEL,
      system:
        "You are ALFRED Ai, the Motta Financial in-house assistant. You're announcing a new edition of the firm's internal comic book series, the Motta Alliance, to the team. You write polished, on-brand prose — confident, warm, lightly cinematic, never twee. You stay in-universe.",
      messages: [{ role: "user", content: userContent }],
    })
    aiSummary = (result.text || "").trim()
    aiSuccess = aiSummary.length > 0
    if (!aiSuccess) {
      aiError = "Empty model response"
    }
  } catch (err) {
    console.error("[motta-alliance/issues] Claude summary failed:", err)
    aiError = err instanceof Error ? err.message : "Unknown AI error"
  }

  // Fire-and-forget usage logging — matches the pattern used by the
  // daily briefing and tommy recap cron jobs.
  logAIUsage({
    useCase: "daily_briefing", // closest existing bucket; preview prose
    model: QUESTION_RESEARCH_MODEL,
    latencyMs: Date.now() - aiStarted,
    success: aiSuccess,
    errorMessage: aiError,
    userId: user.authUserId,
    userEmail: user.email,
    metadata: {
      surface: "motta_alliance",
      issue_number: body.issueNumber,
      title: body.title,
    },
  })

  // Deterministic fallback so the email still lands even if Claude is
  // down. Reads like a hand-written cover blurb — bland but on-brand.
  if (!aiSummary) {
    const cast =
      Array.isArray(body.characters) && body.characters.length > 0
        ? body.characters.join(", ")
        : "the whole Alliance"
    aiSummary = `${body.issueNumber} of the Motta Alliance has dropped: ${body.title}${
      body.arc ? ` — ${body.arc}` : ""
    }.\n\nThis edition features ${cast}. ${
      body.tagline ? `"${body.tagline}"\n\n` : ""
    }Open the PDF to read the full story.`
  }

  // ── 6. Insert the row ─────────────────────────────────────────────
  const slug = `${slugify(body.title)}-${Math.random().toString(36).slice(2, 6)}`
  const submitterName =
    user.fullName || user.email || "A teammate"

  const { data: inserted, error: insertErr } = await supabase
    .from("motta_alliance_issues")
    .insert({
      slug,
      series: body.series?.trim() || "Motta Alliance",
      issue_number: body.issueNumber.trim(),
      title: body.title.trim(),
      arc: body.arc?.trim() || null,
      tagline: body.tagline?.trim() || null,
      characters: Array.isArray(body.characters)
        ? body.characters.map((c) => c.trim()).filter(Boolean)
        : [],
      pdf_url: body.pdfUrl,
      pdf_pathname: body.pdfPathname ?? null,
      pdf_size_bytes: body.pdfSizeBytes ?? null,
      variant: (body.variant?.trim() || "olive").toLowerCase(),
      ai_summary: aiSummary,
      created_by_id: user.teamMemberId,
      created_by_name: submitterName,
    })
    .select(
      "id, slug, series, issue_number, title, arc, tagline, characters, pdf_url, variant, ai_summary, created_by_name, published_at",
    )
    .single()

  if (insertErr || !inserted) {
    console.error("[motta-alliance/issues] insert error:", insertErr)
    return NextResponse.json(
      { error: "Failed to save edition", details: insertErr?.message },
      { status: 500 },
    )
  }

  // ── 7. Email the team ─────────────────────────────────────────────
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    "https://hub.motta.cpa"
  const hubUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`
  const galleryUrl = `${hubUrl}/motta-alliance`

  const emailHtml = buildMottaAllianceIssueHtml({
    issueLabel: `${inserted.series} · ${inserted.issue_number}`,
    title: inserted.title,
    arc: inserted.arc,
    tagline: inserted.tagline,
    characters: inserted.characters ?? [],
    aiSummary,
    submittedBy: submitterName,
    galleryUrl,
    pdfUrl: inserted.pdf_url,
    pdfFilename: body.pdfFilename,
  })

  // Recipient pool: every active team member who hasn't opted out of
  // the Motta Alliance category. We resolve recipients FIRST so we know
  // how many attempts were skipped due to preferences — that goes into
  // the audit row.
  const { data: allMembers } = await supabase
    .from("team_members")
    .select("id")
    .eq("is_active", true)
    .not("role", "eq", "Alumni")

  const memberIds = (allMembers ?? []).map((m) => m.id)
  const recipients = await resolveRecipientsForCategory(
    memberIds,
    "motta_alliance",
  )

  let emailSentCount = 0
  let emailSkippedCount = memberIds.length - recipients.length
  let emailError: string | undefined

  if (recipients.length > 0) {
    const subject = `Motta Alliance — ${inserted.issue_number}: ${inserted.title}`
    const sendResult = await sendEmail({
      to: recipients.map((r) => r.email),
      subject,
      html: emailHtml,
      attachments: [
        {
          // Resend will fetch the public Blob URL and inline the PDF as
          // a real mail attachment. Friendly filename so the recipient
          // gets a clean save name instead of the blob hash.
          filename: body.pdfFilename,
          path: inserted.pdf_url,
          contentType: "application/pdf",
        },
      ],
    })

    if (sendResult.success) {
      emailSentCount = recipients.length
    } else {
      emailSkippedCount += recipients.length
      emailError = sendResult.error || "Unknown email error"
      console.error("[motta-alliance/issues] email send failed:", emailError)
    }
  }

  // ── 8. Persist delivery audit + stash the rendered HTML ──────────
  await supabase
    .from("motta_alliance_issues")
    .update({
      ai_email_body_html: emailHtml,
      email_sent_at: emailSentCount > 0 ? new Date().toISOString() : null,
      email_attempted_count: memberIds.length,
      email_sent_count: emailSentCount,
      email_skipped_count: emailSkippedCount,
      email_error: emailError ?? null,
    })
    .eq("id", inserted.id)

  return NextResponse.json(
    {
      issue: inserted,
      ai: { used: aiSuccess, error: aiError ?? null },
      email: {
        attempted: memberIds.length,
        sent: emailSentCount,
        skipped: emailSkippedCount,
        error: emailError ?? null,
      },
    },
    { status: 201 },
  )
}
