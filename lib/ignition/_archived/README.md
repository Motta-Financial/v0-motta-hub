# Archived Ignition modules

These files were the live-path for the Zapier-era Ignition integration.
They are no longer imported anywhere in the codebase and exist purely as
reference material in case we need to replay archived
`ignition_webhook_events` rows (currently kept for historical audit only).

## Why retired

Ignition now ships a first-party Reporting API. The live sync path is:

- `lib/ignition/oauth.ts` — OAuth + paginated reads against the Reporting API
- `lib/ignition/sync.ts` — Per-resource mappers and `runFullBackfill`
- `app/api/cron/ignition-sync/route.ts` — 15-minute incremental cron
- `app/api/ignition/sync/route.ts` — Manual backfill button
- `app/api/ignition/webhook/[event]/route.ts` — Now a 410 Gone shim

## Files

- `handlers.ts` — `handleIgnitionEvent(eventType, payload)` dispatcher that
  translated Zapier payloads into upserts on `ignition_*` tables. Replaced
  by the per-resource mappers in `../sync.ts`.

- `id-resolver.ts` — Translated legacy numeric IDs (from old Zapier
  payloads) to the Reporting-API slug IDs (`cli_xxx`, `prop_xxx`, etc.).
  Only the slug form is used end-to-end now.

## When to delete

Once `ignition_webhook_events` is dropped from Supabase and no live Zaps
are still hitting `/api/ignition/webhook/[event]` (check the audit table
for `processing_status = 'deprecated'` rows older than ~30 days with zero
recent traffic), this whole directory can be removed.
