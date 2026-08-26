-- 405_proconnect_esignature.sql
--
-- Persist e-signature envelopes on the engagement row.
--
-- ─── WHY NOW ─────────────────────────────────────────────────────────
-- `esignature.envelopes[]` was recorded for months as "built, no data —
-- present on all 908 list rows, populated on none," and treated as an
-- Intuit gap. It is not. Measured 2026-08-24 with
-- scripts/402-check-esignature-envelopes.ts over 15 engagements:
--
--     esignature key present   15 / 15
--     non-empty envelopes      12 / 15
--
-- Empty on the LIST endpoint, populated on GET /v2/engagements/{id} —
-- exactly the same shape as the taxFiling.filings[] correction of
-- 2026-07-28, and inferred wrong for exactly the same reason: a key that
-- is present-but-empty on a bulk response proves nothing about the
-- single-resource response.
--
-- ─── WHY IT COSTS NOTHING ────────────────────────────────────────────
-- hydrateEngagementEfile() already calls fetchEngagement() for e-file
-- status. The envelopes arrive in that same payload and were being
-- discarded. This adds columns and an extraction; it adds ZERO API calls
-- and no new rate-limit pressure.
--
-- ─── SHAPE ───────────────────────────────────────────────────────────
--   esignature: { envelopes: [ { envelopeId, statuses: [ { status,
--                statusUpdateTimestamp } ] } ] }
-- Statuses observed live: "sent". The original Open API doc's own sample
-- shows the same shape. Like filingStatuses, the history is append-only
-- and NOT guaranteed ordered, so the latest is picked by timestamp, never
-- by array position.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------

alter table proconnect_engagements
  add column if not exists esignature_envelopes jsonb,
  add column if not exists esignature_status    text,
  add column if not exists esignature_count     integer;

comment on column proconnect_engagements.esignature_envelopes is
  'Raw esignature.envelopes[] from GET /v2/engagements/{id}. Empty on the '
  'list endpoint — only ever written by hydrateEngagementEfile().';
comment on column proconnect_engagements.esignature_status is
  'Latest status across all envelopes, by statusUpdateTimestamp. Null means '
  'either not hydrated yet or no envelopes — check efile_synced_at to tell '
  'the two apart, same convention as efile_status.';
comment on column proconnect_engagements.esignature_count is
  'Number of envelopes on the return. 0 and NULL differ: 0 means hydrated '
  'and none exist, NULL means never hydrated.';

-- Partial index: the interesting question is "which returns are out for
-- signature", never "which have none".
create index if not exists proconnect_engagements_esignature_idx
  on proconnect_engagements (esignature_status)
  where esignature_status is not null;

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Before hydration runs, every row is NULL. After the nightly catch-up
-- queue drains, expect roughly 4 in 5 engagements to carry envelopes:
--
--   select esignature_status, count(*)
--   from proconnect_engagements
--   group by 1 order by 2 desc;
