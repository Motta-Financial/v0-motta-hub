-- 339_zoom_meeting_deals_projects.sql
--
-- Extends the Zoom meeting tagging model (migration 046) so a meeting OR
-- its recording can also be linked to:
--   zoom_meeting_deals     - the sales opportunity (deals, migration 337)
--   zoom_meeting_projects  - an engagement/project (projects)
--
-- These mirror `zoom_meeting_clients` / `zoom_meeting_work_items` exactly:
-- a uuid PK, a CASCADE FK to zoom_meetings(id), the standard tag-source
-- columns (link_source/match_method/confidence/alfred_reason/needs_review)
-- so the same SourcePill UI and ALFRED-triage write paths apply, plus a
-- unique index to prevent duplicate tags. Both are OPTIONAL tags (unlike
-- the required client + work-item) so we add no NOT-NULL policy pressure.
-- ---------------------------------------------------------------------

BEGIN;

-- ---------- zoom_meeting_deals ----------
CREATE TABLE IF NOT EXISTS public.zoom_meeting_deals (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zoom_meeting_id             uuid NOT NULL REFERENCES public.zoom_meetings(id) ON DELETE CASCADE,
  deal_id                     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  link_source                 text NOT NULL DEFAULT 'manual',  -- manual | auto | alfred | calendly_bridge
  match_method                text,
  confidence                  numeric,
  alfred_reason               text,
  needs_review                boolean NOT NULL DEFAULT false,
  created_by_team_member_id   uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS zoom_meeting_deals_unique
  ON public.zoom_meeting_deals (zoom_meeting_id, deal_id);
CREATE INDEX IF NOT EXISTS zoom_meeting_deals_meeting_idx
  ON public.zoom_meeting_deals (zoom_meeting_id);
CREATE INDEX IF NOT EXISTS zoom_meeting_deals_deal_idx
  ON public.zoom_meeting_deals (deal_id);

-- ---------- zoom_meeting_projects ----------
CREATE TABLE IF NOT EXISTS public.zoom_meeting_projects (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zoom_meeting_id             uuid NOT NULL REFERENCES public.zoom_meetings(id) ON DELETE CASCADE,
  project_id                  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  link_source                 text NOT NULL DEFAULT 'manual',
  match_method                text,
  confidence                  numeric,
  alfred_reason               text,
  needs_review                boolean NOT NULL DEFAULT false,
  created_by_team_member_id   uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS zoom_meeting_projects_unique
  ON public.zoom_meeting_projects (zoom_meeting_id, project_id);
CREATE INDEX IF NOT EXISTS zoom_meeting_projects_meeting_idx
  ON public.zoom_meeting_projects (zoom_meeting_id);
CREATE INDEX IF NOT EXISTS zoom_meeting_projects_project_idx
  ON public.zoom_meeting_projects (project_id);

-- ---------- RLS (same posture as zoom_meeting_clients) ----------
ALTER TABLE public.zoom_meeting_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoom_meeting_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zoom_meeting_deals_all ON public.zoom_meeting_deals;
CREATE POLICY zoom_meeting_deals_all
  ON public.zoom_meeting_deals
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS zoom_meeting_projects_all ON public.zoom_meeting_projects;
CREATE POLICY zoom_meeting_projects_all
  ON public.zoom_meeting_projects
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
