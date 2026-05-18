-- 103_referrals_multisource.sql
--
-- Extend `referrals` so it can hold both:
--   • Karbon-side referrals (referee = contact, source = the
--     `referral_client_id` value in contacts.custom_fields, or the
--     legacy contacts.referred_by column)
--   • Jotform intake-side referrals (referee = a not-yet-converted
--     prospect submission; source = jotform_intake_submissions.referral_source)
--
-- Idempotent.

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS referee_jotform_submission_id uuid
    REFERENCES jotform_intake_submissions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'contacts_referred_by',
  ADD COLUMN IF NOT EXISTS match_confidence numeric,
  ADD COLUMN IF NOT EXISTS candidate_contact_ids jsonb;

-- Widen the match_status enum to match the §4 state machine in
-- motta-hub-data-model.md. The original 102 migration shipped a
-- shorter list — drop and re-add the check.
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_match_status_check;
ALTER TABLE referrals
  ADD CONSTRAINT referrals_match_status_check
  CHECK (match_status IN (
    'matched',
    'matched_existing',
    'unmatched_not_in_hub',
    'unmatched_format',
    'unmatched_ambiguous',
    'unmatched_external',
    'external_referrer',
    'no_referral'
  ));

-- referee_contact_id must now be nullable (jotform-only referrals
-- have no contact yet). Drop NOT NULL if it was set.
ALTER TABLE referrals ALTER COLUMN referee_contact_id DROP NOT NULL;

-- Allow `source` to identify ingest origin without locking to a
-- whitelist (Karbon could add new custom fields later).
COMMENT ON COLUMN referrals.source IS
  'Origin of the row: contacts_referred_by | karbon_custom_field | jotform_intake | manual';

-- Replace the single-column UNIQUE with two source-aware partial
-- indexes so the same referee can have at most one row per source.
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_referee_unique;

CREATE UNIQUE INDEX IF NOT EXISTS referrals_referee_contact_source_uniq
  ON referrals (referee_contact_id, source)
  WHERE referee_contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referrals_referee_jotform_uniq
  ON referrals (referee_jotform_submission_id)
  WHERE referee_jotform_submission_id IS NOT NULL;

-- Sanity: every row must point at exactly one referee.
ALTER TABLE referrals
  DROP CONSTRAINT IF EXISTS referrals_referee_present_chk;
ALTER TABLE referrals
  ADD CONSTRAINT referrals_referee_present_chk
  CHECK (
    (referee_contact_id IS NOT NULL)::int
    + (referee_jotform_submission_id IS NOT NULL)::int
    = 1
  );

CREATE INDEX IF NOT EXISTS referrals_source_idx ON referrals (source);
CREATE INDEX IF NOT EXISTS referrals_referee_jotform_idx
  ON referrals (referee_jotform_submission_id)
  WHERE referee_jotform_submission_id IS NOT NULL;
