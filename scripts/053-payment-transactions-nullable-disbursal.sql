-- ============================================================================
-- 053 — Allow ignition_payment_transactions.disbursal_id to be NULL
--
-- The /reporting/collections endpoint returns one row per payment transaction
-- and a transaction may not yet have been bundled into a disbursal (e.g.,
-- pending settlements). Forcing disbursal_id NOT NULL means we have to drop
-- those legitimate rows, which is worse than letting the FK be optional.
-- The FK constraint itself is preserved (and stays as NO ACTION), so
-- referential integrity is still enforced when a value IS supplied.
-- ============================================================================

ALTER TABLE public.ignition_payment_transactions
  ALTER COLUMN disbursal_id DROP NOT NULL;
