-- =====================================================================
-- 052_alfred_service_account.sql
-- ---------------------------------------------------------------------
-- Establishes the ALFRED AI service account row in team_members.
--
-- The ALFRED service account represents the assistant itself when it
-- acts on behalf of the firm: creating debriefs from transcripts,
-- posting automated messages, assigning tasks, recording activity, etc.
-- Anywhere code takes a team_member.id, it can take ALFRED's id and
-- the row behaves like any other team member, EXCEPT:
--
--   1. is_service_account = TRUE         (this column)
--   2. cannot be deactivated             (trigger below)
--   3. only one service account exists   (partial unique index below)
--
-- Middleware does NOT auto-elevate this account. It is NOT an admin.
-- All elevation decisions remain explicit at the call site.
--
-- This migration is idempotent and safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema: is_service_account column
-- ---------------------------------------------------------------------
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS is_service_account BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN team_members.is_service_account IS
  'TRUE only for non-human team_members rows that represent automated '
  'service accounts (e.g. ALFRED AI). Service accounts cannot be '
  'deactivated and admin UIs must not expose deactivate controls for '
  'them. See lib/alfred/service-account.ts for the canonical helper.';

-- Partial unique index: at most one row in the table may have
-- is_service_account = TRUE. This is a defensive guarantee against
-- accidental duplicates produced by Karbon sync or manual SQL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_single_service_account
  ON team_members ((is_service_account))
  WHERE is_service_account = TRUE;

-- ---------------------------------------------------------------------
-- 2. Trigger: prevent deactivating a service account
-- ---------------------------------------------------------------------
-- Bulletproof server-side guard. Even if a future API route, manual
-- SQL session, or third-party sync tries to flip is_active to FALSE on
-- a service-account row, the database itself rejects the UPDATE.
--
-- The trigger ALSO prevents flipping is_service_account back to FALSE,
-- which would otherwise be an obvious bypass: "set is_service_account
-- = false, then set is_active = false". Both transitions are blocked.

CREATE OR REPLACE FUNCTION team_members_protect_service_account()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow normal updates on non-service-account rows.
  IF OLD.is_service_account IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Block deactivation.
  IF NEW.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'team_members row % is a service account and cannot be deactivated. '
      'See lib/alfred/service-account.ts.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Block demoting away from service-account status.
  IF NEW.is_service_account IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'team_members row % is a service account and cannot be demoted '
      'to a regular account.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_members_protect_service_account ON team_members;
CREATE TRIGGER trg_team_members_protect_service_account
  BEFORE UPDATE OF is_active, is_service_account
  ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION team_members_protect_service_account();

-- ---------------------------------------------------------------------
-- 3. Seed: idempotent upsert of the ALFRED row
-- ---------------------------------------------------------------------
-- email has a UNIQUE constraint (team_members_email_key), so this works
-- whether or not the row already exists. We deliberately do NOT touch
-- avatar_url, karbon_user_key, manager_id, or auth_user_id here; those
-- are managed elsewhere (Karbon sync, auth provisioning).

INSERT INTO team_members (
  email,
  full_name,
  first_name,
  last_name,
  role,
  department,
  title,
  is_active,
  is_service_account,
  created_at,
  updated_at
)
VALUES (
  'Info@mottafinancial.com',
  'ALFRED AI',
  'ALFRED',
  'AI',
  'AI Assistant',
  'Automation',
  'AI Assistant',
  TRUE,
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO UPDATE
SET
  full_name          = EXCLUDED.full_name,
  first_name         = EXCLUDED.first_name,
  last_name          = EXCLUDED.last_name,
  role               = EXCLUDED.role,
  department         = EXCLUDED.department,
  title              = EXCLUDED.title,
  is_active          = TRUE,
  is_service_account = TRUE,
  updated_at         = NOW();
