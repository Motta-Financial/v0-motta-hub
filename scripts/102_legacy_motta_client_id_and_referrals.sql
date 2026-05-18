-- 102_legacy_motta_client_id_and_referrals.sql
--
-- Motta Hub data model additions:
--   1. contacts.legacy_motta_client_id        (ST_LASTNAME_FIRSTNAME_PHONE4)
--   2. referrals  (one row per referee, with the §4 state machine)
--
-- Idempotent: safe to run multiple times.
-- See v0_memories/user/motta-hub-data-model.md for the spec this implements.

------------------------------------------------------------------
-- 1. Legacy Motta Client ID column on contacts
------------------------------------------------------------------

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS legacy_motta_client_id text;

-- Case-insensitive uniqueness, but only when the value is set. We do
-- not enforce non-null because ~36% of contacts legitimately can't
-- have one (missing state/phone or organizations imported as contacts).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_legacy_motta_client_id_uniq
  ON contacts (legacy_motta_client_id)
  WHERE legacy_motta_client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_legacy_motta_client_id_idx
  ON contacts (legacy_motta_client_id);

COMMENT ON COLUMN contacts.legacy_motta_client_id IS
  'STATE_LASTNAME_FIRSTNAME_PHONE4 — derived. Karbon stores the same value in its custom field; Karbon wins on conflict (see motta-hub-data-model.md §3).';

------------------------------------------------------------------
-- 2. Referrals
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS referrals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Referee = the client who was referred IN
  referee_contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  referee_karbon_key       text,
  referee_name             text,

  -- Raw + derived view of the referrer
  referred_by_raw          text,
  referred_by_legacy_id    text,
  referred_by_contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  referred_by_karbon_key   text,
  referred_by_name         text,

  -- Resolution state
  match_status text NOT NULL CHECK (match_status IN (
    'matched',
    'unmatched_not_in_hub',
    'unmatched_format',
    'external_referrer',
    'no_referral'
  )),

  referral_date            date,
  notes                    text,

  -- Human review trail
  reviewed_by_id           uuid REFERENCES team_members(id) ON DELETE SET NULL,
  reviewed_at              timestamptz,
  resolved_at              timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- One referral row per referee — re-running the resolver should
  -- update in place rather than insert duplicates.
  CONSTRAINT referrals_referee_unique UNIQUE (referee_contact_id)
);

CREATE INDEX IF NOT EXISTS referrals_match_status_idx ON referrals (match_status);
CREATE INDEX IF NOT EXISTS referrals_referred_by_contact_idx
  ON referrals (referred_by_contact_id)
  WHERE referred_by_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_referred_by_legacy_id_idx
  ON referrals (referred_by_legacy_id)
  WHERE referred_by_legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_created_at_idx ON referrals (created_at DESC);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on referrals" ON referrals;
CREATE POLICY "Allow all on referrals" ON referrals
  FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION referrals_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS referrals_set_updated_at_trg ON referrals;
CREATE TRIGGER referrals_set_updated_at_trg
  BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION referrals_set_updated_at();
