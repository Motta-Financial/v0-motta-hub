import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { findOrCreateHubContact } from "@/lib/hub/find-or-create-contact"
import {
  buildCorsHeaders,
  isAllowedOrigin,
  handleCorsPreflight,
  rateLimitFor,
} from "@/lib/cors"
import { sendEmail } from "@/lib/email"
import { enrichIntakeSubmission } from "@/lib/jotform/enrich"
import { researchProspectQuestions } from "@/lib/jotform/research-questions"

/**
 * POST /api/public/contact
 *
 * Public website "Contact Us" form receiver. CORS-protected so only
 * motta.cpa (and the website team's preview domains) can post here.
 *
 * Behavior — per the user's chosen routing:
 *   1. Always insert a row into website_contact_submissions (full audit
 *      trail of every message, even spam — we set is_spam=true and
 *      filter it out of dashboards instead of dropping).
 *   2. Always email the team via Resend. Subject prefixed with
 *      "[Website Contact]" so it sorts cleanly in inboxes.
 *   3. Always create a Master Hub Contact via findOrCreateHubContact
 *      (Hub-first invariant — same as Calendly/Zoom/Jotform). The new
 *      contact gets source='website_contact', is_prospect=true, and
 *      the legacy_motta_client_id stamp.
 *
 * Karbon push intentionally stays manual for contact-form leads —
 * a teammate decides from the contact detail page whether the lead
 * is billable. This is different from the prospect form (auto-pushes)
 * and from Jotform intake (auto-pushes) because contact-form leads
 * are often "I have a question" rather than "I'm ready to engage."
 */

// Edge-incompatible because we use Node-only Supabase admin client +
// Resend SDK. Keep on the default Node runtime.
export const dynamic = "force-dynamic"

interface ContactSubmission {
  // Required
  name: string
  email: string
  message: string
  // Optional
  phone?: string
  subject?: string
  company?: string
  topic?: string // e.g. "individual-tax", "business-tax", "advisory", "other"
  source_page?: string // The URL on motta.cpa they submitted from
  // Honeypot — must be empty. Spambots fill hidden fields.
  website?: string
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req)
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const corsHeaders = buildCorsHeaders(origin)

  // A missing Origin (server-to-server / curl) is allowed — browser
  // CORS doesn't apply, and the rate limiter + honeypot below are
  // the real bot defenses.
  if (origin && !isAllowedOrigin(origin)) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: corsHeaders },
    )
  }

  // ── Rate limit by IP (in-mem; resets on cold start) ─────────────
  const ip = clientIp(req)
  const limited = rateLimitFor(`public:contact:${ip}`, {
    limit: 10,
    windowSec: 600, // 10 messages per 10 min per IP — generous enough
    // for a family filling out the form, harsh enough to throttle
    // bots that get past the honeypot.
  })
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many submissions, try again later" },
      {
        status: 429,
        headers: { ...corsHeaders, "Retry-After": String(limited.retryAfter) },
      },
    )
  }

  let body: ContactSubmission
  try {
    body = (await req.json()) as ContactSubmission
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: corsHeaders },
    )
  }

  // ── Honeypot ─────────────────────────────────────────────────────
  // We accept the request (200 OK) so the bot thinks it succeeded,
  // but flag the row as spam and skip every downstream side effect.
  // This is more useful than 400-ing because it leaves a forensic
  // trail and avoids tipping off the spam tool to retry with a
  // different payload.
  const isSpam = !!body.website?.trim()

  // ── Validate ─────────────────────────────────────────────────────
  const name = body.name?.trim() || ""
  const email = body.email?.trim().toLowerCase() || ""
  const message = body.message?.trim() || ""

  if (!isSpam) {
    if (!name || name.length > 200) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400, headers: corsHeaders },
      )
    }
    if (!email || !isValidEmail(email) || email.length > 320) {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400, headers: corsHeaders },
      )
    }
    if (!message || message.length < 5 || message.length > 5000) {
      return NextResponse.json(
        { error: "Message must be 5–5000 characters" },
        { status: 400, headers: corsHeaders },
      )
    }
  }

  const supabase = createAdminClient()

  // ── 1. Insert audit row ─────────────────────────────────────────
  const { data: row, error: insertError } = await supabase
    .from("website_contact_submissions")
    .insert({
      name: name || null,
      email: email || null,
      phone: body.phone?.trim() || null,
      subject: body.subject?.trim() || null,
      company: body.company?.trim() || null,
      topic: body.topic?.trim() || null,
      message: message || null,
      source_page: body.source_page?.trim() || null,
      origin: origin || null,
      ip_address: ip,
      user_agent: req.headers.get("user-agent") || null,
      is_spam: isSpam,
    })
    .select("id")
    .single()

  if (insertError) {
    console.error("[v0] [public/contact] insert failed:", insertError)
    return NextResponse.json(
      { error: "Submission failed" },
      { status: 500, headers: corsHeaders },
    )
  }

  // Spam — return success and bail before any side effects.
  if (isSpam) {
    console.log(`[v0] [public/contact] honeypot triggered, ip=${ip}`)
    return NextResponse.json(
      { ok: true, submission_id: row.id },
      { status: 200, headers: corsHeaders },
    )
  }

  // ── 2. Master Hub Contact (Hub-first invariant) ─────────────────
  let hubContactId: string | null = null
  try {
    const hub = await findOrCreateHubContact(
      {
        email,
        fullName: name,
        businessName: body.company ?? null,
        phone: body.phone ?? null,
      },
      { source: "website_contact", supabase, skipInternal: true },
    )
    hubContactId = hub.contact_id
    if (hubContactId) {
      // Link the submission row to the contact for the dashboard.
      await supabase
        .from("website_contact_submissions")
        .update({
          contact_id: hubContactId,
          linked_at: new Date().toISOString(),
        })
        .eq("id", row.id)
    }
  } catch (err) {
    // Non-blocking — we still email the team and keep the audit row.
    console.error("[v0] [public/contact] hub create failed:", err)
  }

  // ── 3. Run ALFRED research passes (best-effort, capped) ─────────
  // We deliberately reuse the Jotform intake helpers — same brain,
  // same outputs, same fail-soft semantics. The shapes are a strict
  // subset of what the intake pipeline expects (no business
  // address, etc.), and both helpers tolerate nulls.
  const researchInput = {
    id: row.id as string,
    submitter_full_name: name,
    business_name: body.company ?? null,
    business_state: null,
    business_summary: null,
    questions_or_concerns: message,
    additional_notes: null,
    service_focus: body.topic ?? null,
    organization_id: null,
    contact_id: hubContactId,
  }
  const [enrichmentResult, researchResult] = await Promise.allSettled([
    enrichIntakeSubmission(supabase, researchInput),
    researchProspectQuestions({
      questions_or_concerns: message,
      business_name: body.company ?? null,
      business_state: null,
      service_focus: body.topic ?? null,
    }),
  ])
  const enrichment =
    enrichmentResult.status === "fulfilled" ? enrichmentResult.value : null
  const questionResearch =
    researchResult.status === "fulfilled" ? researchResult.value : null

  // ── 4. Notify the team via Resend ───────────────────────────────
  try {
    const subjectLine = body.subject?.trim()
      ? `[Website Contact] ${body.subject.trim().slice(0, 80)}`
      : `[Website Contact] New message from ${name}`

    const html = buildContactEmailHtml({
      name,
      email,
      phone: body.phone,
      company: body.company,
      topic: body.topic,
      subject: body.subject,
      message,
      sourcePage: body.source_page,
      hubContactId,
      submissionId: row.id,
      enrichment,
      questionResearch,
    })

    await sendEmail({
      to: process.env.WEBSITE_CONTACT_NOTIFY_TO?.split(",").map((s) => s.trim()) ?? [
        "team@motta.cpa",
      ],
      subject: subjectLine,
      html,
      // Reply-To set so a teammate can hit "Reply" and email the lead
      // back without copy/paste.
      replyTo: email,
    })
  } catch (err) {
    console.error("[v0] [public/contact] email notify failed:", err)
  }

  return NextResponse.json(
    { ok: true, submission_id: row.id, contact_id: hubContactId },
    { status: 200, headers: corsHeaders },
  )
}

function escape(s: string | null | undefined): string {
  if (!s) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildContactEmailHtml(p: {
  name: string
  email: string
  phone?: string
  company?: string
  topic?: string
  subject?: string
  message: string
  sourcePage?: string
  hubContactId: string | null
  submissionId: string
  enrichment: {
    summary?: string | null
    websites?: Array<{ url: string; title?: string }>
  } | null
  questionResearch: {
    summary?: string | null
    key_points?: string[] | null
    references?: Array<{ url: string; title?: string }> | null
  } | null
}): string {
  // Brand palette mirrors lib/email.ts so this email renders identically
  // to the intake / debrief / Tommy emails in every inbox.
  const C = {
    primary: "#6B745D",
    primaryDark: "#5A6250",
    surface: "#FFFFFF",
    background: "#EAE6E1",
    textPrimary: "#1F2520",
    textMuted: "#6B7066",
    border: "#D8D3CB",
    accent: "#C97B3F",
  } as const

  const hubBase = process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.motta.cpa"
  const hubLink = p.hubContactId
    ? `${hubBase}/clients/${p.hubContactId}`
    : `${hubBase}/admin/website-contacts`

  // ── 1. General Info ─────────────────────────────────────────────
  const identityRows: Array<[string, string | undefined]> = [
    ["From", p.name],
    [
      "Email",
      p.email
        ? `<a href="mailto:${escape(p.email)}" style="color:${C.primaryDark};">${escape(p.email)}</a>`
        : undefined,
    ],
    [
      "Phone",
      p.phone
        ? `<a href="tel:${escape(p.phone.replace(/[^\d+]/g, ""))}" style="color:${C.primaryDark};">${escape(p.phone)}</a>`
        : undefined,
    ],
    ["Company", p.company ? escape(p.company) : undefined],
    ["Topic", p.topic ? escape(p.topic) : undefined],
    ["Subject", p.subject ? escape(p.subject) : undefined],
    ["Source page", p.sourcePage ? escape(p.sourcePage) : undefined],
  ]
  const rowsHtml = identityRows
    .filter(([, v]) => v && String(v).trim())
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px;font-size:13px;color:${C.textMuted};width:160px;vertical-align:top;">${escape(k)}</td><td style="padding:8px 12px;font-size:14px;color:${C.textPrimary};">${v}</td></tr>`,
    )
    .join("")

  const enrichmentBlock = p.enrichment?.summary
    ? `<div style="margin-top:16px;">
        <div style="font-size:12px;color:${C.primaryDark};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">ALFRED · Prospect Research</div>
        <div style="background:${C.surface};border:1px solid ${C.border};border-radius:6px;padding:12px 16px;font-size:14px;color:${C.textPrimary};line-height:1.5;white-space:pre-wrap;">${escape(p.enrichment.summary)}</div>
        ${
          p.enrichment.websites && p.enrichment.websites.length > 0
            ? `<div style="margin-top:8px;font-size:12px;color:${C.textMuted};">Researched: ${p.enrichment.websites
                .map(
                  (w) =>
                    `<a href="${escape(w.url)}" style="color:${C.primaryDark};">${escape(w.title ?? w.url)}</a>`,
                )
                .join(" · ")}</div>`
            : ""
        }
      </div>`
    : ""

  // ── 2. Client Questions ─────────────────────────────────────────
  const messageBlock = `
    <div>
      <div style="font-size:12px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Their message</div>
      <div style="background:#fff7ed;border-left:3px solid ${C.accent};padding:12px 16px;border-radius:4px;font-size:14px;color:${C.textPrimary};white-space:pre-wrap;line-height:1.5;">${escape(p.message)}</div>
    </div>`

  const r = p.questionResearch
  const researchBlock = r?.summary
    ? `<div style="margin-top:16px;">
        <div style="font-size:12px;color:${C.primaryDark};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">ALFRED · Draft Response</div>
        <div style="background:${C.surface};border:1px solid ${C.border};border-radius:6px;padding:12px 16px;font-size:14px;color:${C.textPrimary};line-height:1.55;white-space:pre-wrap;">${escape(r.summary)}</div>
        ${
          r.key_points && r.key_points.length > 0
            ? `<div style="margin-top:10px;">
                <div style="font-size:12px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Suggested action items</div>
                <ul style="margin:0;padding-left:18px;color:${C.textPrimary};font-size:14px;line-height:1.55;">
                  ${r.key_points.map((kp) => `<li style="margin-bottom:4px;">${escape(kp)}</li>`).join("")}
                </ul>
              </div>`
            : ""
        }
        ${
          r.references && r.references.length > 0
            ? `<div style="margin-top:8px;font-size:12px;color:${C.textMuted};">References: ${r.references
                .map(
                  (ref) =>
                    `<a href="${escape(ref.url)}" style="color:${C.primaryDark};">${escape(ref.title ?? ref.url)}</a>`,
                )
                .join(" · ")}</div>`
            : ""
        }
        <div style="margin-top:6px;font-size:11px;color:${C.textMuted};font-style:italic;">Draft research — review before sharing with the prospect.</div>
      </div>`
    : ""

  // ── 3. Potential Client Value ───────────────────────────────────
  // Contact-form messages are too thin for a useful fee estimate, so
  // we surface a single-line note pointing the partner to send them
  // the intake form (which DOES estimate fees) if the conversation
  // warrants it.
  const valueBlock = `
    <div style="background:${C.surface};border:1px solid ${C.border};border-radius:6px;padding:12px 16px;font-size:13px;color:${C.textPrimary};line-height:1.55;">
      <strong>Light touch:</strong> contact-form messages don&#39;t include enough information for a fee estimate.
      If this conversation looks billable, send them the
      <a href="https://www.mottafinancial.com/intake-form" style="color:${C.primaryDark};">intake form</a>
      and ALFRED will draft an estimate from those answers.
    </div>`

  const sectionHeader = (title: string) =>
    `<h2 style="color:${C.textPrimary};font-size:14px;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid ${C.border};text-transform:uppercase;letter-spacing:0.5px;">${escape(title)}</h2>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${C.background};">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px;">
    <div style="background:${C.surface};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);border:1px solid ${C.border};">
      <div style="background:${C.primary};padding:18px 28px;">
        <table width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="vertical-align:middle;">
              <div style="color:${C.surface};font-size:18px;font-weight:700;letter-spacing:0.04em;">MOTTA HUB</div>
              <div style="color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">From ALFRED Ai</div>
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <span style="display:inline-block;background:rgba(255,255,255,0.15);color:${C.surface};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:5px 10px;border-radius:999px;">Website Message</span>
            </td>
          </tr>
        </table>
      </div>

      <div style="padding:32px;">
        <h1 style="color:${C.textPrimary};font-size:22px;margin:0 0 4px;font-weight:700;letter-spacing:-0.01em;">New message from ${escape(p.name)}${p.company ? ` <span style="color:${C.textMuted};font-weight:500;">· ${escape(p.company)}</span>` : ""}</h1>
        <p style="color:${C.textMuted};font-size:13px;margin:0 0 8px;">Submission ${escape(p.submissionId)}</p>

        ${sectionHeader("General Info")}
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${rowsHtml}</tbody>
        </table>
        ${enrichmentBlock}

        ${sectionHeader("Client Questions")}
        ${messageBlock}
        ${researchBlock}

        ${sectionHeader("Potential Client Value")}
        ${valueBlock}

        <div style="margin-top:32px;text-align:center;">
          <a href="${escape(hubLink)}" style="display:inline-block;background:${C.primary};color:${C.surface};padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.02em;">${
            p.hubContactId ? "Open contact in MOTTA HUB &rarr;" : "Open in MOTTA HUB &rarr;"
          }</a>
        </div>
      </div>

      <div style="background:${C.background};padding:16px 28px;border-top:1px solid ${C.border};">
        <p style="font-size:11px;color:${C.textMuted};margin:0;text-align:center;letter-spacing:0.02em;">
          ALFRED Ai · Replies to this email go directly to the prospect.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`
}
