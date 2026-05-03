-- =====================================================================
-- Ignition (ignitionapp.com) full sync schema
-- =====================================================================
-- Ignition has no public REST API; their only programmatic surface is
-- Zapier triggers. This migration creates the tables that the Zapier
-- webhook receivers (/api/ignition/webhook/[event]/route.ts) write into,
-- plus the matching helpers used to map Ignition clients onto Motta's
-- existing contacts / organizations populated from Karbon.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- 1. Webhook event log (append-only audit trail) ------------------------
-- Every payload Zapier delivers is recorded raw, regardless of whether
-- the routed handler succeeded. This is the source of truth when
-- something looks off in derived tables.
CREATE TABLE IF NOT EXISTS ignition_webhook_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type            TEXT NOT NULL,         -- e.g. 'proposal.accepted'
  ignition_resource_id  TEXT,                  -- proposal_id / client_id from payload
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at          TIMESTAMPTZ,
  processing_status     TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','success','failed','skipped')),
  processing_error      TEXT,
  zap_id                TEXT,                  -- Zapier-assigned ID for the Zap, optional
  source_ip             INET,
  raw_payload           JSONB NOT NULL,
  request_headers       JSONB
);

CREATE INDEX IF NOT EXISTS idx_ignition_webhook_events_received_at
  ON ignition_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ignition_webhook_events_event_type
  ON ignition_webhook_events (event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ignition_webhook_events_resource
  ON ignition_webhook_events (ignition_resource_id) WHERE ignition_resource_id IS NOT NULL;

COMMENT ON TABLE ignition_webhook_events IS
  'Append-only log of every Zapier webhook delivery from Ignition. Source of truth for replay/debug.';

-- 2. Ignition clients (one row per Ignition client record) -------------
-- This is the entity Ignition manages on its side. After insert, the
-- mapping engine attempts to link contact_id (individual) and/or
-- organization_id (business) by email + name match.
CREATE TABLE IF NOT EXISTS ignition_clients (
  ignition_client_id    TEXT PRIMARY KEY,
  name                  TEXT,
  email                 TEXT,
  phone                 TEXT,
  business_name         TEXT,                  -- when the Ignition client is a company
  client_type           TEXT,                  -- 'individual' | 'business' if Ignition tells us
  -- Address (Ignition exposes a single primary address)
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT,
  state                 TEXT,
  zip_code              TEXT,
  country               TEXT,
  -- Mapping to Motta's first-class entities
  contact_id            UUID REFERENCES contacts(id)        ON DELETE SET NULL,
  organization_id       UUID REFERENCES organizations(id)   ON DELETE SET NULL,
  match_status          TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched','auto_matched','manual_matched','manual_review','no_match')),
  match_confidence      NUMERIC(4,3),          -- 0.000 - 1.000
  match_method          TEXT,                  -- 'email_exact' | 'name_fuzzy' | 'manual'
  match_notes           TEXT,
  -- Ignition system metadata
  ignition_created_at   TIMESTAMPTZ,
  ignition_updated_at   TIMESTAMPTZ,
  archived_at           TIMESTAMPTZ,
  raw_payload           JSONB,
  -- Local sync metadata
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ignition_clients_email_lower
  ON ignition_clients (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_clients_contact_id
  ON ignition_clients (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_clients_organization_id
  ON ignition_clients (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_clients_match_status
  ON ignition_clients (match_status);

COMMENT ON TABLE ignition_clients IS
  'Ignition-side client records. Linked to Motta contacts/organizations via the mapping engine.';

-- 3. Service catalog (one row per distinct service Ignition has billed) -
-- Populated from the line items inside proposals; a service is shared
-- across many proposals so we de-duplicate it here.
CREATE TABLE IF NOT EXISTS ignition_services (
  ignition_service_id   TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT,
  category              TEXT,                  -- e.g. 'Tax', 'Bookkeeping'
  billing_type          TEXT,                  -- 'one_time' | 'recurring'
  default_price         NUMERIC(12,2),
  currency              TEXT,
  is_active             BOOLEAN DEFAULT TRUE,
  raw_payload           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ignition_services IS
  'Distinct services offered to clients via Ignition proposals (acts as a service catalog).';

-- 4. Proposals (extend existing 30-row table) --------------------------
-- The legacy table has only `proposal_id, title, status, client_name,
-- amount, currency, payload`. We add real first-class columns so SQL
-- queries don't have to dig through `raw_payload`.
ALTER TABLE ignition_proposals
  ADD COLUMN IF NOT EXISTS ignition_client_id      TEXT REFERENCES ignition_clients(ignition_client_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposal_number         TEXT,
  ADD COLUMN IF NOT EXISTS sent_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lost_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lost_reason             TEXT,
  ADD COLUMN IF NOT EXISTS archived_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effective_start_date    DATE,
  ADD COLUMN IF NOT EXISTS billing_starts_on       DATE,
  ADD COLUMN IF NOT EXISTS one_time_total          NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS recurring_total         NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS recurring_frequency     TEXT,            -- 'monthly' | 'quarterly' | 'annually'
  ADD COLUMN IF NOT EXISTS total_value             NUMERIC(12,2),   -- annualised total
  ADD COLUMN IF NOT EXISTS proposal_sent_by        TEXT,
  ADD COLUMN IF NOT EXISTS client_manager          TEXT,
  ADD COLUMN IF NOT EXISTS client_partner          TEXT,
  ADD COLUMN IF NOT EXISTS client_email            TEXT,
  ADD COLUMN IF NOT EXISTS signed_url              TEXT,
  ADD COLUMN IF NOT EXISTS contact_id              UUID REFERENCES contacts(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id         UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_event_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_payload             JSONB;

-- Backfill raw_payload from the legacy `payload` column (non-destructive).
UPDATE ignition_proposals
SET raw_payload = payload
WHERE raw_payload IS NULL AND payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ignition_proposals_ignition_client_id
  ON ignition_proposals (ignition_client_id) WHERE ignition_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_status
  ON ignition_proposals (status);
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_accepted_at
  ON ignition_proposals (accepted_at DESC) WHERE accepted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_client_email_lower
  ON ignition_proposals (LOWER(client_email)) WHERE client_email IS NOT NULL;

-- 5. Proposal services (line items: proposal x service) -----------------
CREATE TABLE IF NOT EXISTS ignition_proposal_services (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id           TEXT NOT NULL REFERENCES ignition_proposals(proposal_id)    ON DELETE CASCADE,
  ignition_service_id   TEXT          REFERENCES ignition_services(ignition_service_id) ON DELETE SET NULL,
  service_name          TEXT NOT NULL,         -- denormalised: surviving snapshot if service deleted
  description           TEXT,
  quantity              NUMERIC(10,2),
  unit_price            NUMERIC(12,2),
  total_amount          NUMERIC(12,2),
  currency              TEXT,
  billing_frequency     TEXT,                  -- 'monthly'|'quarterly'|'annually'|'one_time'
  billing_type          TEXT,                  -- 'one_time'|'recurring'
  start_date            DATE,
  end_date              DATE,
  status                TEXT,                  -- 'pending'|'accepted'|'completed'|'cancelled'
  ordinal               INTEGER,               -- position within proposal
  raw_payload           JSONB,
  accepted_at           TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotency: a single (proposal, service, ordinal) combo is unique.
  UNIQUE (proposal_id, ignition_service_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_ignition_proposal_services_proposal_id
  ON ignition_proposal_services (proposal_id);

-- 6. Invoices (Stripe-side, surfaced via Zapier) -----------------------
-- These are the invoices Ignition generates against the proposal once
-- the client accepts. Stored separately from any QBO/Karbon invoice.
CREATE TABLE IF NOT EXISTS ignition_invoices (
  ignition_invoice_id   TEXT PRIMARY KEY,
  proposal_id           TEXT REFERENCES ignition_proposals(proposal_id)  ON DELETE SET NULL,
  ignition_client_id    TEXT REFERENCES ignition_clients(ignition_client_id) ON DELETE SET NULL,
  invoice_number        TEXT,
  status                TEXT,                  -- 'open'|'paid'|'voided'|'failed'
  amount                NUMERIC(12,2),
  amount_paid           NUMERIC(12,2),
  amount_outstanding    NUMERIC(12,2),
  currency              TEXT,
  invoice_date          DATE,
  due_date              DATE,
  sent_at               TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  voided_at             TIMESTAMPTZ,
  stripe_invoice_id     TEXT,
  stripe_customer_id    TEXT,
  -- Mapping
  contact_id            UUID REFERENCES contacts(id)      ON DELETE SET NULL,
  organization_id       UUID REFERENCES organizations(id) ON DELETE SET NULL,
  raw_payload           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ignition_invoices_proposal_id
  ON ignition_invoices (proposal_id) WHERE proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_client_id
  ON ignition_invoices (ignition_client_id) WHERE ignition_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_status
  ON ignition_invoices (status);
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_due_date
  ON ignition_invoices (due_date) WHERE due_date IS NOT NULL;

-- 7. Payments (paid invoice receipts) ----------------------------------
CREATE TABLE IF NOT EXISTS ignition_payments (
  ignition_payment_id   TEXT PRIMARY KEY,
  ignition_invoice_id   TEXT REFERENCES ignition_invoices(ignition_invoice_id) ON DELETE SET NULL,
  proposal_id           TEXT REFERENCES ignition_proposals(proposal_id)        ON DELETE SET NULL,
  ignition_client_id    TEXT REFERENCES ignition_clients(ignition_client_id)   ON DELETE SET NULL,
  amount                NUMERIC(12,2),
  fees                  NUMERIC(12,2),
  net_amount            NUMERIC(12,2),
  currency              TEXT,
  payment_method        TEXT,                  -- 'card' | 'ach' | 'bank_transfer' etc.
  payment_status        TEXT,                  -- 'succeeded' | 'failed' | 'refunded' | 'pending'
  paid_at               TIMESTAMPTZ,
  refunded_at           TIMESTAMPTZ,
  refund_amount         NUMERIC(12,2),
  stripe_charge_id      TEXT,
  stripe_payment_intent_id TEXT,
  -- Mapping
  contact_id            UUID REFERENCES contacts(id)      ON DELETE SET NULL,
  organization_id       UUID REFERENCES organizations(id) ON DELETE SET NULL,
  raw_payload           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ignition_payments_invoice_id
  ON ignition_payments (ignition_invoice_id) WHERE ignition_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_payments_client_id
  ON ignition_payments (ignition_client_id) WHERE ignition_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ignition_payments_paid_at
  ON ignition_payments (paid_at DESC) WHERE paid_at IS NOT NULL;

-- 8. Mapping function: ignition_client -> contact / organization -------
-- Strategy:
--   1. Email exact match (case-insensitive) against contacts.primary_email
--      or contacts.secondary_email. Score 1.0.
--   2. Email exact match against organizations.primary_email. Score 1.0.
--   3. Business-name fuzzy match against organizations (trigram similarity
--      >= 0.6). Score = similarity.
--   4. Person-name fuzzy match against contacts.full_name (trigram >= 0.7).
--      Score = similarity.
-- Returns the best candidate per ignition_client (one row per call), with
-- a confidence score so the caller can decide auto-link vs review.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION match_ignition_client_to_supabase(
  p_ignition_client_id TEXT
)
RETURNS TABLE (
  match_kind         TEXT,             -- 'contact' | 'organization'
  matched_id         UUID,
  matched_name       TEXT,
  matched_email      TEXT,
  confidence         NUMERIC,
  method             TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ic RECORD;
BEGIN
  SELECT * INTO ic FROM ignition_clients WHERE ignition_client_id = p_ignition_client_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 1. Email exact -> contact
  IF ic.email IS NOT NULL THEN
    RETURN QUERY
      SELECT 'contact'::TEXT, c.id, c.full_name, c.primary_email,
             1.0::NUMERIC, 'email_exact'::TEXT
      FROM contacts c
      WHERE LOWER(c.primary_email) = LOWER(ic.email)
         OR LOWER(c.secondary_email) = LOWER(ic.email)
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 2. Email exact -> organization
    RETURN QUERY
      SELECT 'organization'::TEXT, o.id, o.name, o.primary_email,
             1.0::NUMERIC, 'email_exact'::TEXT
      FROM organizations o
      WHERE LOWER(o.primary_email) = LOWER(ic.email)
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3. Business-name fuzzy -> organization (only if Ignition labelled as business)
  IF COALESCE(ic.business_name, ic.name) IS NOT NULL THEN
    RETURN QUERY
      SELECT 'organization'::TEXT, o.id, o.name, o.primary_email,
             similarity(o.name, COALESCE(ic.business_name, ic.name))::NUMERIC,
             'name_fuzzy'::TEXT
      FROM organizations o
      WHERE similarity(o.name, COALESCE(ic.business_name, ic.name)) >= 0.6
      ORDER BY similarity(o.name, COALESCE(ic.business_name, ic.name)) DESC
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 4. Person-name fuzzy -> contact
  IF ic.name IS NOT NULL THEN
    RETURN QUERY
      SELECT 'contact'::TEXT, c.id, c.full_name, c.primary_email,
             similarity(c.full_name, ic.name)::NUMERIC,
             'name_fuzzy'::TEXT
      FROM contacts c
      WHERE similarity(c.full_name, ic.name) >= 0.7
      ORDER BY similarity(c.full_name, ic.name) DESC
      LIMIT 1;
  END IF;
END;
$$;

COMMENT ON FUNCTION match_ignition_client_to_supabase IS
  'Returns the single best contact/organization candidate for an Ignition client. Confidence 1.0 means email exact match; lower means trigram name similarity.';

-- 9. Convenience view: Ignition data joined to Motta entities ----------
CREATE OR REPLACE VIEW ignition_proposals_enriched AS
SELECT
  p.proposal_id,
  p.title,
  p.status,
  p.amount,
  p.currency,
  p.sent_at,
  p.accepted_at,
  p.completed_at,
  p.lost_at,
  p.lost_reason,
  p.archived_at,
  p.revoked_at,
  p.effective_start_date,
  p.billing_starts_on,
  p.one_time_total,
  p.recurring_total,
  p.recurring_frequency,
  p.total_value,
  p.proposal_sent_by,
  p.client_manager,
  p.client_partner,
  p.client_email,
  p.client_name,
  p.signed_url,
  p.last_event_at,
  p.created_at,
  p.updated_at,
  -- Ignition client
  ic.ignition_client_id,
  ic.name              AS ignition_client_name,
  ic.business_name     AS ignition_business_name,
  ic.email             AS ignition_client_email,
  ic.match_status,
  ic.match_confidence,
  -- Motta contact
  c.id                 AS contact_id,
  c.full_name          AS contact_full_name,
  c.primary_email      AS contact_email,
  -- Motta organization
  o.id                 AS organization_id,
  o.name               AS organization_name,
  o.primary_email      AS organization_email
FROM ignition_proposals p
LEFT JOIN ignition_clients ic ON p.ignition_client_id = ic.ignition_client_id
LEFT JOIN contacts c          ON COALESCE(p.contact_id, ic.contact_id) = c.id
LEFT JOIN organizations o     ON COALESCE(p.organization_id, ic.organization_id) = o.id;

COMMENT ON VIEW ignition_proposals_enriched IS
  'Ignition proposals with their Ignition client and resolved Motta contact/organization joined in.';
