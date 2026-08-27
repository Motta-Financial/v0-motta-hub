-- 406_backfill_work_status.sql
--
-- Backfill proconnect_engagements.work_status from the raw payload.
--
-- ─── WHY ─────────────────────────────────────────────────────────────
-- lib/proconnect/sync.ts read `eng.workStatus`. Intuit's engagement payload
-- has no such field — it is `customStatus` (confirmed against Intuit's own
-- sample in the original Open API doc, and against live data). So the
-- column was silently null on every row since the integration was built:
--
--   work_status set      0 of 923
--   customStatus set   702 of 923
--
-- Nothing errored. Every consumer — /api/tax/returns, /api/tax/clients,
-- /api/tax/clients/[clientId], the tax project view — read a null and
-- rendered nothing, which is indistinguishable from "this return has no
-- status yet."
--
-- The code fix makes future syncs correct. This backfills the history so
-- the column is usable immediately rather than after the nightly sync.
--
-- Idempotent: safe to re-run. Only touches rows where the payload has a
-- non-empty customStatus, so it can never overwrite a real value with null.
-- ---------------------------------------------------------------------

update proconnect_engagements
set    work_status = nullif(raw_json->>'customStatus', ''),
       updated_at  = now()
where  nullif(raw_json->>'customStatus', '') is not null
  and  work_status is distinct from nullif(raw_json->>'customStatus', '');

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Expect ~702 of 923, matching the customStatus census:
--
--   select count(*) filter (where work_status is not null) as set,
--          count(*) as total
--   from proconnect_engagements;
