-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 046 — Jotform "Feedback + Referral" form support.
--
-- Builds on migration 045 by:
--
--   1. Generalizing `jotform_forms` with a `kind` column so the
--      multi-form webhook receiver can dispatch by form type rather
--      than baking form IDs into application code.
--
--   2. Seeding the Feedback + Referral form (240915444941155) so
--      `/api/jotform/webhook` recognizes its token and the backfill
--      script can find a parent row to attach submissions to.
--
--   3. Creating `jotform_feedback_submissions` with denormalized
--      columns shaped to *this* form's actual fields:
--        - submitter identity (name, email, first-time vs existing)
--        - five 1–5 ratings (overall, service quality, communication,
--          responsiveness, friendliness)
--        - long-form comment + social-share permission
--        - up to 5 referrals stored as a JSONB array
--        - triage workflow (status, reviewer, internal notes)
--        - nullable Karbon work-item linkage for when the form is
--          embedded inside a Karbon work item (prefilled URL params
--          land in `prefill_metadata`)
--
-- The webhook events table from migration 045 is generic and used
-- as-is for both forms (it's keyed by `jotform_form_id`).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Generalize the registry. Existing rows default to 'intake' so
--    nothing in production changes; the feedback form upserts as
--    'feedback'. The CHECK constraint keeps us honest if a third
--    form gets added later (only known kinds are allowed without an
--    explicit migration).
ALTER TABLE public.jotform_forms
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'intake';

-- Drop and re-add the CHECK so re-running the migration is safe
-- even if 'feedback' / 'other' weren't in the original constraint.
ALTER TABLE public.jotform_forms
  DROP CONSTRAINT IF EXISTS jotform_forms_kind_check;

ALTER TABLE public.jotform_forms
  ADD CONSTRAINT jotform_forms_kind_check
  CHECK (kind IN ('intake', 'feedback', 'debrief', 'other'));

-- Make the existing intake row explicit just in case.
UPDATE public.jotform_forms
   SET kind = 'intake'
 WHERE jotform_form_id = '242306172162144'
   AND (kind IS NULL OR kind <> 'intake');

-- 2. Seed the Feedback + Referral form. Generates a fresh
--    webhook_secret on insert; on conflict we leave the existing
--    secret untouched so re-running the migration doesn't break a
--    webhook URL that's already registered with Jotform.
INSERT INTO public.jotform_forms (
  jotform_form_id, title, slug, form_url, kind, is_enabled,
  submission_count, webhook_secret
)
VALUES (
  '240915444941155',
  'Feedback + Referral Form',
  'feedback-referral',
  'https://www.jotform.com/240915444941155',
  'feedback',
  TRUE,
  44,
  encode(gen_random_bytes(24), 'hex')
)
ON CONFLICT (jotform_form_id) DO UPDATE SET
  title = excluded.title,
  kind = 'feedback',
  is_enabled = excluded.is_enabled,
  submission_count = excluded.submission_count;

-- 3. The denormalized submissions table.
CREATE TABLE IF NOT EXISTS public.jotform_feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  jotform_submission_id text UNIQUE NOT NULL,
  jotform_form_id       text NOT NULL,
  form_id               uuid REFERENCES public.jotform_forms(id) ON DELETE SET NULL,

  -- Submitter
  submitter_full_name   text,
  submitter_first_name  text,
  submitter_last_name   text,
  submitter_email       text,
  -- Free-text from the Jotform radio "Are you a first-time client to
  -- Motta or existing?". Normalized in the parser to one of
  -- 'first_time' | 'existing' | NULL when it doesn't match.
  client_status         text CHECK (client_status IS NULL OR client_status IN ('first_time', 'existing')),

  -- Karbon work-item linkage. Populated either from URL prefill
  -- params on the embedded form (e.g. `?workItemId=…`) or by an
  -- admin manually wiring it from the detail sheet later.
  karbon_work_item_id    text,
  karbon_work_item_title text,
  karbon_work_item_url   text,
  contact_id             uuid REFERENCES public.contacts(id)      ON DELETE SET NULL,
  organization_id        uuid REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Ratings (Jotform `control_scale` and `control_rating`, both 1-5).
  rating_overall         smallint CHECK (rating_overall         IS NULL OR rating_overall         BETWEEN 1 AND 5),
  rating_service_quality smallint CHECK (rating_service_quality IS NULL OR rating_service_quality BETWEEN 1 AND 5),
  rating_communication   smallint CHECK (rating_communication   IS NULL OR rating_communication   BETWEEN 1 AND 5),
  rating_responsiveness  smallint CHECK (rating_responsiveness  IS NULL OR rating_responsiveness  BETWEEN 1 AND 5),
  rating_friendliness    smallint CHECK (rating_friendliness    IS NULL OR rating_friendliness    BETWEEN 1 AND 5),

  -- Feedback content
  feedback_comments     text,
  permission_to_share   boolean,

  -- Referral interest + up to 5 referrals stored as
  -- [{ name, email, notes }] in display order.
  has_referral_interest boolean,
  referral_count        smallint NOT NULL DEFAULT 0,
  referrals             jsonb    NOT NULL DEFAULT '[]'::jsonb,

  -- Triage workflow
  triage_status         text NOT NULL DEFAULT 'new'
                            CHECK (triage_status IN ('new', 'reviewed', 'responded', 'closed')),
  reviewed_by_id        uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  internal_notes        text,

  -- Raw payload + delivery metadata
  raw_answers           jsonb NOT NULL DEFAULT '{}'::jsonb,
  prefill_metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address            text,
  status                text,
  flag                  smallint,
  is_new                boolean DEFAULT false,

  jotform_created_at    timestamptz,
  jotform_updated_at    timestamptz,
  ingested_at           timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_synced_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_jotform_feedback_created
  ON public.jotform_feedback_submissions (jotform_created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_jotform_feedback_status
  ON public.jotform_feedback_submissions (triage_status);
CREATE INDEX IF NOT EXISTS idx_jotform_feedback_email
  ON public.jotform_feedback_submissions (lower(submitter_email));
CREATE INDEX IF NOT EXISTS idx_jotform_feedback_rating
  ON public.jotform_feedback_submissions (rating_overall DESC NULLS LAST);
-- Partial index — most rows won't have a work-item attached, so
-- only index the ones we'll actually look up by Karbon ID.
CREATE INDEX IF NOT EXISTS idx_jotform_feedback_workitem
  ON public.jotform_feedback_submissions (karbon_work_item_id)
  WHERE karbon_work_item_id IS NOT NULL;

-- updated_at trigger — reuses the function from migration 045.
DROP TRIGGER IF EXISTS trg_jotform_feedback_updated_at ON public.jotform_feedback_submissions;
CREATE TRIGGER trg_jotform_feedback_updated_at
  BEFORE UPDATE ON public.jotform_feedback_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_jotform_updated_at();

-- RLS — same posture as `jotform_intake_submissions`: all
-- authenticated firm staff can read/write, the webhook receiver uses
-- the service-role key so external POSTs aren't affected.
ALTER TABLE public.jotform_feedback_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on jotform_feedback_submissions" ON public.jotform_feedback_submissions;
CREATE POLICY "Allow all on jotform_feedback_submissions"
  ON public.jotform_feedback_submissions FOR ALL
  USING (true) WITH CHECK (true);
