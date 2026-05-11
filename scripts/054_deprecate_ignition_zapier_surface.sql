-- Mark the Zapier-era Ignition surface as a historical archive.
--
-- Background
-- ----------
-- The Ignition Reporting API is now the single source of truth for clients,
-- contacts, deals, deal_stages, services, proposals, invoices, payments, and
-- collections. A 15-minute cron (`/api/cron/ignition-sync`) calls each
-- endpoint with `?updated_from=<last_synced_at>` so we tail changes
-- incrementally without paying for full backfills.
--
-- Two tables are left over from the retired Zapier bridge:
--
--   * `ignition_webhook_events` — every inbound Zapier POST was logged here
--     for audit. The receiver at `/api/ignition/webhook/[event]` now returns
--     HTTP 410 Gone and inserts rows with `processing_status = 'deprecated'`
--     so we can spot any Zaps still hitting us. Old `'success'`/`'failed'`
--     rows are kept as historical record. This script adds an explanatory
--     COMMENT and a partial index on the deprecated marker so the admin UI
--     can quickly count recent stale-Zap traffic.
--
--   * `ignition_disbursals` — payout batches were only ever populated by
--     Zapier. The Reporting API has no equivalent endpoint, so this table
--     is now a frozen historical archive. New payout-style data should be
--     derived from `ignition_payment_transactions` (group by `payment_date`).
--
-- This script is purely descriptive — no destructive operations. It is safe
-- to re-run.

BEGIN;

-- 1. Document the new role of these tables in pg_catalog so anyone querying
--    them directly sees the deprecation notice via `psql \dt+` or similar.
COMMENT ON TABLE public.ignition_webhook_events IS
  'DEPRECATED archive: every POST to /api/ignition/webhook/[event] is logged here. '
  'The receiver now returns HTTP 410 Gone and writes processing_status=''deprecated''. '
  'The Reporting API + cron at /api/cron/ignition-sync are the live data path. '
  'Safe to drop once no rows with processing_status=''deprecated'' have arrived in 30 days.';

COMMENT ON TABLE public.ignition_disbursals IS
  'FROZEN ARCHIVE: payout batches from the retired Zapier bridge. The Ignition '
  'Reporting API has no disbursals endpoint — derive payout-equivalent data from '
  'ignition_payment_transactions grouped by payment_date instead. No new rows '
  'should land here.';

-- Per-column annotations on the Zapier-specific fields. `zap_id` used to
-- carry the Zapier Zap ID for cross-referencing. It's null on all
-- API-era rows.
COMMENT ON COLUMN public.ignition_webhook_events.zap_id IS
  'Zapier Zap identifier (legacy). NULL on every row inserted after the '
  'switch to the Reporting API. Kept for historical lookups.';

COMMENT ON COLUMN public.ignition_webhook_events.processing_status IS
  'One of: pending / success / failed / skipped / deprecated. '
  '`deprecated` is set on every new row by the 410 Gone receiver — count '
  'these to identify stale Zaps that should be disabled in Ignition.';

-- 2. Speed up the "are any old Zaps still firing?" admin query. A partial
--    index keeps the index small (only deprecated rows) while making the
--    typical filter — recent deprecated traffic — cheap.
CREATE INDEX IF NOT EXISTS idx_ignition_webhook_events_deprecated_recent
  ON public.ignition_webhook_events (received_at DESC)
  WHERE processing_status = 'deprecated';

-- 3. Note the cron-driven sync source in sync_log so dashboards that pivot
--    on sync_type can distinguish manual backfills from automated ticks.
--    No schema change here — runFullBackfill now writes sync_type =
--    'ignition_incremental' for cron runs and 'ignition_backfill' for
--    manual full re-syncs. This comment documents that contract.
COMMENT ON COLUMN public.sync_log.sync_type IS
  'Free-text identifier. Ignition values: `ignition_backfill` (manual full '
  're-sync via /api/ignition/sync) and `ignition_incremental` (cron tick '
  'every 15 min via /api/cron/ignition-sync). Karbon, Calendly, Zoom, and '
  'jotform also use their own sync_type values.';

COMMIT;
