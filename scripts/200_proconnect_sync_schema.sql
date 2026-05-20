-- ProConnect Tax Sync Schema
-- Migration 200: Replace legacy CSV-imported tables with API-synced schema
-- Run once to set up the full sync infrastructure

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Drop legacy tables (they were CSV imports, nothing to preserve)
-- ════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS proconnect_1040_returns CASCADE;
DROP TABLE IF EXISTS proconnect_1120s_returns CASCADE;
DROP TABLE IF EXISTS proconnect_1065_returns CASCADE;
DROP TABLE IF EXISTS proconnect_990_returns CASCADE;
DROP TABLE IF EXISTS proconnect_1120_returns CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. OAuth Token Storage (single-row, upsert pattern)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proconnect_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_type text DEFAULT 'Bearer',
  expires_at timestamptz NOT NULL,
  scope text,
  realm_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure only one row exists
CREATE UNIQUE INDEX IF NOT EXISTS proconnect_oauth_tokens_singleton
  ON proconnect_oauth_tokens ((true));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Clients (from GET /v1/clients)
-- ════════════════════════════════════════════════════════════════════════════

-- Keep existing proconnect_clients but add hub_contact_id FK
-- First check if hub_contact_id column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proconnect_clients'
      AND column_name = 'hub_contact_id'
  ) THEN
    ALTER TABLE proconnect_clients
      ADD COLUMN hub_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add synced_at column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proconnect_clients'
      AND column_name = 'synced_at'
  ) THEN
    ALTER TABLE proconnect_clients ADD COLUMN synced_at timestamptz;
  END IF;
END $$;

-- Index for email matching
CREATE INDEX IF NOT EXISTS proconnect_clients_email_idx
  ON proconnect_clients (lower(email));

CREATE INDEX IF NOT EXISTS proconnect_clients_hub_contact_idx
  ON proconnect_clients (hub_contact_id)
  WHERE hub_contact_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Engagements (from GET /v2/engagements)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proconnect_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- ProConnect identifiers
  engagement_id text NOT NULL,         -- from API
  proconnect_client_id text NOT NULL,  -- links to proconnect_clients
  tax_year integer NOT NULL,
  
  -- Return type info
  return_type text,                    -- IND, COR, PAR, SCO, FID, EXM
  form_type text,                      -- 1040, 1120, 1065, 1120S, 1041, 990
  
  -- Status fields (promoted for querying)
  status text,
  efile_status text,
  work_status text,
  
  -- Full API response (all fields preserved)
  raw_json jsonb NOT NULL,
  
  -- Timestamps
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Unique constraint: one engagement per client per year per return type
  CONSTRAINT proconnect_engagements_unique 
    UNIQUE (proconnect_client_id, tax_year, return_type)
);

CREATE INDEX IF NOT EXISTS proconnect_engagements_client_idx
  ON proconnect_engagements (proconnect_client_id);

CREATE INDEX IF NOT EXISTS proconnect_engagements_year_idx
  ON proconnect_engagements (tax_year);

CREATE INDEX IF NOT EXISTS proconnect_engagements_status_idx
  ON proconnect_engagements (status);

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS proconnect_engagements_raw_gin
  ON proconnect_engagements USING gin (raw_json);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Custom Statuses (lookup table from GET /v1/custom-status)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proconnect_custom_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  color text,
  sort_order integer,
  is_active boolean DEFAULT true,
  raw_json jsonb,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Sync Logs (for tracking runs and failure alerting)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proconnect_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Run metadata
  sync_type text NOT NULL,             -- 'full', 'webhook', 'manual'
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  
  -- Results
  status text NOT NULL DEFAULT 'running', -- 'running', 'success', 'failed'
  clients_synced integer DEFAULT 0,
  engagements_synced integer DEFAULT 0,
  custom_statuses_synced integer DEFAULT 0,
  
  -- Error tracking
  error_message text,
  error_details jsonb,
  
  -- Consecutive failure tracking (for alerting)
  is_consecutive_failure boolean DEFAULT false,
  consecutive_failure_count integer DEFAULT 0,
  alert_sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS proconnect_sync_logs_status_idx
  ON proconnect_sync_logs (status, started_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Webhook Events (audit log for incoming webhooks)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proconnect_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Event metadata
  event_type text NOT NULL,            -- 'Client', 'TaxReturn', 'TaxReturnWorkStatus'
  operation text NOT NULL,             -- 'Create', 'Update', 'Delete'
  entity_id text NOT NULL,             -- ProConnect entity ID
  realm_id text,
  
  -- Processing status
  received_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  processing_status text DEFAULT 'pending', -- 'pending', 'processed', 'failed'
  processing_error text,
  
  -- Raw payload for debugging
  raw_payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS proconnect_webhook_events_status_idx
  ON proconnect_webhook_events (processing_status, received_at);

CREATE INDEX IF NOT EXISTS proconnect_webhook_events_entity_idx
  ON proconnect_webhook_events (event_type, entity_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 8. RLS Policies (service role bypass, authenticated read)
-- ════════════════════════════════════════════════════════════════════════════

-- OAuth tokens: only service role
ALTER TABLE proconnect_oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY proconnect_oauth_tokens_service ON proconnect_oauth_tokens
  FOR ALL USING (auth.role() = 'service_role');

-- Clients: authenticated can read
ALTER TABLE proconnect_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proconnect_clients_read ON proconnect_clients;
CREATE POLICY proconnect_clients_read ON proconnect_clients
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
DROP POLICY IF EXISTS proconnect_clients_write ON proconnect_clients;
CREATE POLICY proconnect_clients_write ON proconnect_clients
  FOR ALL USING (auth.role() = 'service_role');

-- Engagements: authenticated can read
ALTER TABLE proconnect_engagements ENABLE ROW LEVEL SECURITY;
CREATE POLICY proconnect_engagements_read ON proconnect_engagements
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY proconnect_engagements_write ON proconnect_engagements
  FOR ALL USING (auth.role() = 'service_role');

-- Custom statuses: authenticated can read
ALTER TABLE proconnect_custom_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY proconnect_custom_statuses_read ON proconnect_custom_statuses
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY proconnect_custom_statuses_write ON proconnect_custom_statuses
  FOR ALL USING (auth.role() = 'service_role');

-- Sync logs: authenticated can read
ALTER TABLE proconnect_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY proconnect_sync_logs_read ON proconnect_sync_logs
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY proconnect_sync_logs_write ON proconnect_sync_logs
  FOR ALL USING (auth.role() = 'service_role');

-- Webhook events: service role only
ALTER TABLE proconnect_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY proconnect_webhook_events_service ON proconnect_webhook_events
  FOR ALL USING (auth.role() = 'service_role');

-- ════════════════════════════════════════════════════════════════════════════
-- Done
-- ════════════════════════════════════════════════════════════════════════════
