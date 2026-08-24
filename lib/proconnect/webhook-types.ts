/**
 * The webhook entity types ProConnect is registered to deliver.
 *
 * Single source of truth for these three strings. They must match
 * `entity.name` verbatim as written to `proconnect_webhook_events.event_type`
 * (see app/api/proconnect/webhooks/route.ts), because the coverage check in
 * /api/tax/proconnect-status matches on equality.
 *
 * This lives in lib/ rather than in the status route because Next's App
 * Router permits only a fixed set of exports from a `route.ts` (GET, POST,
 * dynamic, …); exporting anything else fails the generated route type check
 * at build time, even though `tsc` alone may not surface it.
 *
 * `TaxReturnWorkStatus` has never been delivered — zero events across the
 * 5,659 received. Our receiver handles the type; the gap is on Intuit's side
 * and is an open question with them.
 */
export const EXPECTED_WEBHOOK_TYPES = [
  "Client",
  "TaxReturn",
  "TaxReturnWorkStatus",
] as const

export type ExpectedWebhookType = (typeof EXPECTED_WEBHOOK_TYPES)[number]
