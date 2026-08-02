import { type NextRequest, NextResponse } from "next/server"
import type Stripe from "stripe"
import { stripe } from "@/lib/stripe"
import { createAdminClient } from "@/lib/supabase/server"

// Stripe must reach this unauthenticated (it carries no Hub session). The
// /api/webhooks/* prefix is already allowlisted in middleware. Security comes
// from verifying the Stripe signature against STRIPE_WEBHOOK_SECRET — an
// unsigned or mis-signed request is rejected with 400 before any DB write.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const webhookSecret =
  process.env.STRIPE_LIVE_STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || ""

export async function POST(request: NextRequest) {
  if (!webhookSecret) {
    console.error("[v0] stripe webhook: STRIPE_WEBHOOK_SECRET not set")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  // Raw body is REQUIRED for signature verification — do not JSON.parse first.
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error("[v0] stripe webhook: signature verification failed", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotency: if we've already recorded this event id, ack and stop.
  const { data: existing } = await admin
    .from("stripe_payments")
    .select("id")
    .eq("stripe_event_id", event.id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ received: true, deduped: true })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session
        // For one-time payments `payment_status` is 'paid'. For async methods
        // (e.g. ACH) the session completes 'unpaid' and we wait for the
        // async_payment_succeeded event instead.
        if (session.payment_status === "paid" || event.type === "checkout.session.async_payment_succeeded") {
          await recordPaidSession(admin, event, session)
        }
        break
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session
        const requestId = session.metadata?.payment_request_id
        if (requestId) {
          console.log("[v0] stripe webhook: async payment failed for request", requestId)
          // Leave the request 'pending' so the client can retry; record nothing.
        }
        break
      }
      default:
        // Unhandled event types are acked so Stripe stops retrying.
        break
    }
  } catch (err) {
    console.error("[v0] stripe webhook: handler error", event.type, err)
    // 500 tells Stripe to retry later.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

/**
 * Mark a payment_request paid and append an immutable ledger row. Both the
 * ledger insert (unique on stripe_event_id) and the request update are guarded
 * so a redelivery is a no-op.
 */
async function recordPaidSession(
  admin: ReturnType<typeof createAdminClient>,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
) {
  const requestId = session.metadata?.payment_request_id ?? null

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null
  const customerId = typeof session.customer === "string" ? session.customer : null

  // Resolve the originating request (for contact linkage + amount sanity).
  let contactId: string | null = null
  let organizationId: string | null = null
  if (requestId) {
    const { data: req } = await admin
      .from("payment_requests")
      .select("contact_id, organization_id")
      .eq("id", requestId)
      .maybeSingle()
    contactId = req?.contact_id ?? null
    organizationId = req?.organization_id ?? null
  }

  // 1. Ledger row (idempotent via unique stripe_event_id).
  const { error: ledgerError } = await admin.from("stripe_payments").insert({
    payment_request_id: requestId,
    contact_id: contactId,
    organization_id: organizationId,
    stripe_event_id: event.id,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    amount_cents: session.amount_total ?? null,
    currency: session.currency ?? "usd",
    status: "succeeded",
    customer_email: session.customer_details?.email ?? session.customer_email ?? null,
    raw: session as unknown as Record<string, unknown>,
  })
  if (ledgerError && !ledgerError.message.includes("duplicate key")) {
    throw new Error(`ledger insert: ${ledgerError.message}`)
  }

  // 2. Flip the request to paid (only from pending, so we never regress state).
  if (requestId) {
    await admin
      .from("payment_requests")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
      })
      .eq("id", requestId)
      .eq("status", "pending")
  }
}
