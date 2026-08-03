-- 366-restore: rebuild efile_status from efile_latest, no API calls.
--
-- Run this after any sync that ran the OLD list-path code (which wrote
-- efile_status from a payload that never carries filings) and blanked
-- hydrated values. It happened for real on 2026-07-28: two manual
-- POST /api/proconnect/sync calls — made only to refresh an OAuth token
-- mid-backfill — nulled 407 freshly hydrated statuses.
--
-- The repair is cheap precisely because efile_latest and efile_filings are
-- separate columns that the old code doesn't know about, so a clobber costs
-- the scalar only, never the ~10 minutes of API calls behind it. That was the
-- point of storing the detail rather than a lone status string.
--
-- Safe to re-run. Only touches rows where the scalar is missing but the detail
-- is present, and never overwrites a status that's already there.

UPDATE proconnect_engagements
SET efile_status = efile_latest->>'status',
    updated_at = NOW()
WHERE efile_status IS NULL
  AND efile_latest IS NOT NULL
  AND efile_latest->>'status' IS NOT NULL;

-- Expected after the fix ships: 0 rows, forever. If this ever restores rows
-- again, something is writing efile_status from a list-derived payload —
-- check mapEngagementRow, the proconnect-sync-engagements edge function, and
-- scripts/proconnect-full-sync.ts.
SELECT COUNT(*)          AS total,
       COUNT(efile_status)  AS with_status,
       COUNT(efile_latest)  AS with_detail,
       COUNT(efile_synced_at) AS hydrated
FROM proconnect_engagements;
