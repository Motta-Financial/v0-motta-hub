import "server-only"
import { createAdminClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"

/**
 * Resolve (or lazily create) the Stripe Customer for a Hub contact, so repeat
 * payers reuse one customer record and subscriptions can be managed later.
 *
 * Falls back to a contact-less customer keyed only by email when there is no
 * Hub contact id (rare — the staff flow always resolves a contact first).
 */
export async function getOrCreateStripeCustomer(params: {
  contactId?: string | null
  organizationId?: string | null
  email: string
  name?: string | null
}): Promise<string> {
  const { contactId, organizationId, email, name } = params
  const supabase = createAdminClient()

  // 1. Reuse an existing mapping when we have a contact.
  if (contactId) {
    const { data: existing } = await supabase
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("contact_id", contactId)
      .maybeSingle()
    if (existing?.stripe_customer_id) return existing.stripe_customer_id
  }

  // 2. Create a new Stripe Customer.
  const customer = await stripe.customers.create({
    email,
    name: name ?? undefined,
    metadata: {
      hub_contact_id: contactId ?? "",
      hub_organization_id: organizationId ?? "",
    },
  })

  // 3. Persist the mapping (best-effort; the Stripe customer is the truth).
  await supabase.from("stripe_customers").insert({
    contact_id: contactId ?? null,
    organization_id: organizationId ?? null,
    stripe_customer_id: customer.id,
    email,
  })

  return customer.id
}
