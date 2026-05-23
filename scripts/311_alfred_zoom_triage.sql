-- ─────────────────────────────────────────────────────────────────────────
-- Zoom triage schema: ALFRED + Calendly→Zoom bridge
--
-- Mirrors the Calendly triage schema (scripts/310) on the Zoom side so
-- the existing Master Hub Contact tagging UX gets the same automation
-- coverage. Three additions:
--
--   1. link_source/confidence/alfred_reason/needs_review on the two
--      Zoom tag tables (clients + work_items). Adds two new sources:
--        - 'alfred'           — model-tagged from runAlfredZoomTriage
--        - 'calendly_bridge'  — copied verbatim from a matching
--                               calendly_event (deterministic, exact
--                               join_url match — no model involved).
--
--   2. zoom_meetings.calendly_event_id — the bridge FK. Populated by
--      bridgeZoomToCalendly() during the recent-meeting sync, by exact
--      match on the conference join URL.
--
--   3. zoom_alfred_triage_log — append-only audit table, same shape as
--      calendly_alfred_triage_log, so ops can debug bad picks.
--
-- All statements are idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. zoom_meeting_clients: add provenance columns + extended source enum.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.zoom_meeting_clients'::regclass
      AND conname IN (
        'zoom_meeting_clients_link_source_check',
        'zoom_meeting_clients_check'
      )
  ) THEN
    EXECUTE 'ALTER TABLE public.zoom_meeting_clients '
         || 'DROP CONSTRAINT IF EXISTS zoom_meeting_clients_link_source_check';
    EXECUTE 'ALTER TABLE public.zoom_meeting_clients '
         || 'DROP CONSTRAINT IF EXISTS zoom_meeting_clients_check';
  END IF;
END $$;

ALTER TABLE public.zoom_meeting_clients
  ADD CONSTRAINT zoom_meeting_clients_link_source_check
  CHECK (link_source IN ('auto', 'manual', 'alfred', 'calendly_bridge'));

ALTER TABLE public.zoom_meeting_clients
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS alfred_reason text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS zoom_meeting_clients_needs_review_idx
  ON public.zoom_meeting_clients (zoom_meeting_id)
  WHERE needs_review;

-- 2. zoom_meeting_work_items: this table predates the link_source
--    pattern entirely (every row is implicitly 'manual'). Backfill the
--    column with a default of 'manual' so existing rows keep their
--    semantics, then add the same provenance columns as above.
ALTER TABLE public.zoom_meeting_work_items
  ADD COLUMN IF NOT EXISTS link_source text NOT NULL DEFAULT 'manual'
    CHECK (link_source IN ('auto', 'manual', 'alfred', 'calendly_bridge')),
  ADD COLUMN IF NOT EXISTS match_method text,
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS alfred_reason text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS zoom_meeting_work_items_needs_review_idx
  ON public.zoom_meeting_work_items (zoom_meeting_id)
  WHERE needs_review;

-- 3. Calendly→Zoom bridge column. We don't make this a hard FK with
--    ON DELETE CASCADE — Calendly events come and go (cancellations,
--    re-syncs) and we want to retain the Zoom row regardless. SET NULL
--    is the right semantics for the rare delete.
ALTER TABLE public.zoom_meetings
  ADD COLUMN IF NOT EXISTS calendly_event_id uuid
    REFERENCES public.calendly_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calendly_bridge_at timestamptz,
  ADD COLUMN IF NOT EXISTS alfred_triage_at timestamptz;

CREATE INDEX IF NOT EXISTS zoom_meetings_calendly_event_idx
  ON public.zoom_meetings (calendly_event_id)
  WHERE calendly_event_id IS NOT NULL;

-- 4. ALFRED Zoom triage audit log. Same columns as
--    calendly_alfred_triage_log so ops can write generic dashboards
--    that union the two sources together.
CREATE TABLE IF NOT EXISTS public.zoom_alfred_triage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zoom_meeting_id uuid REFERENCES public.zoom_meetings(id) ON DELETE CASCADE,

  -- Inputs ALFRED saw — denormalised so the log is self-describing.
  topic text,
  agenda text,
  start_time timestamptz,
  host_email text,
  participant_emails text[],
  participant_names text[],
  bridged_from_calendly_event_id uuid REFERENCES public.calendly_events(id) ON DELETE SET NULL,

  -- Decision
  outcome text NOT NULL CHECK (outcome IN (
    'tagged',           -- ≥ auto_accept threshold; tag(s) inserted
    'tagged_review',    -- below threshold but ≥ review_floor; tagged + needs_review
    'no_match',         -- ALFRED returned nothing high-confidence
    'skipped_existing', -- the meeting already had confident tags
    'skipped_bridged',  -- carried over from Calendly; no need for ALFRED
    'error'
  )),
  resolved_contact_ids uuid[] NOT NULL DEFAULT '{}',
  resolved_organization_ids uuid[] NOT NULL DEFAULT '{}',
  resolved_work_item_ids uuid[] NOT NULL DEFAULT '{}',
  confidence numeric(3,2),
  reason text,
  candidates_considered jsonb,
  raw_model_output jsonb,
  model_id text,
  prompt_tokens int,
  completion_tokens int,
  duration_ms int,

  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zoom_alfred_triage_log_meeting_idx
  ON public.zoom_alfred_triage_log (zoom_meeting_id);
CREATE INDEX IF NOT EXISTS zoom_alfred_triage_log_outcome_idx
  ON public.zoom_alfred_triage_log (outcome, created_at DESC);

-- Mirror the permissive RLS posture of the surrounding zoom_* tables.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.zoom_alfred_triage_log ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS zoom_alfred_triage_log_all '
       || 'ON public.zoom_alfred_triage_log';
  EXECUTE 'CREATE POLICY zoom_alfred_triage_log_all '
       || 'ON public.zoom_alfred_triage_log FOR ALL USING (true) WITH CHECK (true)';
END $$;
