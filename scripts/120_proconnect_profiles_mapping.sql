-- ProConnect Profile Mapping (Issue: every Tax page rendered preparer = blank because
-- ProConnect's engagement payload only exposes opaque profile/auth IDs, not human names.)
--
-- Adds columns ProConnect already gives us in raw_json but the Edge Function never
-- persisted (assignee, lifecycle dates, engagement name, state) and introduces a
-- mapping table that resolves Intuit profile IDs to Motta team members.
--
-- The 13 profile IDs were enumerated from production engagement data (>10k rows
-- spanning tax years 2021-2025). full_name / team_member_id are nullable; the
-- operator fills them in from the Tax dashboard or a one-off backfill, and the
-- live join in the API surfaces the name everywhere downstream.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Profile mapping table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proconnect_profiles (
  proconnect_profile_id TEXT PRIMARY KEY,
  proconnect_auth_id    TEXT,
  -- Editable fallback name used when team_member_id isn't linked.
  -- Once team_member_id is set, the API JOIN takes precedence so this
  -- column quietly becomes a snapshot/seed value.
  full_name             TEXT,
  email                 TEXT,
  team_member_id        UUID REFERENCES team_members(id) ON DELETE SET NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proconnect_profiles_team_member
  ON proconnect_profiles(team_member_id);

CREATE INDEX IF NOT EXISTS idx_proconnect_profiles_auth_id
  ON proconnect_profiles(proconnect_auth_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Engagement columns the Edge Function will start populating after deploy.
--    Adding them here as nullable means existing rows stay valid; the next
--    sync pass fills them in from raw_json.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE proconnect_engagements
  ADD COLUMN IF NOT EXISTS assignee_profile_id   TEXT,
  ADD COLUMN IF NOT EXISTS assignee_auth_id      TEXT,
  ADD COLUMN IF NOT EXISTS created_by_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS modified_by_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS engagement_name       TEXT,
  ADD COLUMN IF NOT EXISTS engagement_state      TEXT,
  ADD COLUMN IF NOT EXISTS proconnect_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proconnect_modified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_defined_status_id TEXT;

CREATE INDEX IF NOT EXISTS idx_proconnect_engagements_assignee
  ON proconnect_engagements(assignee_profile_id);

CREATE INDEX IF NOT EXISTS idx_proconnect_engagements_state
  ON proconnect_engagements(engagement_state);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Seed the 13 known profile IDs from production engagement data.
--    full_name is left NULL so they show up flagged in the Tax > Settings
--    UI (or via a manual UPDATE) — never silently fabricated.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO proconnect_profiles (proconnect_profile_id, proconnect_auth_id) VALUES
  ('9130356180193166', '1021289310'),
  ('9130357689177946', '9130357689540656'),
  ('9130357116110556', '9130357116115066'),
  ('9130358037327936', '9411820150603780'),
  ('9341453844548280', '9411825946056060'),
  ('9341456228400639', '9411832195770040'),
  ('9130357642891586', '9130357663916416'),
  ('9130356938734826', '9130357052849646'),
  ('9341453349538075', '9411822876703039'),
  ('9130357400326496', '9130357128701016'),
  ('9341452323645265', '9411821125240290'),
  ('9130357689166406', '9130357690117046'),
  ('9130356938736506', '9130357531878716')
ON CONFLICT (proconnect_profile_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. View used by every Tax API and the parent dashboard.
--    Keeping the join logic in a view means the four route handlers don't
--    each have to redo the LEFT JOIN to two tables.
-- ─────────────────────────────────────────────────────────────────────────────

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
  cs.category         AS user_defined_status_category
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

-- Verification query — run after migration to confirm seeding & shape:
--   SELECT proconnect_profile_id, full_name IS NOT NULL AS has_name, team_member_id IS NOT NULL AS linked
--   FROM proconnect_profiles ORDER BY proconnect_profile_id;
--
--   SELECT COUNT(*) FROM proconnect_engagements_enriched;
