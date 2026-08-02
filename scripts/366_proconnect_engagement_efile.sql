-- 366: e-file status needs its own hydration path, separate from the
-- engagement list sync.
--
-- ─── WHAT WE LEARNED ────────────────────────────────────────────────
-- The Hub reads engagements from the bulk list endpoint:
--
--     GET /v2/engagements?source=ITO&period={year}&include-efiles=true
--
-- `include-efiles=true` is a no-op there. The list returns a `taxFiling`
-- key on every engagement with an empty `filings` array — 908 of 908 rows,
-- zero with a filing. We had this filed as an open question for Intuit
-- (docs/proconnect-api-coverage-status.md) on the assumption the data
-- simply wasn't populated upstream.
--
-- It is populated. The SINGLE-engagement GET returns it:
--
--     GET /v2/engagements/{engagementId}   →  taxFiling.filings[] (2 filings)
--
-- So e-file status was never an Intuit dependency — it is one API call per
-- engagement instead of one per tax year, which is a different sync shape
-- and needs different columns.
--
-- ─── WHY NEW COLUMNS ────────────────────────────────────────────────
-- `efile_status` already exists: a single string, the latest filing status
-- by `statusUpdateTimestamp`. Two problems with it as the only store.
--
--   1. `filings[]` is per-jurisdiction — federal plus each state — and
--      each filing carries its own status history. Collapsing that to one
--      string loses the federal/state split. Since hydrating it costs one
--      API call per engagement (~908 calls at the client's 4 req/s
--      throttle, i.e. minutes, not seconds), we should not have to
--      re-fetch all of it later just to answer "was NY accepted?".
--      `efile_filings` keeps the payload verbatim so that question is
--      answerable from the DB whenever the UI wants it.
--
--      The live payload turned out to be deeper than the old parser assumed:
--      filings nest, so a 1120's REGULAR federal filing can have an empty
--      `filingStatuses` while its EXTENSION child carries three rounds of
--      PENDING_EFE → PENDING_AGENCY → ACK_REJECTED. Each status also carries
--      `userMessage` ("Rejected"), `errorInfo[]` with IRS reject codes, and a
--      `confirmationNumber` — none of which survive a single status string.
--      `efile_latest` records which filing the scalar came from so the UI can
--      say "extension rejected" rather than implying the return was.
--
--   2. Nothing recorded WHEN e-file status was last read. The nightly
--      bulk sync can't refresh it (that's the list endpoint), so the
--      hydrator needs a high-water mark to decide what's stale:
--      `efile_synced_at IS NULL` (never hydrated) or
--      `proconnect_modified_at > efile_synced_at` (changed in PTO since we
--      last looked). That query is the whole scheduling strategy —
--      webhooks cover the hot path during filing season, and this covers
--      anything a webhook missed, capped per run so the cron stays inside
--      its 300s limit.
--
-- ─── THE CLOBBER THIS GOES WITH ─────────────────────────────────────
-- The list-path upserts used to write `efile_status` from the list payload
-- — always NULL, since the list has no filings. Left as-is, every nightly
-- sync would erase whatever the hydrator wrote. The code change that
-- accompanies this migration drops `efile_status` from those payloads
-- (PostgREST only SETs columns present in the body, so omitting the key
-- leaves the hydrated value untouched). Do not reintroduce it in
-- mapEngagementRow, the proconnect-sync-engagements edge function, or
-- scripts/proconnect-full-sync.ts.
--
-- ─── NO INDEX, DELIBERATELY ─────────────────────────────────────────
-- The stale-engagement query below scans proconnect_engagements, which
-- holds 908 rows and grows by ~400/year. A seq scan on that is cheaper
-- than maintaining an index, and the query runs a few times a day from
-- one cron. Revisit if the table reaches six figures, which would mean
-- something else has gone wrong.

BEGIN;

ALTER TABLE proconnect_engagements
  ADD COLUMN IF NOT EXISTS efile_filings JSONB,
  ADD COLUMN IF NOT EXISTS efile_latest JSONB,
  ADD COLUMN IF NOT EXISTS efile_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN proconnect_engagements.efile_status IS
  'Latest filing status across all jurisdictions, by statusUpdateTimestamp. '
  'Hydrated from GET /v2/engagements/{id} — NOT available on the bulk list '
  'endpoint. Never write this from a list-derived payload.';

COMMENT ON COLUMN proconnect_engagements.efile_filings IS
  'Verbatim taxFiling object from GET /v2/engagements/{id}, including the '
  'per-jurisdiction filings[] array, nested children[] (extensions), and '
  'each filing''s full status history.';

COMMENT ON COLUMN proconnect_engagements.efile_latest IS
  'The single filing status efile_status was taken from, with the context '
  'needed to render it honestly: {status, userMessage, filingType, '
  'filingLevel, jurisdiction, statusUpdateTimestamp, confirmationNumber, '
  'errorCodes, primaryFiling, derivedStatus}. filingType matters — an '
  'EXTENSION rejection is not a rejected return, and efile_status alone '
  'cannot tell the difference.';

COMMENT ON COLUMN proconnect_engagements.efile_synced_at IS
  'When e-file status was last hydrated from the single-engagement GET. '
  'NULL means never. Compared against proconnect_modified_at to find rows '
  'that changed in ProConnect since we last read their filings.';

-- Rows whose e-file status the hydrator should (re)read, most recent tax
-- year first. A view rather than an inline filter because PostgREST cannot
-- express a column-to-column comparison (`proconnect_modified_at >
-- efile_synced_at`) through the REST query interface.
CREATE OR REPLACE VIEW proconnect_engagements_efile_stale AS
SELECT
  engagement_id,
  proconnect_client_id,
  tax_year,
  proconnect_modified_at,
  efile_synced_at
FROM proconnect_engagements
WHERE engagement_id IS NOT NULL
  AND (
    efile_synced_at IS NULL
    OR (
      proconnect_modified_at IS NOT NULL
      AND proconnect_modified_at > efile_synced_at
    )
  );

-- Same lockdown as migration 359: `anon` gets no read on firm data
-- through a view. This one exposes engagement and client ids.
REVOKE SELECT ON proconnect_engagements_efile_stale FROM anon;

-- Expose the hydration high-water mark to the Tax APIs that already read
-- the enriched view, so a stale e-file badge can be labelled as such.
-- efile_filings is deliberately NOT in the view — it would drag a jsonb
-- blob into every dashboard query that only wants the status string.
CREATE OR REPLACE VIEW proconnect_engagements_enriched AS
SELECT
  e.engagement_id,
  e.proconnect_client_id,
  e.tax_year,
  e.return_type,
  e.form_type,
  e.status,
  e.efile_status,
  e.work_status,
  e.engagement_state,
  e.engagement_name,
  e.user_defined_status_id,
  e.proconnect_created_at,
  e.proconnect_modified_at,
  e.assignee_profile_id,
  e.synced_at,
  e.updated_at,
  c.display_name      AS client_display_name,
  c.business_name     AS client_business_name,
  c.first_name        AS client_first_name,
  c.last_name         AS client_last_name,
  c.email             AS client_email,
  COALESCE(tm.full_name, p.full_name) AS preparer_name,
  tm.email            AS preparer_email,
  p.team_member_id    AS preparer_team_member_id,
  cs.name             AS user_defined_status_name,
  cs.color            AS user_defined_status_color,
  -- Appended, in this order, deliberately: CREATE OR REPLACE VIEW can only
  -- ADD trailing columns. Inserting efile_latest before efile_synced_at
  -- reads as a rename of the existing last column and errors with 42P16.
  -- New columns go at the end, always.
  e.efile_synced_at,
  e.efile_latest
FROM proconnect_engagements e
LEFT JOIN proconnect_clients c
  ON c.proconnect_client_id = e.proconnect_client_id
LEFT JOIN proconnect_profiles p
  ON p.proconnect_profile_id = e.assignee_profile_id
LEFT JOIN team_members tm
  ON tm.id = p.team_member_id
LEFT JOIN proconnect_custom_statuses cs
  ON cs.status_id = e.user_defined_status_id;

COMMIT;

-- Verification — after the backfill (scripts/366-backfill-engagement-efile.ts)
-- these should show real coverage instead of the 0-of-908 we had before:
--
--   SELECT COUNT(*) AS total,
--          COUNT(efile_status) AS with_status,
--          COUNT(efile_synced_at) AS hydrated
--   FROM proconnect_engagements;
--
--   SELECT tax_year, efile_status, COUNT(*)
--   FROM proconnect_engagements
--   WHERE efile_status IS NOT NULL
--   GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;
