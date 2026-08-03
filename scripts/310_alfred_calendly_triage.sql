-- ─────────────────────────────────────────────────────────────────────────
-- ALFRED Calendly triage schema
--
-- Adds the columns + log table used by lib/alfred/calendly-triage.ts.
-- Every Calendly invitee.created webhook now produces:
--   1. The existing deterministic match (email → name+phone → name)
--   2. An ALFRED pass that can additionally tag organization, work_item,
--      and service — and supplements the contact match when the
--      deterministic matcher abstained or only had a weak signal.
--
-- Tag rows produced by ALFRED are stored in the same three tables as
-- manual/auto tags so the existing /api/calendly/team-calendar route
-- and the Team Calendar UI render them with no query changes. We mark
-- them with `link_source = 'alfred'` plus `confidence` (0..1) and
-- `needs_review` (true when confidence < 0.85). The UI shows a yellow
-- "review" chip for needs_review tags so a teammate can confirm or
-- replace ALFRED's guess with one click.
--
-- Triage runs are also persisted (regardless of outcome) into
-- `calendly_alfred_triage_log` for ops debugging — the model's full
-- reasoning, confidence, and the candidates it considered. This is a
-- write-only audit table; the Hub never reads from it at request time.
--
-- All statements are idempotent. Safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Allow 'alfred' as a third link_source. The existing CHECK is
--    `link_source IN ('auto', 'manual')` — recreate it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.calendly_event_clients'::regclass
      AND conname IN (
        'calendly_event_clients_link_source_check',
        'calendly_event_clients_check'
      )
  ) THEN
    EXECUTE 'ALTER TABLE public.calendly_event_clients '
         || 'DROP CONSTRAINT IF EXISTS calendly_event_clients_link_source_check';
    EXECUTE 'ALTER TABLE public.calendly_event_clients '
         || 'DROP CONSTRAINT IF EXISTS calendly_event_clients_check';
  END IF;
END $$;

ALTER TABLE public.calendly_event_clients
  ADD CONSTRAINT calendly_event_clients_link_source_check
  CHECK (link_source IN ('auto', 'manual', 'alfred'));

-- 2. Add provenance columns shared across the three tag tables.
--    `confidence`     – ALFRED's self-reported probability (0..1).
--                       Null for auto/manual tags.
--    `alfred_reason`  – Short human-readable explanation of why ALFRED
--                       picked this tag. Surfaced on hover in the UI.
--    `needs_review`   – True when ALFRED's confidence is below the
--                       auto-accept threshold. The Team Calendar uses
--                       this to render a yellow chip + filter.
ALTER TABLE public.calendly_event_clients
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS alfred_reason text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.calendly_event_work_items
  ADD COLUMN IF NOT EXISTS link_source text NOT NULL DEFAULT 'manual'
    CHECK (link_source IN ('auto', 'manual', 'alfred')),
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS alfred_reason text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.calendly_event_services
  ADD COLUMN IF NOT EXISTS link_source text NOT NULL DEFAULT 'manual'
    CHECK (link_source IN ('auto', 'manual', 'alfred')),
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS alfred_reason text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

-- Helpful filter index for the Team Calendar "needs review" view.
CREATE INDEX IF NOT EXISTS calendly_event_clients_needs_review_idx
  ON public.calendly_event_clients (calendly_event_id)
  WHERE needs_review;

-- 3. Append-only triage log. One row per Calendly invitee.created
--    webhook (and per re-run if the script is invoked manually). Stores
--    the inputs ALFRED saw, the candidates it considered, the final
--    decision, model usage, and any errors.
CREATE TABLE IF NOT EXISTS public.calendly_alfred_triage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_event_id uuid REFERENCES public.calendly_events(id) ON DELETE CASCADE,
  calendly_invitee_uuid text,                 -- Calendly invitee uuid (for cross-ref when event row is missing)

  -- Inputs ALFRED saw — denormalised so the log is self-describing.
  invitee_name text,
  invitee_email text,
  invitee_phone text,
  questions_and_answers jsonb,
  event_name text,

  -- Decision
  outcome text NOT NULL CHECK (outcome IN (
    'tagged',           -- ≥ auto_accept threshold; tag(s) inserted
    'tagged_review',    -- below threshold but ≥ review_floor; tagged + needs_review
    'no_match',         -- ALFRED returned nothing high-confidence
    'skipped_existing', -- a stronger tag already existed; ALFRED no-op'd
    'error'             -- model/db error — see error_message
  )),
  resolved_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  resolved_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  resolved_work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL,
  resolved_service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  confidence numeric(3,2),
  reason text,
  candidates_considered jsonb,                -- the shortlist ALFRED chose from
  raw_model_output jsonb,
  model_id text,
  prompt_tokens int,
  completion_tokens int,
  duration_ms int,

  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendly_alfred_triage_log_event_idx
  ON public.calendly_alfred_triage_log (calendly_event_id);
CREATE INDEX IF NOT EXISTS calendly_alfred_triage_log_outcome_idx
  ON public.calendly_alfred_triage_log (outcome, created_at DESC);

-- Mirror the permissive RLS posture of the surrounding calendly_* tables.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.calendly_alfred_triage_log ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS calendly_alfred_triage_log_all '
       || 'ON public.calendly_alfred_triage_log';
  EXECUTE 'CREATE POLICY calendly_alfred_triage_log_all '
       || 'ON public.calendly_alfred_triage_log FOR ALL USING (true) WITH CHECK (true)';
END $$;
