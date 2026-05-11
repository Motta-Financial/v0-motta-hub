-- =============================================================================
-- Ignition Reporting API — new tables for resources that don't have a home yet.
--
-- Already-existing tables we'll UPSERT into from the sync layer:
--   ignition_clients, ignition_proposals, ignition_proposal_services,
--   ignition_invoices, ignition_payments, ignition_disbursals,
--   ignition_services.
--
-- The three resources below have no homes yet:
--   - /reporting/contacts     -> ignition_contacts
--   - /reporting/deal_stages  -> ignition_deal_stages
--   - /reporting/deals        -> ignition_deals
--
-- All three follow the same pattern as the other ignition_* tables:
--   * "ignition_<entity>_id" text column = the natural key from Ignition; unique
--   * full API row stashed into raw_payload jsonb (so a wrong field mapping is
--     recoverable without re-fetching from Ignition's rate-limited API)
--   * client/contact/org FK links left nullable so the matcher job can fill
--     them in later — backfill is allowed to leave them null
--   * RLS enabled, authenticated-read + service-role-managed policies,
--     matching the conventions of the existing ignition_* tables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ignition_contacts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ignition_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ignition_contact_id TEXT NOT NULL UNIQUE,
  ignition_client_id TEXT,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  -- Local matching: a contact-row in our system that this Ignition contact maps
  -- to. Populated later by the same matcher logic that handles ignition_clients.
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  match_status TEXT,
  match_method TEXT,
  match_confidence NUMERIC,
  match_notes TEXT,
  raw_payload JSONB,
  ignition_created_at TIMESTAMPTZ,
  ignition_updated_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ignition_contacts_client_id_idx
  ON public.ignition_contacts (ignition_client_id);
CREATE INDEX IF NOT EXISTS ignition_contacts_email_idx
  ON public.ignition_contacts (LOWER(email));
CREATE INDEX IF NOT EXISTS ignition_contacts_contact_fk_idx
  ON public.ignition_contacts (contact_id);

ALTER TABLE public.ignition_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ignition_contacts_select ON public.ignition_contacts;
CREATE POLICY ignition_contacts_select ON public.ignition_contacts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ignition_contacts_service_write ON public.ignition_contacts;
CREATE POLICY ignition_contacts_service_write ON public.ignition_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- -----------------------------------------------------------------------------
-- ignition_deal_stages
-- -----------------------------------------------------------------------------
-- Small dimension table; one row per stage in the practice's deal pipeline.
-- Used to enrich ignition_deals.stage_name and to power charting by pipeline
-- column in admin/analytics views.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ignition_deal_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ignition_stage_id TEXT NOT NULL UNIQUE,
  name TEXT,
  pipeline_name TEXT,
  -- Ignition typically marks won/lost stages explicitly. We mirror those flags
  -- so charting code doesn't have to interpret stage name strings.
  is_active BOOLEAN,
  is_won BOOLEAN,
  is_lost BOOLEAN,
  sort_order INTEGER,
  raw_payload JSONB,
  ignition_created_at TIMESTAMPTZ,
  ignition_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ignition_deal_stages_pipeline_idx
  ON public.ignition_deal_stages (pipeline_name, sort_order);

ALTER TABLE public.ignition_deal_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ignition_deal_stages_select ON public.ignition_deal_stages;
CREATE POLICY ignition_deal_stages_select ON public.ignition_deal_stages
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ignition_deal_stages_service_write ON public.ignition_deal_stages;
CREATE POLICY ignition_deal_stages_service_write ON public.ignition_deal_stages
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- -----------------------------------------------------------------------------
-- ignition_deals
-- -----------------------------------------------------------------------------
-- Sales pipeline rows. Distinct from proposals — a deal sits upstream and a
-- proposal is what gets sent once a deal moves to the "ready to propose"
-- stage. Closed deals can be either won (became a proposal) or lost.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ignition_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ignition_deal_id TEXT NOT NULL UNIQUE,
  ignition_client_id TEXT,
  ignition_stage_id TEXT,
  -- Denormalized stage_name + pipeline_name so we can list deals without
  -- joining to ignition_deal_stages on every query. The matcher / sync layer
  -- backfills these from the stage table when it has the data, but treat
  -- ignition_stage_id as the source of truth.
  pipeline_name TEXT,
  stage_name TEXT,
  title TEXT,
  status TEXT,
  owner_name TEXT,
  owner_email TEXT,
  value NUMERIC,
  currency TEXT,
  expected_close_date DATE,
  closed_at TIMESTAMPTZ,
  -- Local matching, mirroring ignition_proposals:
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  raw_payload JSONB,
  ignition_created_at TIMESTAMPTZ,
  ignition_updated_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ignition_deals_client_id_idx
  ON public.ignition_deals (ignition_client_id);
CREATE INDEX IF NOT EXISTS ignition_deals_stage_id_idx
  ON public.ignition_deals (ignition_stage_id);
CREATE INDEX IF NOT EXISTS ignition_deals_status_idx
  ON public.ignition_deals (status);
CREATE INDEX IF NOT EXISTS ignition_deals_contact_fk_idx
  ON public.ignition_deals (contact_id);
CREATE INDEX IF NOT EXISTS ignition_deals_organization_fk_idx
  ON public.ignition_deals (organization_id);

ALTER TABLE public.ignition_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ignition_deals_select ON public.ignition_deals;
CREATE POLICY ignition_deals_select ON public.ignition_deals
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ignition_deals_service_write ON public.ignition_deals;
CREATE POLICY ignition_deals_service_write ON public.ignition_deals
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
-- Reuse the existing public.set_updated_at() trigger function if it exists
-- (the other tables in this schema already use it). If not, fall back to an
-- inline assignment trigger so the migration is self-contained.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at_for_ignition_reporting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ignition_contacts_updated_at ON public.ignition_contacts;
CREATE TRIGGER trg_ignition_contacts_updated_at
  BEFORE UPDATE ON public.ignition_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_for_ignition_reporting();

DROP TRIGGER IF EXISTS trg_ignition_deal_stages_updated_at ON public.ignition_deal_stages;
CREATE TRIGGER trg_ignition_deal_stages_updated_at
  BEFORE UPDATE ON public.ignition_deal_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_for_ignition_reporting();

DROP TRIGGER IF EXISTS trg_ignition_deals_updated_at ON public.ignition_deals;
CREATE TRIGGER trg_ignition_deals_updated_at
  BEFORE UPDATE ON public.ignition_deals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_for_ignition_reporting();
