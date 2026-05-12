/**
 * Shared aggregation helpers for Ignition payments.
 *
 * Why this exists
 * ───────────────
 * Ignition records the same payment under different `payment_status`
 * values as it progresses through the funding lifecycle:
 *
 *   • `collected`   — customer's card was charged; funds in transit
 *                     (fees and net_amount are still null at this stage)
 *   • `disbursed`   — funds have settled into the firm's bank account,
 *                     fees deducted, net_amount populated
 *   • `uncollected` — charge failed or was reversed before settlement
 *
 * The `collected` row mutates to `disbursed` ~30 days later, so both
 * states represent the same successful payment — just at different
 * points in its life. Every consumer that wants to roll up "what the
 * firm has actually been paid" must therefore count both, and exclude
 * `uncollected`. Centralising the predicate keeps the server route
 * and the client-side filter from drifting apart.
 */

export type PaymentRow = {
  ignition_payment_id?: string
  amount: number | string | null
  fees: number | string | null
  net_amount: number | string | null
  currency: string | null
  payment_status: string | null
  paid_at: string | null
  refunded_at: string | null
  refund_amount: number | string | null
}

const PAID_STATUSES = new Set(["collected", "disbursed"])

/** True if this row counts toward "money received by the firm". */
export function isPaid(p: Pick<PaymentRow, "payment_status">): boolean {
  return PAID_STATUSES.has((p.payment_status || "").toLowerCase().trim())
}

/**
 * Net-to-firm for a single row. We prefer `net_amount` (the
 * post-fee value Ignition itself records once a payment is
 * disbursed) and fall back to amount − fees only when we have to.
 * For `collected` rows that haven't been disbursed yet, fees are
 * still null — we return the gross amount as an interim figure,
 * which will reconcile to the real net within ~30 days.
 */
export function netOfPayment(p: PaymentRow): number {
  const amt = Number(p.amount) || 0
  const net = p.net_amount != null ? Number(p.net_amount) : null
  if (net != null && !Number.isNaN(net)) return net
  const fees = p.fees != null ? Number(p.fees) : null
  if (fees != null && !Number.isNaN(fees)) return amt - fees
  return amt
}

export type PaymentsSummary = {
  /** Sum of gross `amount` across paid rows. */
  totalAmount: number
  /** Sum of `fees` across paid rows. */
  totalFees: number
  /** Sum of net-to-firm across paid rows (post-fee). */
  totalNet: number
  /** Sum of `refund_amount` across ALL rows (refunds can apply
   *  even to rows whose lifecycle has moved beyond `disbursed`). */
  totalRefunded: number
  /** Currency reported as the modal currency across paid rows. */
  currency: string
  /** Number of paid rows. */
  paymentCount: number
  /** Number of rows with a non-null `refunded_at`. */
  refundCount: number
  /** Most recent `paid_at` across paid rows. */
  mostRecentPaidAt: string | null
}

/**
 * Roll up an array of raw payment rows into the shape the profile
 * UI consumes. Pure function — same inputs always produce the same
 * output, no DB access, safe to call client-side after filtering.
 */
export function summarizePayments(rows: PaymentRow[]): PaymentsSummary {
  const paid = rows.filter(isPaid)

  let totalAmount = 0
  let totalFees = 0
  let totalNet = 0
  let mostRecentPaidAt: string | null = null
  const currencyTally = new Map<string, number>()

  for (const p of paid) {
    const amt = Number(p.amount) || 0
    totalAmount += amt
    totalFees += Number(p.fees) || 0
    totalNet += netOfPayment(p)

    const cur = (p.currency || "USD").toUpperCase()
    currencyTally.set(cur, (currencyTally.get(cur) || 0) + amt)

    if (p.paid_at) {
      if (!mostRecentPaidAt || new Date(p.paid_at) > new Date(mostRecentPaidAt)) {
        mostRecentPaidAt = p.paid_at
      }
    }
  }

  // Currency is whichever currency the majority of paid dollars
  // are denominated in. In practice this is always USD for this
  // firm today; deriving it from the data leaves us correct if a
  // multi-currency client ever appears.
  const currency =
    [...currencyTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "USD"

  const totalRefunded = rows.reduce(
    (s, p) => s + (Number(p.refund_amount) || 0),
    0,
  )
  const refundCount = rows.filter((p) => p.refunded_at).length

  return {
    totalAmount,
    totalFees,
    totalNet,
    totalRefunded,
    currency,
    paymentCount: paid.length,
    refundCount,
    mostRecentPaidAt,
  }
}
