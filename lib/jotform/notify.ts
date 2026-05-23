/**
 * Firm-wide "new intake received" notification.
 *
 * Sent from ALFRED Ai (the firm's automation persona — same sender
 * identity as the daily briefing and Tommy Awards emails) to every
 * active, non-service-account team member whenever a fresh intake
 * submission lands in the Hub.
 *
 * Visual structure (per partner request — May 2026):
 *   1. General Info  — who they are + ALFRED's research brief on
 *      their business / what they do.
 *   2. Client Questions — the prospect's freeform "how can Motta
 *      help" answer + ALFRED's draft answer / suggested action items.
 *   3. Potential Client Value — ALFRED's structured fee estimate
 *      (low/high one-time + annual recurring + line items).
 *
 * Dedupe semantics live on the row, not in this module:
 *   - `notified_at` (timestamptz) is set after a successful send.
 *   - Callers (currently `upsertIntakeSubmission`) MUST check that
 *     `notified_at IS NULL` before invoking this function so a
 *     webhook re-delivery or a backfill replay never re-spams the team.
 *
 * The actual delivery routes through `sendCategoryEmail`, which honors
 * each recipient's email preferences for the "intake" category.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { sendCategoryEmail } from "@/lib/email"

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_BASE_URL ||
  "https://hub.motta.cpa"

// Brand palette — mirrors lib/email.ts so the firm-wide intake email
// matches the Tommy Recap / Debrief / Daily Briefing wrappers in
// every inbox.
const BRAND = {
  primary: "#6B745D",
  primaryDark: "#5A6250",
  surface: "#FFFFFF",
  background: "#EAE6E1",
  textPrimary: "#1F2520",
  textMuted: "#6B7066",
  border: "#D8D3CB",
  accent: "#C97B3F",
} as const

export interface IntakeNotificationContext {
  /** Row UUID in `jotform_intake_submissions`. */
  id: string
  jotform_submission_id: string
  submitter_full_name: string | null
  submitter_email: string | null
  submitter_phone: string | null
  submitter_city: string | null
  submitter_state: string | null
  business_name: string | null
  business_state: string | null
  service_focus: string | null
  services_requested: string[] | null
  entity_types: string[] | null
  business_situation: string | null
  business_summary: string | null
  business_revenue_range: string | null
  questions_or_concerns: string | null
  additional_notes: string | null
  preferred_team_member: string | null
  /** Filled in once `resolvePreferredTeamMember` runs. */
  assigned_to_id: string | null
  /** ALFRED's company-research brief. */
  enrichment?: {
    summary?: string | null
    websites?: Array<{ url: string; title?: string }>
  } | null
  /** ALFRED's draft answer to the prospect's questions, with
   *  citations + bullet action items. */
  question_research?: {
    summary?: string | null
    key_points?: string[] | null
    references?: Array<{ url: string; title?: string }> | null
  } | null
  /** ALFRED's fee estimate. Optional — emailed only if it lands. */
  fee_estimate?: {
    low?: number | null
    high?: number | null
    currency?: string | null
    annual_recurring?: { low?: number | null; high?: number | null } | null
    rationale?: string | null
    line_items?: Array<{
      label?: string | null
      low?: number | null
      high?: number | null
      cadence?: "one_time" | "annual" | "monthly" | string | null
    }> | null
    confidence?: "low" | "medium" | "high" | string | null
    open_questions?: string[] | null
  } | null
  jotform_created_at: string | null
}

function escapeHtml(input: string | null | undefined): string {
  if (!input) return ""
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function row(label: string, value: string | null | undefined): string {
  if (!value) return ""
  return `
    <tr>
      <td style="padding: 8px 12px; font-size: 13px; color: ${BRAND.textMuted}; width: 160px; vertical-align: top;">${escapeHtml(label)}</td>
      <td style="padding: 8px 12px; font-size: 14px; color: ${BRAND.textPrimary};">${value}</td>
    </tr>
  `
}

function pillList(items: string[] | null | undefined): string {
  if (!items || items.length === 0) return ""
  return items
    .map(
      (s) =>
        `<span style="display:inline-block;background:${BRAND.background};color:${BRAND.textPrimary};font-size:12px;padding:2px 8px;border-radius:999px;margin:0 4px 4px 0;border:1px solid ${BRAND.border};">${escapeHtml(s)}</span>`,
    )
    .join("")
}

/**
 * Section header used by all three top-level groupings (General Info,
 * Client Questions, Potential Client Value). Keeps the typography
 * identical so the email reads as one cohesive document.
 */
function sectionHeader(title: string): string {
  return `<h2 style="color:${BRAND.textPrimary};font-size:14px;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid ${BRAND.border};text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(title)}</h2>`
}

function fmtUSD(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `$${Math.round(n).toLocaleString("en-US")}`
}

function fmtRange(low?: number | null, high?: number | null): string {
  if (typeof low === "number" && typeof high === "number") {
    return low === high ? fmtUSD(low) : `${fmtUSD(low)} – ${fmtUSD(high)}`
  }
  if (typeof low === "number") return `from ${fmtUSD(low)}`
  if (typeof high === "number") return `up to ${fmtUSD(high)}`
  return "—"
}

function cadenceLabel(c?: string | null): string {
  if (c === "monthly") return "/ month"
  if (c === "annual") return "/ year"
  return "one-time"
}

function confidencePill(c?: string | null): string {
  const conf = c === "high" || c === "medium" ? c : "low"
  const palette =
    conf === "high"
      ? { bg: "#dcfce7", fg: "#166534" }
      : conf === "medium"
        ? { bg: "#fef3c7", fg: "#92400e" }
        : { bg: "#fee2e2", fg: "#991b1b" }
  return `<span style="display:inline-block;background:${palette.bg};color:${palette.fg};font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:0.04em;">${conf} confidence</span>`
}

export function buildIntakeNotificationHtml(ctx: IntakeNotificationContext): string {
  const inboxUrl = `${APP_URL}/sales/intake?search=${encodeURIComponent(ctx.jotform_submission_id)}`
  const submitterLine = ctx.submitter_full_name ?? ctx.business_name ?? "an anonymous prospect"
  const businessLine = ctx.business_name && ctx.submitter_full_name ? ctx.business_name : null
  const receivedAt = ctx.jotform_created_at
    ? new Date(ctx.jotform_created_at).toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "short",
      })
    : "moments ago"

  // ── 1. General Info ─────────────────────────────────────────────
  // Identity + assignment + ALFRED's research brief about the business.

  const identityRows = [
    row("Submitter", escapeHtml(ctx.submitter_full_name)),
    row("Business", escapeHtml(ctx.business_name)),
    row(
      "Email",
      ctx.submitter_email
        ? `<a href="mailto:${escapeHtml(ctx.submitter_email)}" style="color:${BRAND.primaryDark};">${escapeHtml(ctx.submitter_email)}</a>`
        : "",
    ),
    row(
      "Phone",
      ctx.submitter_phone
        ? `<a href="tel:${escapeHtml(ctx.submitter_phone.replace(/[^\d+]/g, ""))}" style="color:${BRAND.primaryDark};">${escapeHtml(ctx.submitter_phone)}</a>`
        : "",
    ),
    row(
      "Location",
      escapeHtml(
        [ctx.submitter_city, ctx.submitter_state ?? ctx.business_state]
          .filter(Boolean)
          .join(", "),
      ),
    ),
    row("Service focus", escapeHtml(ctx.service_focus)),
    row("Requested services", pillList(ctx.services_requested)),
    row("Entity types", pillList(ctx.entity_types)),
    row("Revenue range", escapeHtml(ctx.business_revenue_range)),
  ].join("")

  const assignmentNote = ctx.preferred_team_member
    ? ctx.assigned_to_id
      ? `<strong>${escapeHtml(ctx.preferred_team_member)}</strong> <span style="color:${BRAND.textMuted};">(auto-assigned)</span>`
      : `<strong>${escapeHtml(ctx.preferred_team_member)}</strong> <span style="color:#b45309;">(name didn&#39;t match a current teammate — please re-assign)</span>`
    : `<span style="color:${BRAND.textMuted};">No preference indicated — pick this up if it&#39;s a fit.</span>`
  const assignmentRow = row("Assigned to", assignmentNote)

  const businessSummaryBlock = ctx.business_summary
    ? `<div style="margin-top:12px;">
        <div style="font-size:12px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Business summary (their words)</div>
        <div style="background:${BRAND.background};border-left:3px solid ${BRAND.primary};padding:12px 16px;border-radius:4px;font-size:14px;color:${BRAND.textPrimary};white-space:pre-wrap;line-height:1.5;">${escapeHtml(ctx.business_summary)}</div>
      </div>`
    : ""

  const enrichmentBlock = ctx.enrichment?.summary
    ? `<div style="margin-top:16px;">
        <div style="font-size:12px;color:${BRAND.primaryDark};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">ALFRED · Prospect Research</div>
        <div style="background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:6px;padding:12px 16px;font-size:14px;color:${BRAND.textPrimary};line-height:1.5;white-space:pre-wrap;">${escapeHtml(ctx.enrichment.summary)}</div>
        ${
          ctx.enrichment.websites && ctx.enrichment.websites.length > 0
            ? `<div style="margin-top:8px;font-size:12px;color:${BRAND.textMuted};">Researched: ${ctx.enrichment.websites
                .map(
                  (w) =>
                    `<a href="${escapeHtml(w.url)}" style="color:${BRAND.primaryDark};">${escapeHtml(w.title ?? w.url)}</a>`,
                )
                .join(" · ")}</div>`
            : ""
        }
      </div>`
    : ""

  // ── 2. Client Questions ─────────────────────────────────────────
  // The prospect's freeform answer, ALFRED's draft reply, and any
  // suggested action items (key_points).

  const questionsBlock = ctx.questions_or_concerns
    ? `<div>
        <div style="font-size:12px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Their words</div>
        <div style="background:#fff7ed;border-left:3px solid ${BRAND.accent};padding:12px 16px;border-radius:4px;font-size:14px;color:${BRAND.textPrimary};white-space:pre-wrap;line-height:1.5;">${escapeHtml(ctx.questions_or_concerns)}</div>
      </div>`
    : `<div style="color:${BRAND.textMuted};font-size:13px;font-style:italic;">The prospect didn&#39;t share specific questions on the intake form.</div>`

  const research = ctx.question_research
  const researchBlock = research?.summary
    ? `<div style="margin-top:16px;">
        <div style="font-size:12px;color:${BRAND.primaryDark};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">ALFRED · Draft Response</div>
        <div style="background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:6px;padding:12px 16px;font-size:14px;color:${BRAND.textPrimary};line-height:1.55;white-space:pre-wrap;">${escapeHtml(research.summary)}</div>
        ${
          research.key_points && research.key_points.length > 0
            ? `<div style="margin-top:10px;">
                <div style="font-size:12px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Suggested action items</div>
                <ul style="margin:0;padding-left:18px;color:${BRAND.textPrimary};font-size:14px;line-height:1.55;">
                  ${research.key_points
                    .map((kp) => `<li style="margin-bottom:4px;">${escapeHtml(kp)}</li>`)
                    .join("")}
                </ul>
              </div>`
            : ""
        }
        ${
          research.references && research.references.length > 0
            ? `<div style="margin-top:8px;font-size:12px;color:${BRAND.textMuted};">References: ${research.references
                .map(
                  (r) =>
                    `<a href="${escapeHtml(r.url)}" style="color:${BRAND.primaryDark};">${escapeHtml(r.title ?? r.url)}</a>`,
                )
                .join(" · ")}</div>`
            : ""
        }
        <div style="margin-top:6px;font-size:11px;color:${BRAND.textMuted};font-style:italic;">Draft research — review before sharing with the prospect.</div>
      </div>`
    : ""

  // ── 3. Potential Client Value ───────────────────────────────────
  // Fee estimate as compact line-item table + headline range.

  const fee = ctx.fee_estimate
  let feeBlock = ""
  if (fee && (typeof fee.low === "number" || typeof fee.high === "number")) {
    const annual = fee.annual_recurring
    const lineItemsHtml =
      fee.line_items && fee.line_items.length > 0
        ? `<table style="width:100%;border-collapse:collapse;margin-top:14px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 12px;font-size:11px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid ${BRAND.border};">Service</th>
                <th style="text-align:right;padding:6px 12px;font-size:11px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid ${BRAND.border};">Range</th>
                <th style="text-align:right;padding:6px 12px;font-size:11px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid ${BRAND.border};">Cadence</th>
              </tr>
            </thead>
            <tbody>
              ${fee.line_items
                .map(
                  (li) => `
                <tr>
                  <td style="padding:8px 12px;font-size:14px;color:${BRAND.textPrimary};border-bottom:1px solid ${BRAND.border};">${escapeHtml(li.label ?? "")}</td>
                  <td style="padding:8px 12px;font-size:14px;color:${BRAND.textPrimary};text-align:right;border-bottom:1px solid ${BRAND.border};">${fmtRange(li.low, li.high)}</td>
                  <td style="padding:8px 12px;font-size:13px;color:${BRAND.textMuted};text-align:right;border-bottom:1px solid ${BRAND.border};">${escapeHtml(cadenceLabel(li.cadence))}</td>
                </tr>`,
                )
                .join("")}
            </tbody>
          </table>`
        : ""

    const openQuestionsHtml =
      fee.open_questions && fee.open_questions.length > 0
        ? `<div style="margin-top:12px;">
            <div style="font-size:12px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">To tighten the estimate, ask</div>
            <ul style="margin:0;padding-left:18px;color:${BRAND.textPrimary};font-size:13px;line-height:1.55;">
              ${fee.open_questions
                .map((q) => `<li style="margin-bottom:3px;">${escapeHtml(q)}</li>`)
                .join("")}
            </ul>
          </div>`
        : ""

    feeBlock = `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="font-size:12px;color:${BRAND.primaryDark};text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">ALFRED · Estimate</div>
          ${confidencePill(fee.confidence)}
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:160px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:6px;padding:14px 16px;">
            <div style="font-size:11px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;">One-time / setup</div>
            <div style="font-size:18px;font-weight:700;color:${BRAND.textPrimary};margin-top:4px;">${fmtRange(fee.low, fee.high)}</div>
          </div>
          ${
            annual && (typeof annual.low === "number" || typeof annual.high === "number")
              ? `<div style="flex:1;min-width:160px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:6px;padding:14px 16px;">
                  <div style="font-size:11px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.5px;">Annual recurring</div>
                  <div style="font-size:18px;font-weight:700;color:${BRAND.textPrimary};margin-top:4px;">${fmtRange(annual.low, annual.high)}</div>
                </div>`
              : ""
          }
        </div>

        ${
          fee.rationale
            ? `<div style="margin-top:14px;font-size:14px;color:${BRAND.textPrimary};line-height:1.55;">${escapeHtml(fee.rationale)}</div>`
            : ""
        }

        ${lineItemsHtml}
        ${openQuestionsHtml}

        <div style="margin-top:10px;font-size:11px;color:${BRAND.textMuted};font-style:italic;">Internal draft estimate — verify against the firm price book before quoting the prospect.</div>
      </div>`
  }

  // ── Compose ──────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New Intake Submission</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${BRAND.background};">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px;">
    <div style="background:${BRAND.surface};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);border:1px solid ${BRAND.border};">
      <div style="background:${BRAND.primary};padding:18px 28px;">
        <table width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="vertical-align:middle;">
              <div style="color:${BRAND.surface};font-size:18px;font-weight:700;letter-spacing:0.04em;">MOTTA HUB</div>
              <div style="color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">From ALFRED Ai</div>
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <span style="display:inline-block;background:rgba(255,255,255,0.15);color:${BRAND.surface};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:5px 10px;border-radius:999px;">New Intake</span>
            </td>
          </tr>
        </table>
      </div>

      <div style="padding:32px;">
        <h1 style="color:${BRAND.textPrimary};font-size:22px;margin:0 0 4px;font-weight:700;letter-spacing:-0.01em;">New intake from ${escapeHtml(submitterLine)}${businessLine ? ` <span style="color:${BRAND.textMuted};font-weight:500;">· ${escapeHtml(businessLine)}</span>` : ""}</h1>
        <p style="color:${BRAND.textMuted};font-size:13px;margin:0 0 8px;">Received ${escapeHtml(receivedAt)}</p>

        ${sectionHeader("General Info")}
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${identityRows}${assignmentRow}</tbody>
        </table>
        ${businessSummaryBlock}
        ${enrichmentBlock}

        ${sectionHeader("Client Questions")}
        ${questionsBlock}
        ${researchBlock}

        ${feeBlock ? sectionHeader("Potential Client Value") + feeBlock : ""}

        <div style="margin-top:32px;text-align:center;">
          <a href="${inboxUrl}" style="display:inline-block;background:${BRAND.primary};color:${BRAND.surface};padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.02em;">Open intake in MOTTA HUB &rarr;</a>
        </div>
      </div>

      <div style="background:${BRAND.background};padding:16px 28px;border-top:1px solid ${BRAND.border};">
        <p style="font-size:11px;color:${BRAND.textMuted};margin:0;text-align:center;letter-spacing:0.02em;">
          ALFRED Ai · You can opt out of intake alerts in your notification preferences.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`
}

/**
 * Fan-out delivery. Looks up every active, non-service-account team
 * member and asks `sendCategoryEmail` to mail them — that helper
 * honors per-user opt-outs for the `intake` category, so partners who
 * silence these still get the in-Hub row but no email.
 *
 * Returns `{ sent, attempted }` so the caller can record meaningful
 * counts in logs / audit rows.
 */
export async function notifyTeamOfNewIntake(
  supabase: SupabaseClient,
  ctx: IntakeNotificationContext,
): Promise<{ sent: number; attempted: number }> {
  const { data: members, error } = await supabase
    .from("team_members")
    .select("id")
    .eq("is_active", true)
    .eq("is_service_account", false)
    .not("email", "is", null)

  if (error) {
    console.log("[v0] notifyTeamOfNewIntake team query error:", error.message)
    return { sent: 0, attempted: 0 }
  }

  const recipientIds = (members ?? []).map((m) => m.id as string)
  if (recipientIds.length === 0) return { sent: 0, attempted: 0 }

  const html = buildIntakeNotificationHtml(ctx)
  const subject = ctx.business_name
    ? `New intake · ${ctx.submitter_full_name ?? "Prospect"} (${ctx.business_name})`
    : `New intake · ${ctx.submitter_full_name ?? "Prospect"}`

  const result = await sendCategoryEmail({
    category: "intake",
    teamMemberIds: recipientIds,
    subject,
    html,
    replyTo: ctx.submitter_email ?? undefined,
  })

  return { sent: result.sent, attempted: result.attempted }
}
