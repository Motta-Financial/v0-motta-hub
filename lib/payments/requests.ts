import "server-only"
import { randomBytes } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/server"
import { getPackage } from "./catalog"
import type { PaymentRequest } from "./types"

/**
 * Payment-request (pay link) lifecycle.
 *
 * A payment_request snapshots the package name + amount at creation time so a
 * link stays accurate even if the catalog changes later. The public pay page
 * rebuilds the Stripe Checkout session from this row server-side — the client
 * never sends a price.
 */

/** URL-safe, unguessable token for /embed/pay/<token>. */
function mintToken(): string {
  return randomBytes(24).toString("base64url")
}

export interface CreatePaymentRequestInput {
  servicePackageId: string
  contactId?: string | null
  organizationId?: string | null
  recipientEmail: string
  recipientName?: string | null
  /** Optional override amount in cents (e.g. partial deposit). */
  amountCentsOverride?: number | null
  memo?: string | null
  createdByTeamMemberId?: string | null
  /** Link lifetime in days; defaults to 30. */
  expiresInDays?: number
}

export async function createPaymentRequest(
  input: CreatePaymentRequestInput,
): Promise<PaymentRequest> {
  const supabase = createAdminClient()

  const pkg = await getPackage(input.servicePackageId)
  if (!pkg) throw new Error("Service package not found")
  if (!pkg.active) throw new Error("Service package is not active")

  const amount =
    input.amountCentsOverride != null && input.amountCentsOverride > 0
      ? input.amountCentsOverride
      : pkg.price_cents

  const expiresInDays = input.expiresInDays ?? 30
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from("payment_requests")
    .insert({
      token: mintToken(),
      service_package_id: pkg.id,
      contact_id: input.contactId ?? null,
      organization_id: input.organizationId ?? null,
      package_name: pkg.name,
      amount_cents: amount,
      currency: pkg.currency,
      billing_type: pkg.billing_type,
      recurring_interval: pkg.recurring_interval,
      status: "pending",
      memo: input.memo ?? null,
      recipient_email: input.recipientEmail,
      recipient_name: input.recipientName ?? null,
      created_by_team_member_id: input.createdByTeamMemberId ?? null,
      expires_at: expiresAt,
    })
    .select("*")
    .single()

  if (error) throw new Error(`[requests] create: ${error.message}`)
  return data as PaymentRequest
}

/**
 * Fetch a pay link by token, transparently flipping it to `expired` when past
 * its expiry. Returns null when not found. Never throws on a missing row.
 */
export async function getPaymentRequestByToken(
  token: string,
): Promise<PaymentRequest | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle()
  if (error) throw new Error(`[requests] getByToken: ${error.message}`)
  if (!data) return null

  const req = data as PaymentRequest
  if (
    req.status === "pending" &&
    req.expires_at &&
    new Date(req.expires_at).getTime() < Date.now()
  ) {
    await supabase
      .from("payment_requests")
      .update({ status: "expired" })
      .eq("id", req.id)
    return { ...req, status: "expired" }
  }
  return req
}

export async function markEmailed(id: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("payment_requests")
    .update({ last_emailed_at: new Date().toISOString() })
    .eq("id", id)
}

export async function cancelPaymentRequest(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("payment_requests")
    .update({ status: "canceled" })
    .eq("id", id)
    .eq("status", "pending") // only pending links can be canceled
  if (error) throw new Error(`[requests] cancel: ${error.message}`)
}
