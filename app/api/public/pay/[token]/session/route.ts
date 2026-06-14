import { NextResponse, type NextRequest } from "next/server"
import type Stripe from "stripe"
import { stripe } from "@/lib/stripe"
import { createAdminClient } from "@/lib/supabase/server"
import { getPaymentRequestByToken } from "@/lib/payments/requests"
import { getPackage, ensureStripePrice } from "@/lib/payments/catalog"
import { getOrCreateStripeCustomer } from "@/lib/payments/customer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/public/pay/:token/session
 *
 * Creates (or reuses) an EMBEDDED Stripe Checkout session for a pay link and
 * returns its client_secret. The amount is ALWAYS derived server-side from the
 * payment_request row — the client only supplies the opaque token.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const req = await getPaymentRequestByToken(token)
  if (!req) {
    return NextResponse.json({ error: "Payment link not found" }, { status: 404 })
  }
  if (req.status === "paid") {
    return NextResponse.json({ error: "This payment has already been completed." }, { status: 409 })
  }
  if (req.status !== "pending") {
    return NextResponse.json({ error: `This payment link is ${req.status}.` }, { status: 410 })
  }

  const pkg = req.service_package_id ? await getPackage(req.service_package_id) : null
  if (!pkg) {
    return NextResponse.json({ error: "Service package is unavailable." }, { status: 400 })
  }

  const admin = createAdminClient()

  // Reuse an open session if we already minted one for this request.
  if (req.stripe_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(req.stripe_checkout_session_id)
      if (existing.status === "open" && existing.client_secret) {
        return NextResponse.json({ clientSecret: existing.client_secret })
      }
    } catch {
      // fall through and create a fresh session
    }
  }

  // Ensure the Stripe Price matches the snapshotted amount (handles overrides).
  const priceId = await ensureStripePrice(
    pkg,
    req.amount_cents !== pkg.price_cents ? req.amount_cents : undefined,
  )

  // Reuse/lazily create the Stripe Customer for this Hub contact.
  let customerId: string | undefined
  if (req.recipient_email) {
    try {
      customerId = await getOrCreateStripeCustomer({
        contactId: req.contact_id,
        organizationId: req.organization_id,
        email: req.recipient_email,
        name: req.recipient_name,
      })
    } catch {
      // Non-fatal — Checkout can collect a new customer itself.
    }
  }

  const mode: Stripe.Checkout.SessionCreateParams.Mode =
    req.billing_type === "recurring" ? "subscription" : "payment"

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    // dahlia API renamed the embedded value: 'embedded' → 'embedded_page'.
    ui_mode: "embedded_page",
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    redirect_on_completion: "never",
    ...(customerId
      ? { customer: customerId }
      : req.recipient_email
        ? { customer_email: req.recipient_email }
        : {}),
    // Stamp our linkage so the webhook can resolve the request without guessing.
    metadata: {
      payment_request_id: req.id,
      payment_request_token: req.token,
      hub_contact_id: req.contact_id ?? "",
    },
    ...(mode === "subscription"
      ? { subscription_data: { metadata: { payment_request_id: req.id } } }
      : { payment_intent_data: { metadata: { payment_request_id: req.id } } }),
  }

  const session = await stripe.checkout.sessions.create(sessionParams)

  // Persist the session id so a refresh reuses it instead of creating dupes.
  await admin
    .from("payment_requests")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", req.id)

  return NextResponse.json({ clientSecret: session.client_secret })
}
