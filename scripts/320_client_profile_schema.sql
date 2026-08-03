-- =============================================================================
-- Client Profile Schema (Hub-master mirror of tax_profile_summaries)
--
-- Purpose: give ALFRED and the UI a single denormalized snapshot per Hub
-- master client (contacts.id OR organizations.id) covering identity, open
-- work, debrief activity, fees/invoices, communications, and an AI-ready
-- summary. Keyed by (client_id, client_kind) since the Hub master record
-- is whichever of `contacts` / `organizations` is canonical for that client.
--
-- Intentionally additive — no changes to contacts / organizations / work_items.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Summary table
CREATE TABLE IF NOT EXISTS client_profile_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Hub master identity (contacts.id or organizations.id)
  client_id UUID NOT NULL,
  client_kind TEXT NOT NULL CHECK (client_kind IN ('contact', 'organization')),

  -- Identity snapshot (frozen here so /context doesn't re-join on every read)
  display_name TEXT,
  client_type TEXT,                 -- "PERSON" | "ORGANIZATION" | "PROSPECT" | etc.
  primary_email TEXT,
  phone_primary TEXT,
  city TEXT,
  state TEXT,
  status TEXT,                      -- e.g. "active" | "inactive" | "prospect"
  is_prospect BOOLEAN DEFAULT FALSE,

  -- Cross-system identifiers (denormalized for fast lookup)
  legacy_motta_client_id TEXT,
  karbon_contact_key TEXT,
  karbon_organization_key TEXT,
  ignition_client_id TEXT,
  proconnect_client_id TEXT,
  user_defined_identifier TEXT,

  -- Owners
  client_owner_id UUID,
  client_owner_name TEXT,
  client_manager_id UUID,
  client_manager_name TEXT,

  -- Work items
  total_work_items INTEGER DEFAULT 0,
  open_work_items INTEGER DEFAULT 0,
  completed_work_items INTEGER DEFAULT 0,
  overdue_work_items INTEGER DEFAULT 0,
  next_due_date DATE,
  next_due_work_item_title TEXT,
  next_due_work_item_id UUID,
  active_work_types TEXT[] DEFAULT '{}',

  -- Debriefs
  total_debriefs INTEGER DEFAULT 0,
  last_debrief_date DATE,
  last_debrief_type TEXT,
  last_debrief_notes TEXT,
  last_debrief_id UUID,
  open_action_items INTEGER DEFAULT 0,

  -- Communications
  total_calendly_events INTEGER DEFAULT 0,
  total_zoom_meetings INTEGER DEFAULT 0,
  last_meeting_at TIMESTAMPTZ,
  next_meeting_at TIMESTAMPTZ,

  -- Financial: proposals (Ignition)
  total_proposals INTEGER DEFAULT 0,
  active_proposals INTEGER DEFAULT 0,
  proposals_total_value NUMERIC(15,2) DEFAULT 0,
  proposals_recurring_total NUMERIC(15,2) DEFAULT 0,
  recurring_frequency TEXT,

  -- Financial: invoices (Karbon + Ignition unified)
  total_invoices INTEGER DEFAULT 0,
  invoices_total NUMERIC(15,2) DEFAULT 0,
  invoices_paid NUMERIC(15,2) DEFAULT 0,
  invoices_outstanding NUMERIC(15,2) DEFAULT 0,
  last_invoice_date DATE,
  last_payment_date DATE,

  -- Lifetime
  lifetime_revenue NUMERIC(15,2) DEFAULT 0,

  -- Tags / categorization
  tags TEXT[] DEFAULT '{}',

  -- AI / ALFRED context
  ai_summary TEXT,
  ai_keywords TEXT[] DEFAULT '{}',

  -- Quality / attention
  profile_completeness INTEGER DEFAULT 0,
  needs_attention BOOLEAN DEFAULT FALSE,
  attention_reasons TEXT[] DEFAULT '{}',

  -- Search-optimized fields
  search_name TEXT GENERATED ALWAYS AS (LOWER(COALESCE(display_name, ''))) STORED,
  search_email TEXT GENERATED ALWAYS AS (LOWER(COALESCE(primary_email, ''))) STORED,

  -- Stamps
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale_at TIMESTAMPTZ,                       -- non-null = needs recompute on next read
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, client_kind)
);

CREATE INDEX IF NOT EXISTS idx_cps_client          ON client_profile_summaries (client_id, client_kind);
CREATE INDEX IF NOT EXISTS idx_cps_search_name     ON client_profile_summaries USING gin (search_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cps_search_email    ON client_profile_summaries (search_email);
CREATE INDEX IF NOT EXISTS idx_cps_legacy          ON client_profile_summaries (legacy_motta_client_id) WHERE legacy_motta_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cps_karbon_contact  ON client_profile_summaries (karbon_contact_key)     WHERE karbon_contact_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cps_karbon_org      ON client_profile_summaries (karbon_organization_key) WHERE karbon_organization_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cps_attention       ON client_profile_summaries (needs_attention)        WHERE needs_attention = TRUE;
CREATE INDEX IF NOT EXISTS idx_cps_stale           ON client_profile_summaries (stale_at)               WHERE stale_at IS NOT NULL;

-- 2. updated_at trigger
CREATE OR REPLACE FUNCTION update_client_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS client_profile_summaries_updated ON client_profile_summaries;
CREATE TRIGGER client_profile_summaries_updated
  BEFORE UPDATE ON client_profile_summaries
  FOR EACH ROW EXECUTE FUNCTION update_client_profile_timestamp();

-- 3. Convenience view that joins clients_unified to its profile summary
CREATE OR REPLACE VIEW clients_with_profile AS
SELECT
  cu.id              AS client_id,
  cu.client_type     AS clients_unified_type,
  cu.name,
  cu.primary_email,
  cu.phone,
  cu.city,
  cu.state,
  cu.status,
  cu.client_owner_key,
  cu.client_manager_key,
  cu.avatar_url,
  cu.karbon_url,
  cu.last_synced_at,
  cps.client_kind,
  cps.display_name,
  cps.client_type AS profile_client_type,
  cps.is_prospect,
  cps.legacy_motta_client_id,
  cps.karbon_contact_key,
  cps.karbon_organization_key,
  cps.ignition_client_id,
  cps.proconnect_client_id,
  cps.user_defined_identifier,
  cps.client_owner_id,
  cps.client_owner_name,
  cps.client_manager_id,
  cps.client_manager_name,
  cps.total_work_items,
  cps.open_work_items,
  cps.completed_work_items,
  cps.overdue_work_items,
  cps.next_due_date,
  cps.next_due_work_item_title,
  cps.next_due_work_item_id,
  cps.active_work_types,
  cps.total_debriefs,
  cps.last_debrief_date,
  cps.last_debrief_type,
  cps.last_debrief_notes,
  cps.last_debrief_id,
  cps.open_action_items,
  cps.total_calendly_events,
  cps.total_zoom_meetings,
  cps.last_meeting_at,
  cps.next_meeting_at,
  cps.total_proposals,
  cps.active_proposals,
  cps.proposals_total_value,
  cps.proposals_recurring_total,
  cps.recurring_frequency,
  cps.total_invoices,
  cps.invoices_total,
  cps.invoices_paid,
  cps.invoices_outstanding,
  cps.last_invoice_date,
  cps.last_payment_date,
  cps.lifetime_revenue,
  cps.tags,
  cps.ai_summary,
  cps.ai_keywords,
  cps.profile_completeness,
  cps.needs_attention,
  cps.attention_reasons,
  cps.computed_at,
  cps.stale_at,
  cps.updated_at AS profile_updated_at
FROM clients_unified cu
LEFT JOIN client_profile_summaries cps
  ON cps.client_id = cu.id;
