-- ============================================================================
-- Migration 100: Filterable columns for the Intake table UI
-- ============================================================================
--
-- Surfaces three pieces of data that already live (mostly) inside the
-- raw Jotform answers but weren't denormalized for filtering:
--
--   1. referral_source         — free text from the "Who sent you our
--                                way?" field (Jotform `whoSent`).
--   2. preferred_team_member_id — FK to team_members.id, populated by the
--                                ingest pipeline when the prospect's
--                                "specific team member you would prefer
--                                to meet with" choice resolves to an
--                                active teammate. Lets the Intake list
--                                page link the row to the chosen
--                                professional's profile.
--
-- We keep the existing free-text `preferred_team_member` column as the
-- "what the prospect wrote" source of truth — useful to display when no
-- match could be made (mis-spelling, deactivated teammate, etc.) — and
-- treat the new FK as the "who we resolved them to" derived value.
--
-- Indexes added so the new filters in app/api/jotform/intake stay fast
-- as the table grows: state and referral_source are queried with
-- equality / ILIKE; preferred_team_member_id is queried with equality;
-- jotform_created_at gets a btree index for the date-range filter.
-- ============================================================================

ALTER TABLE jotform_intake_submissions
  ADD COLUMN IF NOT EXISTS referral_source TEXT,
  ADD COLUMN IF NOT EXISTS preferred_team_member_id UUID
    REFERENCES team_members(id) ON DELETE SET NULL;

-- Filter indexes. Partial-NULL where appropriate so we don't index the
-- long tail of submissions that never answered the optional question.
CREATE INDEX IF NOT EXISTS idx_jotform_intake_state
  ON jotform_intake_submissions (submitter_state)
  WHERE submitter_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jotform_intake_referral_source
  ON jotform_intake_submissions (referral_source)
  WHERE referral_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jotform_intake_preferred_team_member_id
  ON jotform_intake_submissions (preferred_team_member_id)
  WHERE preferred_team_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jotform_intake_created_at
  ON jotform_intake_submissions (jotform_created_at DESC);

-- ── Documentation ──────────────────────────────────────────────────────────
COMMENT ON COLUMN jotform_intake_submissions.referral_source IS
  'Free-text answer to "Who sent you our way? Any shoutouts to your '
  'referral?" (Jotform field: whoSent). Populated by lib/jotform/parse.ts '
  'and the migration 100 backfill.';

COMMENT ON COLUMN jotform_intake_submissions.preferred_team_member_id IS
  'Resolved FK to team_members.id from the prospect''s preferred-teammate '
  'answer. Resolution rules: see lib/jotform/assign.ts. NULL when the '
  'prospect skipped the question or the typed name didn''t match an active '
  'teammate. Independent from assigned_to_id so a triager can re-assign '
  'without losing the prospect''s original choice.';
