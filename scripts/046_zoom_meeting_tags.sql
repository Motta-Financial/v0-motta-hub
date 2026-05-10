-- 046_zoom_meeting_tags.sql
--
-- Adds two junction tables that let Motta team members tag every Zoom
-- meeting with (a) one or more applicable clients and (b) one or more
-- Karbon work items. Mirrors the existing Calendly tagging model
-- (`calendly_event_clients` / `calendly_event_work_items`) so the same
-- query/UI patterns apply on both sides.
--
--   zoom_meeting_clients     - many clients per meeting
--                              exactly one of contact_id / organization_id
--                              is non-null per row
--   zoom_meeting_work_items  - many Karbon work items per meeting
--
-- Tagging is required by policy (the Hub surfaces an "Untagged" badge
-- and prompts in the UI), but enforced softly at the DB layer so legacy
-- rows aren't broken. Uniqueness constraints prevent duplicate tags.
-- ---------------------------------------------------------------------

BEGIN;

-- ---------- zoom_meeting_clients ----------
CREATE TABLE IF NOT EXISTS public.zoom_meeting_clients (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zoom_meeting_id             uuid NOT NULL REFERENCES public.zoom_meetings(id) ON DELETE CASCADE,
  contact_id                  uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id             uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  link_source                 text NOT NULL DEFAULT 'manual',  -- manual | auto
  match_method                text,                            -- email | name | invitee | etc.
  created_by_team_member_id   uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  -- Exactly one of contact_id / organization_id must be set, mirroring
  -- the calendly_event_clients constraint and the unified-clients model.
  CONSTRAINT zoom_meeting_clients_one_target CHECK (
    (contact_id IS NOT NULL AND organization_id IS NULL)
    OR (contact_id IS NULL AND organization_id IS NOT NULL)
  )
);

-- Prevent the same contact/org from being tagged twice on the same meeting.
CREATE UNIQUE INDEX IF NOT EXISTS zoom_meeting_clients_unique_contact
  ON public.zoom_meeting_clients (zoom_meeting_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS zoom_meeting_clients_unique_org
  ON public.zoom_meeting_clients (zoom_meeting_id, organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS zoom_meeting_clients_meeting_idx
  ON public.zoom_meeting_clients (zoom_meeting_id);
CREATE INDEX IF NOT EXISTS zoom_meeting_clients_contact_idx
  ON public.zoom_meeting_clients (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS zoom_meeting_clients_org_idx
  ON public.zoom_meeting_clients (organization_id) WHERE organization_id IS NOT NULL;

-- ---------- zoom_meeting_work_items ----------
CREATE TABLE IF NOT EXISTS public.zoom_meeting_work_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zoom_meeting_id             uuid NOT NULL REFERENCES public.zoom_meetings(id) ON DELETE CASCADE,
  work_item_id                uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  created_by_team_member_id   uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS zoom_meeting_work_items_unique
  ON public.zoom_meeting_work_items (zoom_meeting_id, work_item_id);

CREATE INDEX IF NOT EXISTS zoom_meeting_work_items_meeting_idx
  ON public.zoom_meeting_work_items (zoom_meeting_id);
CREATE INDEX IF NOT EXISTS zoom_meeting_work_items_work_item_idx
  ON public.zoom_meeting_work_items (work_item_id);

-- ---------- RLS ----------
-- Same posture as the calendly equivalents: open to authenticated users
-- (the Hub gates access at the route layer via the team_members table).
ALTER TABLE public.zoom_meeting_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoom_meeting_work_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zoom_meeting_clients_all ON public.zoom_meeting_clients;
CREATE POLICY zoom_meeting_clients_all
  ON public.zoom_meeting_clients
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS zoom_meeting_work_items_all ON public.zoom_meeting_work_items;
CREATE POLICY zoom_meeting_work_items_all
  ON public.zoom_meeting_work_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------- Convenience view: meetings with tag counts ----------
-- Used by the Zoom dashboard to show "Untagged" badges and aggregate
-- "X meetings need tagging" counts without an extra round-trip.
CREATE OR REPLACE VIEW public.zoom_meetings_with_tag_counts AS
SELECT
  m.*,
  COALESCE(c.client_count, 0)      AS client_tag_count,
  COALESCE(w.work_item_count, 0)   AS work_item_tag_count,
  (COALESCE(c.client_count, 0) = 0 OR COALESCE(w.work_item_count, 0) = 0)
                                   AS needs_tagging
FROM public.zoom_meetings m
LEFT JOIN (
  SELECT zoom_meeting_id, COUNT(*) AS client_count
  FROM public.zoom_meeting_clients
  GROUP BY zoom_meeting_id
) c ON c.zoom_meeting_id = m.id
LEFT JOIN (
  SELECT zoom_meeting_id, COUNT(*) AS work_item_count
  FROM public.zoom_meeting_work_items
  GROUP BY zoom_meeting_id
) w ON w.zoom_meeting_id = m.id;

COMMIT;
