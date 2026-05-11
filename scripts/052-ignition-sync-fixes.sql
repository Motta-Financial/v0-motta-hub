-- ============================================================================
-- 052 — Backfill fixes for the Ignition Reporting API integration
--
-- Why this exists
-- ---------------
-- The first backfill run revealed that:
--   1. `ignition_payment_transactions` had no unique constraint on
--      `transaction_id`, so the sync's UPSERT (onConflict: transaction_id)
--      silently fell back to insert-only and immediately failed once any row
--      tried to come through twice.
--   2. Most mappers were looking for `id`, but Ignition's reporting API
--      actually uses `slug` as the natural key on every resource. The mapper
--      rewrite that fixes (2) needs (1) in place first, so we add the
--      constraint here.
--
-- This file is idempotent — safe to re-run.
-- ============================================================================

-- Ensure the column exists before we constrain it. (It already does in
-- production, but this keeps the script working against any older snapshot
-- that may have predated the column.)
ALTER TABLE public.ignition_payment_transactions
  ADD COLUMN IF NOT EXISTS transaction_id text;

-- Drop any existing constraint with the same name so we can re-run cleanly.
ALTER TABLE public.ignition_payment_transactions
  DROP CONSTRAINT IF EXISTS ignition_payment_transactions_transaction_id_key;

-- De-dupe any historic rows that share a transaction_id before we add the
-- constraint. We keep the most recently updated row in each group.
DELETE FROM public.ignition_payment_transactions a
USING public.ignition_payment_transactions b
WHERE a.id <> b.id
  AND a.transaction_id IS NOT NULL
  AND a.transaction_id = b.transaction_id
  AND COALESCE(a.updated_at, a.created_at, 'epoch') <
      COALESCE(b.updated_at, b.created_at, 'epoch');

-- Now add the constraint. NULL transaction_ids are allowed (Postgres treats
-- NULLs as distinct in unique constraints) so legacy rows missing a
-- transaction_id won't block this.
ALTER TABLE public.ignition_payment_transactions
  ADD CONSTRAINT ignition_payment_transactions_transaction_id_key
  UNIQUE (transaction_id);

-- Index to support the (transaction_id) lookup pattern used by upserts.
-- The unique constraint already creates an index, so this is a no-op in
-- the happy path but included for clarity / future maintenance.
CREATE INDEX IF NOT EXISTS idx_ignition_payment_transactions_transaction_id
  ON public.ignition_payment_transactions (transaction_id);

-- Helpful lookup index: many UI queries filter collections by disbursal.
CREATE INDEX IF NOT EXISTS idx_ignition_payment_transactions_disbursal_id
  ON public.ignition_payment_transactions (disbursal_id);
