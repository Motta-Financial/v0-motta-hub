import { NextResponse, type NextRequest } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { findOrCreateHubContact } from "@/lib/hub/find-or-create-contact"
import { createPaymentRequest, markEmailed } from "@/lib/payments/requests"
import { buildPayLinkEmailHtml, buildPayLinkEmailSubject } from "@/lib/payments/email"
import { sendEmail } from "@/lib/email"
import type { PaymentRequest } from "@/lib/payments/types"

export const runtime = "nodejs"

function payUrl(token: string): string {
  const base = process.env.APP_BASE_URL || "https://hub.motta.cpa"
  return `${base}/embed/pay/${token}`
}

/** Resolve the current staff member from the Supabase session cookie. */
async function getCurrentTeamMemberId(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await getAuthenticatedUser(supabase)
    if (error || !data.user) return null
    const admin = createAdminClient()
    const { data: tm } = await admin
      .from("team_members")
      .select("id")
      .eq("auth_user_id", data.user.id)
      .maybeSingle()
    return tm?.id ?? null
  } catch {
    return null
  }
}

// ─── GET: list recent payment links (staff dashboard) ───
export async function GET(_request: NextRequest) {
  const teamMemberId = await getCurrentTeamMemberId()
  if (!teamMemberId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("payment_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ requests: (data ?? []) as PaymentRequest[] })
}

// ─── POST: create a pay link + email it ───
export async function POST(request: NextRequest) {
  const teamMemberId = await getCurrentTeamMemberId()
  if (!teamMemberId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    servicePackageId?: string
    recipientEmail?: string
    recipientName?: string
    amountCentsOverride?: number | null
    memo?: string | null
    sendEmail?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const recipientEmail = body.recipientEmail?.trim().toLowerCase()
  if (!body.servicePackageId) {
    return NextResponse.json({ error: "servicePackageId is required" }, { status: 400 })
  }
  if (!recipientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
    return NextResponse.json({ error: "A valid recipientEmail is required" }, { status: 400 })
  }

  // Resolve/Create the master Hub contact so the charge links to the canonical
  // identifier — Hub-first, never a Stripe-only record.
  let contactId: string | null = null
  let organizationId: string | null = null
  try {
    const hub = await findOrCreateHubContact(
      {
        email: recipientEmail,
        fullName: body.recipientName?.trim() || null,
      },
      { source: "manual" },
    )
    contactId = hub.contact_id
    organizationId = hub.organization_id
  } catch (err) {
    // Non-fatal: we can still issue a link without a resolved contact.
    console.log("[v0] payment-links: contact resolve failed:", (err as Error).message)
  }

  let req: PaymentRequest
  try {
    req = await createPaymentRequest({
      servicePackageId: body.servicePackageId,
      contactId,
      organizationId,
      recipientEmail,
      recipientName: body.recipientName?.trim() || null,
      amountCentsOverride: body.amountCentsOverride ?? null,
      memo: body.memo ?? null,
      createdByTeamMemberId: teamMemberId,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  const url = payUrl(req.token)

  // Email the link unless explicitly suppressed (staff may copy the link).
  let emailed = false
  if (body.sendEmail !== false) {
    const result = await sendEmail({
      to: recipientEmail,
      subject: buildPayLinkEmailSubject(req),
      html: buildPayLinkEmailHtml({ req, payUrl: url }),
    })
    emailed = result.success
    if (result.success) await markEmailed(req.id)
  }

  return NextResponse.json({ request: req, payUrl: url, emailed })
}
