/**
 * Public Website Intake — POST /api/public/intake
 *
 * Lives at the boundary between the marketing site (motta.cpa) and
 * Motta Hub. Replaces the third-party Jotform Intake form: the
 * website's own React form posts JSON here, we synthesize a
 * Jotform-shaped payload, and route it through the EXACT same
 * pipeline live Jotform deliveries already use
 * (`upsertIntakeSubmission` → Karbon push → ALFRED enrichment →
 * post-intake-note → notify team).
 *
 * Why reuse the Jotform pipeline instead of building a parallel one?
 *   - Single Karbon push code path. We already battle-tested the
 *     Hub-first / Karbon-mirror flow on Jotform and don't want to
 *     duplicate it.
 *   - The intake list at /intake just reads from
 *     `jotform_intake_submissions`. Routing website submissions
 *     through the same table means they show up in the same place
 *     teammates already triage, with the same filters, the same
 *     ALFRED briefs, and the same auto-link badges.
 *   - If the website's form ever needs to evolve (add a field,
 *     remove one), only the synthesizer changes — every downstream
 *     consumer keeps working unchanged.
 *
 * Auth model:
 *   - PUBLIC. Any browser can call this. CORS is enforced via
 *     `withPublicCors` (origin must match motta.cpa or a configured
 *     preview domain). A honeypot field (`website` — left empty by
 *     real users, filled by bots) hard-rejects 99 % of spam without a
 *     captcha. Per-IP rate limiting throttles the rest.
 *
 * Why not a Jotform form_id of "website"?
 *   - `jotform_intake_submissions.jotform_submission_id` is the dedupe
 *     key (UNIQUE). Real Jotform submission IDs are 19-digit numerics;
 *     to keep both spaces non-overlapping we prefix website ones with
 *     "web_" + a v4 UUID. Migration 162 inserted a `jotform_forms` row
 *     with `jotform_form_id='website'` so the synthetic submissions
 *     resolve to a real form_uuid.
 */

import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { withPublicCors, jsonWithCors, optionsForCors } from "@/lib/cors"
import { upsertIntakeSubmission } from "@/lib/jotform/ingest"
import type { JotformSubmission, JotformAnswer } from "@/lib/jotform/client"

// We keep the runtime explicit: this calls Resend + ALFRED + Karbon
// and can occasionally take >5 s on cold start, which exceeds the
// edge runtime's default budget. Node runtime is required.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── CORS preflight ───────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return optionsForCors(req)
}

// ── Request shape (the contract for the website team) ──────────────
//
// Every field is optional EXCEPT one of (email, phone) — we need a
// way to contact the prospect. The website form should still mark
// most of them as required client-side; this server-side schema is
// intentionally permissive so iframe/widget integrations can post a
// minimal payload and still succeed.
//
// Field naming mirrors the Jotform-parsed columns on
// `jotform_intake_submissions` so the website team can read those
// column names from the documented API contract without learning two
// vocabularies.
type WebsiteIntakePayload = {
  // Honeypot — hidden field bots fill, real users leave empty.
  // Renamed from the obvious "spam_check" to "website" so naive
  // form-fillers that auto-fill any input named *url/website still
  // trip it.
  website?: string

  // Personal
  first_name?: string
  last_name?: string
  full_name?: string
  email?: string
  phone?: string
  street_address?: string
  city?: string
  state?: string
  zip?: string

  // Engagement
  services_requested?: string[]
  service_focus?: string
  entity_types?: string[]
  business_situation?: string

  // Business
  business_name?: string
  business_email?: string
  business_phone?: string
  business_state?: string
  business_tax_classification?: string
  business_revenue_range?: string
  business_employee_count?: string
  business_uses_accounting_system?: string
  business_summary?: string

  // Free text
  questions_or_concerns?: string
  additional_notes?: string
  referral_source?: string
  preferred_team_member?: string

  // Tracking — passed straight through to raw_answers for analytics.
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  page_url?: string
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
  return out.length > 0 ? out : null
}

/**
 * Synthesize a `JotformSubmission` from a website JSON payload.
 *
 * The Jotform parser keys answers by `name` (e.g. `personalEmail`,
 * `whatIs1` for fullname). We replicate those exact slugs so the
 * existing parser produces identical denormalized columns. Anything
 * the parser doesn't know about (UTM tags, page_url) is preserved
 * under a synthetic key in `raw_answers` so analytics queries can
 * still mine it later.
 */
function synthesizeJotformSubmission(
  payload: WebsiteIntakePayload,
): JotformSubmission {
  const answers: Record<string, JotformAnswer> = {}
  let qid = 1
  const next = () => String(qid++)
  const put = (name: string, answer: JotformAnswer["answer"]) => {
    if (answer == null) return
    if (typeof answer === "string" && answer.trim().length === 0) return
    if (Array.isArray(answer) && answer.length === 0) return
    answers[next()] = { name, answer }
  }

  // Fullname: parser expects { first, last, middle? } object on `whatIs1`.
  // If the website only has `full_name` we split on the first space.
  let first = asString(payload.first_name)
  let last = asString(payload.last_name)
  if ((!first || !last) && payload.full_name) {
    const parts = payload.full_name.trim().split(/\s+/)
    if (parts.length >= 2) {
      first = first ?? parts[0]
      last = last ?? parts.slice(1).join(" ")
    } else if (parts.length === 1) {
      first = first ?? parts[0]
    }
  }
  if (first || last) {
    put("whatIs1", { first: first ?? "", last: last ?? "" } as unknown as JotformAnswer["answer"])
  }

  put("personalEmail", asString(payload.email))
  // Phone parser accepts either a string or { full } object.
  put("personalPhone", asString(payload.phone))

  // Personal address — only emit if we have at least one field.
  const personalAddr: Record<string, string> = {}
  if (payload.street_address) personalAddr.addr_line1 = payload.street_address
  if (payload.city) personalAddr.city = payload.city
  if (payload.state) personalAddr.state = payload.state
  if (payload.zip) personalAddr.postal = payload.zip
  if (Object.keys(personalAddr).length > 0) {
    put("personalAddress", personalAddr as unknown as JotformAnswer["answer"])
  }

  // Engagement
  put("whatServices", asStringArray(payload.services_requested))
  put("whatBest", asString(payload.service_focus))
  put("whatTypes", asStringArray(payload.entity_types))
  put("whichBest", asString(payload.business_situation))

  // Business — we always emit on the "existing" slugs; the parser
  // falls back to "new business" only when existing is null, and we
  // don't have a clean way to tell which side from the website form
  // (asking would be a UX regression). For a brand-new biz the user
  // can put their best guess in business_summary.
  put("whatsThe", asString(payload.business_name))
  if (payload.business_state) {
    put("whatIs", { state: payload.business_state } as unknown as JotformAnswer["answer"])
  }
  if (payload.business_email || payload.business_phone) {
    put("existingBusiness", {
      email: payload.business_email ?? "",
      phone: payload.business_phone ?? "",
    } as unknown as JotformAnswer["answer"])
  }
  put("whatIs75", asString(payload.business_tax_classification))
  put("pleaseProvide91", asString(payload.business_summary))
  put("doesYour", asString(payload.business_uses_accounting_system))
  put("howMany105", asString(payload.business_employee_count))
  put("whatIs118", asString(payload.business_revenue_range))

  // Free text
  put("doYou", asString(payload.questions_or_concerns))
  put("isThere", asString(payload.additional_notes))
  put("whoSent", asString(payload.referral_source))
  put("lastlyTo53", asString(payload.preferred_team_member))

  // Tracking — preserved verbatim, parser ignores them but they
  // survive in `raw_answers` for analytics.
  if (payload.utm_source) put("__utm_source", payload.utm_source)
  if (payload.utm_medium) put("__utm_medium", payload.utm_medium)
  if (payload.utm_campaign) put("__utm_campaign", payload.utm_campaign)
  if (payload.page_url) put("__page_url", payload.page_url)

  return {
    id: `web_${randomUUID()}`,
    form_id: "website", // resolves to a real form_uuid via migration 162
    ip: "",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    updated_at: null,
    status: "ACTIVE",
    new: "1",
    flag: "0",
    answers,
  }
}

// ── Naive in-memory IP throttle ───────────────────────────────────
// Public endpoint — without rate limiting a single bot can churn
// thousands of fake intakes through Karbon's API in seconds. We track
// the last 10 submissions per IP in a 60s window in process memory.
// In-memory is fine because (a) Vercel serverless instances are
// short-lived so the worst case is a bot getting 10 submissions per
// instance per minute, and (b) Upstash isn't connected as a
// first-class integration here. If volume justifies it, swap this
// for a `lib/upstash` rate limiter later — the function signature
// stays the same.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10
const recentByIp = new Map<string, number[]>()
function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const list = (recentByIp.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (list.length >= RATE_MAX) {
    recentByIp.set(ip, list)
    return true
  }
  list.push(now)
  recentByIp.set(ip, list)
  return false
}

export const POST = withPublicCors(async (req: NextRequest) => {
  let payload: WebsiteIntakePayload
  try {
    payload = (await req.json()) as WebsiteIntakePayload
  } catch {
    return jsonWithCors(req, { error: "Invalid JSON" }, 400)
  }

  // Honeypot — bots almost always fill every input. A non-empty
  // `website` field means non-human. We return 200 with ok=false so
  // bot scripts don't retry against the error path.
  if (payload.website && payload.website.trim().length > 0) {
    console.log("[v0] /api/public/intake: honeypot tripped, dropping silently")
    return jsonWithCors(req, { ok: false, reason: "rejected" }, 200)
  }

  // Minimum viable contact info. Reject if we can't reach them.
  if (!asString(payload.email) && !asString(payload.phone)) {
    return jsonWithCors(req, { error: "An email or phone number is required" }, 400)
  }

  // Rate limit by IP — Vercel sets x-forwarded-for with the originating
  // address. If the header is missing fall back to a constant so we
  // still throttle the misconfigured-proxy case.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  if (isRateLimited(ip)) {
    return jsonWithCors(
      req,
      { error: "Too many submissions, please try again in a minute" },
      429,
    )
  }

  // Synthesize and ingest. We swallow errors here because the website
  // form has nowhere useful to display them — the Hub will retry on
  // the next sync, and Sentry will catch the underlying cause.
  try {
    const submission = synthesizeJotformSubmission(payload)
    await upsertIntakeSubmission(submission)
    return jsonWithCors(req, {
      ok: true,
      submission_id: submission.id,
    })
  } catch (err) {
    console.error("[v0] /api/public/intake error:", err)
    return jsonWithCors(
      req,
      {
        error:
          "We couldn't process your submission. Please try again or email us directly.",
      },
      500,
    )
  }
})
