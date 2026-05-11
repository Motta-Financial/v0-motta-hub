-- Internal "Prospect Form" — Motta Hub-native sibling of the Jotform
-- intake pipeline.
--
-- WHY THIS EXISTS
-- ───────────────
-- The Jotform intake captures prospects who fill out the public form
-- on mottafinancial.com themselves. But the firm regularly meets
-- prospects out in the world — at conferences, referrals, networking
-- events, or by text — where the prospect would never fill out the
-- form themselves. The teammate has the details in their head, in a
-- screenshot, or scribbled on a note.
--
-- This table is the structured drop-zone for those situations. It
-- mirrors the shape of `jotform_intake_submissions` so the same
-- Karbon-work-item action, contact-matching heuristics, and detail
-- UI can be reused, with three semantic differences:
--
--   1. There is no Jotform submission backing the row — the form is
--      filled out inside Motta Hub by a teammate (created_by_id).
--   2. The "prospect notes" come from the teammate (internal_notes)
--      instead of the prospect themselves; the prospect-authored
--      `questions_or_concerns` field is absent on purpose.
--   3. Teammates can attach screenshots / PDFs (text-message proof
--      of a referral, business cards, prior correspondence) via the
--      `attachments` JSONB column.
--
-- All columns whose names match `jotform_intake_submissions` keep
-- identical types so we can reuse mappers / API helpers (e.g.
-- `lib/karbon/post-intake-note.ts`, `lib/jotform/match-client.ts`).

CREATE TABLE IF NOT EXISTS public.prospect_submissions (
  -- ── Identity ────────────────────────────────────────────────────
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The teammate who filled this form out inside the Hub. Required —
  -- a prospect submission with no author makes no sense and would
  -- break the "who do we owe a follow-up to?" reporting.
  created_by_id                     UUID NOT NULL REFERENCES public.team_members (id) ON DELETE RESTRICT,

  -- ── Where/when the teammate met the prospect ────────────────────
  -- Free-text "Met at AICPA Engage 06/10 — referred by Jane Doe".
  -- Surfaced in the Karbon timeline note as the cover paragraph so
  -- a partner reading the contact later understands the provenance.
  meeting_context                   TEXT,

  -- ── Prospect personal info ──────────────────────────────────────
  -- Same column names + types as jotform_intake_submissions so
  -- shared code (Karbon note builder, intake matcher) just works.
  submitter_first_name              TEXT,
  submitter_last_name               TEXT,
  submitter_full_name               TEXT,
  submitter_email                   TEXT,
  submitter_phone                   TEXT,
  submitter_city                    TEXT,
  submitter_state                   TEXT,
  submitter_zip                     TEXT,
  submitter_address                 JSONB,

  -- ── Services & business shape ───────────────────────────────────
  services_requested                TEXT[],
  service_focus                     TEXT,            -- "Personal Only" / "Business Only" / "Both Personal & Business"
  entity_types                      TEXT[],
  business_situation                TEXT,
  business_name                     TEXT,
  business_email                    TEXT,
  business_phone                    TEXT,
  business_state                    TEXT,
  business_tax_classification       TEXT,
  business_summary                  TEXT,
  business_revenue_range            TEXT,
  business_employee_count           TEXT,
  business_uses_accounting_system   TEXT,
  business_address                  JSONB,

  -- ── Teammate-authored notes ─────────────────────────────────────
  -- The internal notes are the canonical content for this row —
  -- replaces the prospect-authored questions_or_concerns from the
  -- public intake form.
  internal_notes                    TEXT,

  -- ── Attachments ─────────────────────────────────────────────────
  -- JSONB array of `{url, pathname, name, content_type, size_bytes,
  -- uploaded_at, uploaded_by_id, uploaded_by_name}`. Stored as JSON
  -- rather than a child table because attachments are write-once,
  -- per-row, and never queried independently. The `pathname` field
  -- is what we hand to `get()` against the Vercel Blob private store.
  attachments                       JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ── Triage state ────────────────────────────────────────────────
  -- Matches the intake table 1:1 so we can reuse the lead_status
  -- enum and the IntakeDetailSheet badge logic verbatim.
  lead_status                       TEXT NOT NULL DEFAULT 'new',
  assigned_to_id                    UUID REFERENCES public.team_members (id) ON DELETE SET NULL,
  triage_notes                      TEXT,

  -- ── Linked client (auto-matcher + manual pin) ──────────────────
  -- Same shape and `link_method` enum as jotform_intake_submissions.
  contact_id                        UUID REFERENCES public.contacts (id) ON DELETE SET NULL,
  organization_id                   UUID REFERENCES public.organizations (id) ON DELETE SET NULL,
  link_method                       TEXT,          -- 'auto_email' | 'auto_business_name' | 'auto_karbon_match' | 'auto_karbon_created' | 'manual'
  linked_at                         TIMESTAMPTZ,

  -- ── Karbon work-item action result ──────────────────────────────
  -- Identical to the four columns added to jotform_intake_submissions
  -- in migration 050. The Karbon work-item action route checks
  -- karbon_work_item_key for idempotency.
  karbon_work_item_key              TEXT,
  karbon_work_item_title            TEXT,
  karbon_work_item_url              TEXT,
  karbon_work_item_created_at       TIMESTAMPTZ,

  -- ── Timestamps ──────────────────────────────────────────────────
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prospect_submissions_created_by_id
  ON public.prospect_submissions (created_by_id);

CREATE INDEX IF NOT EXISTS idx_prospect_submissions_created_at_desc
  ON public.prospect_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prospect_submissions_contact_id
  ON public.prospect_submissions (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_submissions_organization_id
  ON public.prospect_submissions (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_submissions_lead_status
  ON public.prospect_submissions (lead_status);

CREATE INDEX IF NOT EXISTS idx_prospect_submissions_karbon_work_item_key
  ON public.prospect_submissions (karbon_work_item_key)
  WHERE karbon_work_item_key IS NOT NULL;

-- Match-method enum check — same values as jotform_intake_submissions.
-- Guarded with DO block so re-runs don't error.
DO $$ BEGIN
  ALTER TABLE public.prospect_submissions
    ADD CONSTRAINT prospect_submissions_link_method_check
    CHECK (
      link_method IS NULL
      OR link_method IN (
        'auto_email',
        'auto_business_name',
        'auto_name',
        'auto_karbon_match',
        'auto_karbon_created',
        'manual'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Lead-status enum check — same values as jotform_intake_submissions.
DO $$ BEGIN
  ALTER TABLE public.prospect_submissions
    ADD CONSTRAINT prospect_submissions_lead_status_check
    CHECK (lead_status IN ('new', 'contacted', 'qualified', 'converted', 'declined'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── updated_at trigger ─────────────────────────────────────────────
-- Reuses the project's `set_updated_at()` function if it exists;
-- defines its own scoped function as fallback so this migration is
-- self-contained.
CREATE OR REPLACE FUNCTION public.prospect_submissions_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prospect_submissions_updated_at ON public.prospect_submissions;
CREATE TRIGGER prospect_submissions_updated_at
  BEFORE UPDATE ON public.prospect_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.prospect_submissions_set_updated_at();

-- ── Row Level Security ─────────────────────────────────────────────
-- Permissive RLS to match the rest of the firm-internal tables
-- (e.g. jotform_intake_submissions has the same "Allow all" policy).
-- Authentication is handled at the application layer.
ALTER TABLE public.prospect_submissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow all on prospect_submissions" ON public.prospect_submissions
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Doc comments ───────────────────────────────────────────────────
COMMENT ON TABLE public.prospect_submissions IS
  'Internal "Prospect Form" — teammates fill this out for prospects met out in the world (conferences, referrals, text-message intros) where the prospect would never fill out the public Jotform intake themselves. Mirrors jotform_intake_submissions shape so the same Karbon work-item action and contact-matching logic can be reused.';

COMMENT ON COLUMN public.prospect_submissions.created_by_id IS
  'Team member who filled out this form inside the Hub. Required — the row owner for follow-up and reporting.';

COMMENT ON COLUMN public.prospect_submissions.meeting_context IS
  'Free-text description of where/when the teammate met the prospect. Surfaced as the cover paragraph in the Karbon timeline note.';

COMMENT ON COLUMN public.prospect_submissions.internal_notes IS
  'Teammate-authored notes about the prospect (in lieu of the prospect-authored questions_or_concerns from the public intake form).';

COMMENT ON COLUMN public.prospect_submissions.attachments IS
  'JSONB array of attachment records uploaded to the Vercel Blob private store. Schema: { url, pathname, name, content_type, size_bytes, uploaded_at, uploaded_by_id, uploaded_by_name }.';

COMMENT ON COLUMN public.prospect_submissions.karbon_work_item_key IS
  'Karbon WorkItemKey returned by POST /v3/WorkItems when a teammate clicks "Create Karbon Work Item" on the prospect detail page. Acts as the idempotency guard for the action.';
