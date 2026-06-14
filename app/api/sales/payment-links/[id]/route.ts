import { NextResponse, type NextRequest } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { cancelPaymentRequest, markEmailed } from "@/lib/payments/requests"
import { buildPayLinkEmailHtml, buildPayLinkEmailSubject } from "@/lib/payments/email"
import { sendEmail } from "@/lib/email"
import type { PaymentRequest } from "@/lib/payments/types"

export const runtime = "nodejs"

async function requireStaff(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data, error } = await getAuthenticatedUser(supabase)
    return !error && !!data.user
  } catch {
    return false
  }
}

function payUrl(token: string): string {
  const base = process.env.APP_BASE_URL || "https://hub.motta.cpa"
  return `${base}/embed/pay/${token}`
}

// PATCH: action = "resend" | "cancel"
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireStaff())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const admin = createAdminClient()

  if (body.action === "cancel") {
    try {
      await cancelPaymentRequest(id)
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 })
    }
    return NextResponse.json({ ok: true, status: "canceled" })
  }

  if (body.action === "resend") {
    const { data, error } = await admin
      .from("payment_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle()
    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const req = data as PaymentRequest
    if (req.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot resend a ${req.status} link` },
        { status: 400 },
      )
    }
    if (!req.recipient_email) {
      return NextResponse.json({ error: "No recipient email on file" }, { status: 400 })
    }
    const result = await sendEmail({
      to: req.recipient_email,
      subject: buildPayLinkEmailSubject(req),
      html: buildPayLinkEmailHtml({ req, payUrl: payUrl(req.token) }),
    })
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? "Email failed" }, { status: 502 })
    }
    await markEmailed(req.id)
    return NextResponse.json({ ok: true, emailed: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
