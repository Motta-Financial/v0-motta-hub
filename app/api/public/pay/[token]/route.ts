import { NextResponse, type NextRequest } from "next/server"
import { getPaymentRequestByToken } from "@/lib/payments/requests"
import { getPublishableKey } from "@/lib/stripe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/public/pay/:token
 *
 * Public, safe-to-expose details for rendering the pay page. Returns ONLY the
 * fields the payer needs — never internal ids, the contact record, or staff
 * data. The publishable key is included so Stripe.js initializes against the
 * same account/mode as the server session.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const req = await getPaymentRequestByToken(token)
  if (!req) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json({
    status: req.status,
    packageName: req.package_name,
    amountCents: req.amount_cents,
    currency: req.currency,
    billingType: req.billing_type,
    recurringInterval: req.recurring_interval,
    memo: req.memo,
    recipientName: req.recipient_name,
    publishableKey: getPublishableKey(),
  })
}
