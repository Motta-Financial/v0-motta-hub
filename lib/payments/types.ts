/**
 * Shared types for the Hub-native Stripe payment surface.
 * These mirror the columns created in scripts/345_stripe_payments.sql.
 */

export type BillingType = "one_time" | "recurring"
export type RecurringInterval = "month" | "quarter" | "year"
export type PaymentRequestStatus = "pending" | "paid" | "canceled" | "expired"

export interface ServicePackage {
  id: string
  name: string
  description: string | null
  price_cents: number
  currency: string
  billing_type: BillingType
  recurring_interval: RecurringInterval | null
  stripe_product_id: string | null
  stripe_price_id: string | null
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface PaymentRequest {
  id: string
  token: string
  service_package_id: string | null
  contact_id: string | null
  organization_id: string | null
  package_name: string
  amount_cents: number
  currency: string
  billing_type: BillingType
  recurring_interval: RecurringInterval | null
  status: PaymentRequestStatus
  memo: string | null
  recipient_email: string | null
  recipient_name: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
  created_by_team_member_id: string | null
  expires_at: string | null
  paid_at: string | null
  last_emailed_at: string | null
  created_at: string
  updated_at: string
}

/** Map our recurring_interval onto a Stripe price recurring config. */
export function toStripeRecurring(
  interval: RecurringInterval,
): { interval: "month" | "year"; interval_count: number } {
  switch (interval) {
    case "month":
      return { interval: "month", interval_count: 1 }
    case "quarter":
      // Stripe has no native "quarter"; model it as every 3 months.
      return { interval: "month", interval_count: 3 }
    case "year":
      return { interval: "year", interval_count: 1 }
  }
}

/** Human-friendly cadence label, e.g. "/mo", "/qtr", "/yr". */
export function intervalSuffix(interval: RecurringInterval | null): string {
  switch (interval) {
    case "month":
      return "/mo"
    case "quarter":
      return "/qtr"
    case "year":
      return "/yr"
    default:
      return ""
  }
}

/** Format cents as USD (or other currency) for display. */
export function formatAmount(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}
