-- ─────────────────────────────────────────────────────────────────────────
-- Team Calendar additions: per-event tags (clients, work items, services)
-- and per-event comments.
--
-- The webhook auto-links matching contacts on creation by writing into
-- `calendly_event_clients` with link_source='auto'. The UI lets users tag
-- additional clients, work items, or services after the fact and leave
-- comments visible to the rest of the team. Everything cascades when the
-- underlying calendly_event row is deleted.
--
-- All statements are idempotent so this script can be run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Client tags. A single Calendly event can map to:
--    • exactly one Organization (contact_id is null), or
--    • exactly one Contact (organization_id is null)
--    so the table enforces "exactly one of the two FKs is set" via a
--    CHECK constraint.
CREATE TABLE IF NOT EXISTS public.calendly_event_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_event_id uuid NOT NULL REFERENCES public.calendly_events(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 'auto' = inferred from invitee email/name/phone match
  -- 'manual' = added by a teammate via the UI
  link_source text NOT NULL DEFAULT 'manual'
    CHECK (link_source IN ('auto', 'manual')),
  -- Surface the match strategy for diagnostics: 'email', 'name_phone',
  -- 'name', null for manual links.
  match_method text,
  created_by_team_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_client_target CHECK (
    (contact_id IS NOT NULL AND organization_id IS NULL) OR
    (contact_id IS NULL AND organization_id IS NOT NULL)
  )
);

-- A given event can only tag a given contact / organization once.
CREATE UNIQUE INDEX IF NOT EXISTS calendly_event_clients_unique_contact
  ON public.calendly_event_clients (calendly_event_id, contact_id)
  WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS calendly_event_clients_unique_org
  ON public.calendly_event_clients (calendly_event_id, organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendly_event_clients_event_idx
  ON public.calendly_event_clients (calendly_event_id);
CREATE INDEX IF NOT EXISTS calendly_event_clients_contact_idx
  ON public.calendly_event_clients (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendly_event_clients_org_idx
  ON public.calendly_event_clients (organization_id) WHERE organization_id IS NOT NULL;

-- 2. Work item tags.
CREATE TABLE IF NOT EXISTS public.calendly_event_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_event_id uuid NOT NULL REFERENCES public.calendly_events(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  created_by_team_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendly_event_work_items_unique
  ON public.calendly_event_work_items (calendly_event_id, work_item_id);
CREATE INDEX IF NOT EXISTS calendly_event_work_items_event_idx
  ON public.calendly_event_work_items (calendly_event_id);

-- 3. Service tags. The `services` table is the canonical Motta service
-- catalog already used by Sales/Ignition. When a service is later deleted,
-- the tag goes with it.
CREATE TABLE IF NOT EXISTS public.calendly_event_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_event_id uuid NOT NULL REFERENCES public.calendly_events(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_by_team_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendly_event_services_unique
  ON public.calendly_event_services (calendly_event_id, service_id);
CREATE INDEX IF NOT EXISTS calendly_event_services_event_idx
  ON public.calendly_event_services (calendly_event_id);

-- 4. Comments. We keep `author_name` denormalized so deleted team members
--    don't break historical comments — same pattern used by debrief_comments.
CREATE TABLE IF NOT EXISTS public.calendly_event_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_event_id uuid NOT NULL REFERENCES public.calendly_events(id) ON DELETE CASCADE,
  author_team_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  author_avatar_url text,
  content text NOT NULL,
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendly_event_comments_event_idx
  ON public.calendly_event_comments (calendly_event_id, created_at);

-- 5. Mirror RLS posture of the existing calendly_* tables: enabled but
--    with permissive policies (the API uses createAdminClient under
--    middleware-gated routes; no client-side direct access is expected).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'calendly_event_clients') THEN
    EXECUTE 'ALTER TABLE public.calendly_event_clients ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS calendly_event_clients_all ON public.calendly_event_clients';
    EXECUTE 'CREATE POLICY calendly_event_clients_all ON public.calendly_event_clients FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'calendly_event_work_items') THEN
    EXECUTE 'ALTER TABLE public.calendly_event_work_items ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS calendly_event_work_items_all ON public.calendly_event_work_items';
    EXECUTE 'CREATE POLICY calendly_event_work_items_all ON public.calendly_event_work_items FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'calendly_event_services') THEN
    EXECUTE 'ALTER TABLE public.calendly_event_services ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS calendly_event_services_all ON public.calendly_event_services';
    EXECUTE 'CREATE POLICY calendly_event_services_all ON public.calendly_event_services FOR ALL USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'calendly_event_comments') THEN
    EXECUTE 'ALTER TABLE public.calendly_event_comments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS calendly_event_comments_all ON public.calendly_event_comments';
    EXECUTE 'CREATE POLICY calendly_event_comments_all ON public.calendly_event_comments FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;
