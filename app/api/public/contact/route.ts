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

  // ── 3. Notify the team via Resend ───────────────────────────────
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
}): string {
  const hubBase =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.motta.cpa"
  const hubLink = p.hubContactId
    ? `${hubBase}/clients/${p.hubContactId}`
    : `${hubBase}/admin/website-contacts`
  const rows: Array<[string, string | undefined]> = [
    ["From", p.name],
    ["Email", p.email],
    ["Phone", p.phone],
    ["Company", p.company],
    ["Topic", p.topic],
    ["Subject", p.subject],
    ["Source page", p.sourcePage],
  ]
  const rowsHtml = rows
    .filter(([, v]) => v && String(v).trim())
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:12px;">${escape(k)}</td><td style="padding:4px 0;font-size:14px;">${escape(v ?? "")}</td></tr>`,
    )
    .join("")

  return `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#111827;max-width:640px;">
  <h2 style="margin:0 0 4px 0;font-size:18px;">New website contact form</h2>
  <p style="margin:0 0 16px 0;color:#6b7280;font-size:13px;">Submission ${escape(p.submissionId)}</p>
  <table style="border-collapse:collapse;margin-bottom:16px;">${rowsHtml}</table>
  <div style="border-left:3px solid #e5e7eb;padding:8px 0 8px 12px;white-space:pre-wrap;font-size:14px;line-height:1.5;">${escape(
    p.message,
  )}</div>
  <p style="margin:20px 0 0 0;font-size:13px;">
    <a href="${escape(hubLink)}" style="color:#2563eb;text-decoration:none;">${
      p.hubContactId ? "Open contact in Hub" : "Open in Hub"
    }</a>
  </p>
</div>`.trim()
}
