-- Prospect form revamp: type-driven intake, socials, referral linking,
-- enrichment, and Karbon work-item request snapshot.
--
-- Hub-only migration. The Hub `contacts.id` (or `organizations.id` for a
-- business) remains the master record; everything here hangs off the
-- existing prospect_submissions.contact_id / organization_id columns.

-- 1. Prospect type --------------------------------------------------------
ALTER TABLE prospect_submissions
  ADD COLUMN IF NOT EXISTS prospect_type text;

-- Allowed: 'individual' | 'business' | 'individual_business'
ALTER TABLE prospect_submissions
  DROP CONSTRAINT IF EXISTS prospect_submissions_prospect_type_check;
ALTER TABLE prospect_submissions
  ADD CONSTRAINT prospect_submissions_prospect_type_check
  CHECK (prospect_type IS NULL OR prospect_type IN ('individual','business','individual_business'));

COMMENT ON COLUMN prospect_submissions.prospect_type IS
  'Drives required fields and which Karbon entities are created. individual_business == business owners (both a person and their company).';

-- 2. Individual socials ---------------------------------------------------
ALTER TABLE prospect_submissions
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS twitter_url text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text;

-- 3. Business socials -----------------------------------------------------
ALTER TABLE prospect_submissions
  ADD COLUMN IF NOT EXISTS business_website text,
  ADD COLUMN IF NOT EXISTS business_linkedin_url text,
  ADD COLUMN IF NOT EXISTS business_twitter_url text,
  ADD COLUMN IF NOT EXISTS business_facebook_url text,
  ADD COLUMN IF NOT EXISTS business_instagram_url text;

-- 4. Business "same as owner" convenience flags ---------------------------
ALTER TABLE prospect_submissions
  ADD COLUMN IF NOT EXISTS business_email_same_as_owner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_phone_same_as_owner boolean NOT NULL DEFAULT false;

-- 5. Referral linking -----------------------------------------------------
ALTER TABLE prospect_submissions
  ADD COLUMN IF NOT EXISTS referred_by_raw text,
  ADD COLUMN IF NOT EXISTS referred_by_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_id uuid REFERENCES referrals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_submissions_referred_by_contact_id
  ON prospect_submissions(referred_by_contact_id);
CREATE INDEX IF NOT EXISTS idx_prospect_submissions_referral_id
  ON prospect_submissions(referral_id);

COMMENT ON COLUMN prospect_submissions.referred_by_raw IS
  'Free-text referrer name when no contact match was selected. Surfaced for human review; never auto-creates a referrer contact.';
COMMENT ON COLUMN prospect_submissions.referred_by_contact_id IS
  'Matched referrer from the Hub contacts database, when one was selected.';

-- 6. ALFRED enrichment ----------------------------------------------------
ALTER TABLE prospect_submissions
  ADD COLUMN IF NOT EXISTS enrichment jsonb,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

COMMENT ON COLUMN prospect_submissions.enrichment IS
  'ALFRED-generated profile enrichment derived from provided website/socials.';

-- 7. Karbon work-item request snapshot -----------------------------------
-- (karbon_work_item_key/title/url already exist from a prior migration.)
ALTER TABLE prospect_submissions
  ADD COLUMN IF NOT EXISTS karbon_work_template_key text,
  ADD COLUMN IF NOT EXISTS karbon_work_item_fields jsonb;

COMMENT ON COLUMN prospect_submissions.karbon_work_template_key IS
  'WorkTemplateKey chosen in the optional "Create Karbon Work Item" section.';
COMMENT ON COLUMN prospect_submissions.karbon_work_item_fields IS
  'Core WorkItem fields captured in the form (assignee, dates, budget, status) before posting to Karbon.';

-- 8. Backfill prospect_type from existing rows ----------------------------
-- personal-only -> individual; business-only -> business; both -> individual_business.
UPDATE prospect_submissions
SET prospect_type = CASE
  WHEN (business_name IS NOT NULL AND length(trim(business_name)) > 0)
       AND (submitter_email IS NOT NULL AND length(trim(submitter_email)) > 0)
    THEN 'individual_business'
  WHEN (business_name IS NOT NULL AND length(trim(business_name)) > 0)
    THEN 'business'
  ELSE 'individual'
END
WHERE prospect_type IS NULL;
