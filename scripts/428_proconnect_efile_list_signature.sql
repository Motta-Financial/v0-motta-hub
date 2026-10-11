-- 428: Let the engagement LIST tell the e-file hydrator what changed.
--
-- ─── WHAT WE LEARNED ────────────────────────────────────────────────
-- 366 recorded that the list endpoint carries no e-file data ("908 of 908"
-- empty). That checked `taxFiling.filings`, which IS always empty on the
-- list. With `include-efiles=true` the list returns a different, flat field,
-- `taxFilings[]` (Intuit's V4 doc §2.1), and it is populated: 330 of 398
-- TY2025 engagements on 2026-10-11. Against 727 hydrated TY2024/2025
-- engagements it matched the nested filings one-for-one — same filingId,
-- same latest statusUpdateTimestamp, on every filing that has a status.
--
-- It cannot REPLACE hydration: no status enum (only "Accepted"/"Rejected"
-- text), no confirmation number, no reject codes, no history — and the
-- list's `esignature.envelopes` is empty on every engagement even with
-- include-esignatures=true. But it can say, for free, WHICH engagements'
-- filings changed since we last hydrated them.
--
-- ─── THE TWO COLUMNS ────────────────────────────────────────────────
-- Both hold the same fingerprint — every filing with a status, as
-- `filingId#instance@latestStatusEpochMs`, sorted — computed by
-- lib/proconnect/sync.ts (listEfileSignature / hydratedEfileSignature).
--
--   list_efile_signature  written by the LIST sync (mapEngagementRow).
--                         NULL = list didn't say; '' = list says no filings.
--                         Deliberately not named efile_*: list-derived
--                         payloads must never write efile_* (see 366).
--   efile_signature       written by the HYDRATOR alongside efile_filings.
--
-- ─── THE QUEUE ──────────────────────────────────────────────────────
-- A row is stale when (as before) it was never hydrated or was modified in
-- PTO since, OR (new) the list's signature differs from the hydrated one.
-- The new column efile_list_changed lets the hydrator take positively-
-- changed rows first, so a capped nightly pass spends its budget on rows
-- whose e-file badge is known to be wrong before rows that merely might be.
--
-- The modified-since trigger stays: it is what keeps esignature_* fresh.
--
-- ─── ORDERING ───────────────────────────────────────────────────────
-- Apply BEFORE deploying the code that writes these columns. The bulk sync
-- upserts list_efile_signature on every row; against a table without the
-- column, PostgREST rejects the whole batch and the nightly engagement sync
-- stops landing.
--
-- After applying, run scripts/428-backfill-efile-signature.ts once. Without
-- it every already-hydrated engagement with a filing has efile_signature
-- NULL, mismatches the list, and gets re-hydrated once (~600 calls spread
-- over a few nights). Harmless, but pointless — the backfill computes the
-- signature from the stored efile_filings with no API calls.

BEGIN;

ALTER TABLE proconnect_engagements
  ADD COLUMN IF NOT EXISTS list_efile_signature TEXT,
  ADD COLUMN IF NOT EXISTS efile_signature TEXT;

COMMENT ON COLUMN proconnect_engagements.list_efile_signature IS
  'Fingerprint of the LIST endpoint''s flat taxFilings[] (include-efiles=true), '
  'written by the list sync. Change detection only — never a status. NULL = '
  'the list did not report; empty string = no filings.';

COMMENT ON COLUMN proconnect_engagements.efile_signature IS
  'The same fingerprint computed from efile_filings when the hydrator last '
  'read GET /v2/engagements/{id}. Differs from list_efile_signature when '
  'ProConnect has filing activity we have not hydrated yet.';

-- Existing columns unchanged and in their original order; CREATE OR REPLACE
-- VIEW can only append.
CREATE OR REPLACE VIEW proconnect_engagements_efile_stale AS
SELECT
  engagement_id,
  proconnect_client_id,
  tax_year,
  proconnect_modified_at,
  efile_synced_at,
  (
    efile_synced_at IS NOT NULL
    AND list_efile_signature IS NOT NULL
    AND list_efile_signature IS DISTINCT FROM efile_signature
  ) AS efile_list_changed
FROM proconnect_engagements
WHERE engagement_id IS NOT NULL
  AND (
    efile_synced_at IS NULL
    OR (
      proconnect_modified_at IS NOT NULL
      AND proconnect_modified_at > efile_synced_at
    )
    OR (
      list_efile_signature IS NOT NULL
      AND list_efile_signature IS DISTINCT FROM efile_signature
    )
  );

-- CREATE OR REPLACE keeps existing grants, but restate 366's lockdown so
-- this file is safe to read on its own.
REVOKE SELECT ON proconnect_engagements_efile_stale FROM anon;

COMMIT;

-- Verification, after the backfill and one bulk sync:
--
--   SELECT COUNT(*) FILTER (WHERE list_efile_signature IS NOT NULL) AS listed,
--          COUNT(*) FILTER (WHERE efile_signature IS NOT NULL)      AS hydrated,
--          COUNT(*) FILTER (WHERE list_efile_signature IS DISTINCT FROM efile_signature
--                             AND list_efile_signature IS NOT NULL
--                             AND efile_synced_at IS NOT NULL)     AS list_changed
--   FROM proconnect_engagements;
--
-- list_changed should be ~0 outside filing season; it is the number of
-- engagements whose e-file badge is known to be behind ProConnect.
