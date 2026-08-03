-- ──────────────────────────────────────────────────────────────────────
-- 121_proconnect_clients_synced_at_trigger.sql
--
-- Purpose: guarantee proconnect_clients.synced_at is always populated.
--
-- Background: we have two code paths that upsert into
-- proconnect_clients — the Supabase Edge Function
-- (`supabase/functions/proconnect-sync/index.ts`) and the legacy
-- Vercel route (`lib/proconnect/sync.ts`). Both *intend* to write
-- synced_at, but the legacy path frequently times out at 60s with
-- partial completion, leaving rows with synced_at = NULL even
-- though updated_at advances. The /tax dashboard's "live data, X
-- minutes ago" pill needs synced_at to be reliable, so we lift the
-- contract into the database itself.
--
-- Implementation: a BEFORE INSERT/UPDATE trigger that sets
-- synced_at := NOW() whenever the row is touched. This is more
-- resilient than fixing the application code because any future
-- code path (ALFRED, manual SQL, a third sync tool) gets the
-- correct behaviour for free.
-- ──────────────────────────────────────────────────────────────────────

-- 1. Backfill existing NULLs from updated_at (or created_at as a last
--    resort). After this, the trigger keeps things current going forward.
UPDATE proconnect_clients
SET synced_at = COALESCE(updated_at, created_at, NOW())
WHERE synced_at IS NULL;

-- 2. Trigger function — sets synced_at on every write. We set it
--    unconditionally rather than COALESCE-style because "the row was
--    just touched by the sync pipeline" is exactly what synced_at means.
CREATE OR REPLACE FUNCTION proconnect_clients_set_synced_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.synced_at := NOW();
  RETURN NEW;
END;
$$;

-- 3. Wire the trigger. Drop-and-recreate is safe because the function
--    body above is idempotent.
DROP TRIGGER IF EXISTS set_synced_at_on_proconnect_clients
  ON proconnect_clients;

CREATE TRIGGER set_synced_at_on_proconnect_clients
  BEFORE INSERT OR UPDATE ON proconnect_clients
  FOR EACH ROW
  EXECUTE FUNCTION proconnect_clients_set_synced_at();

-- 4. Mirror the same guarantee on proconnect_engagements so the
--    dashboard's freshness math is consistent across both tables.
CREATE OR REPLACE FUNCTION proconnect_engagements_set_synced_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.synced_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_synced_at_on_proconnect_engagements
  ON proconnect_engagements;

CREATE TRIGGER set_synced_at_on_proconnect_engagements
  BEFORE INSERT OR UPDATE ON proconnect_engagements
  FOR EACH ROW
  EXECUTE FUNCTION proconnect_engagements_set_synced_at();

-- 5. Sanity backfill on engagements too (most rows already have a
--    valid value; this just plugs any historical gaps).
UPDATE proconnect_engagements
SET synced_at = COALESCE(synced_at, updated_at, created_at, NOW())
WHERE synced_at IS NULL;
