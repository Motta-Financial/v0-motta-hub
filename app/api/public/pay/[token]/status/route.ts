import { NextResponse, type NextRequest } from "next/server"
import { getPaymentRequestByToken } from "@/lib/payments/requests"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/public/pay/:token/status
 *
 * Lightweight polling endpoint the pay page hits after Checkout completes to
 * confirm the webhook has marked the request `paid`. Returns only the status.
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
  return NextResponse.json({ status: req.status, paidAt: req.paid_at })
}
