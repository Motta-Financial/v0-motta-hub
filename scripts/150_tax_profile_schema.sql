-- Tax Profile Enhancement Schema
-- Adds: client fingerprints for identification, document tracking, and computed profile data

-- 1. Client fingerprint table - all identifiers for fast lookup/matching
CREATE TABLE IF NOT EXISTS tax_client_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proconnect_client_id TEXT NOT NULL UNIQUE,
  
  -- Primary identifiers
  display_name TEXT,
  first_name TEXT,
  last_name TEXT,
  business_name TEXT,
  
  -- SSN/EIN (masked in UI, full in search)
  ssn_last4 TEXT,
  ein TEXT,
  
  -- Contact info for matching
  primary_email TEXT,
  secondary_emails TEXT[] DEFAULT '{}',
  phone_primary TEXT,
  phone_last4 TEXT,
  
  -- Address for matching
  city TEXT,
  state TEXT,
  zip TEXT,
  
  -- Cross-system IDs (all nullable)
  legacy_motta_client_id TEXT,
  karbon_contact_key TEXT,
  karbon_organization_key TEXT,
  ignition_client_id TEXT,
  hub_contact_id UUID,
  
  -- Spouse info (for joint filers)
  spouse_first_name TEXT,
  spouse_last_name TEXT,
  spouse_ssn_last4 TEXT,
  spouse_email TEXT,
  
  -- Search-optimized fields (lowercase, normalized)
  search_name TEXT GENERATED ALWAYS AS (
    LOWER(COALESCE(display_name, '') || ' ' || COALESCE(first_name, '') || ' ' || 
          COALESCE(last_name, '') || ' ' || COALESCE(business_name, ''))
  ) STORED,
  search_email TEXT GENERATED ALWAYS AS (
    LOWER(COALESCE(primary_email, ''))
  ) STORED,
  
  -- Metadata
  client_type TEXT CHECK (client_type IN ('PERSON', 'ORGANIZATION')),
  is_active BOOLEAN DEFAULT true,
  first_seen_year INTEGER,
  last_seen_year INTEGER,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_tcf_search_name ON tax_client_fingerprints USING gin(search_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tcf_search_email ON tax_client_fingerprints(search_email);
CREATE INDEX IF NOT EXISTS idx_tcf_ssn_last4 ON tax_client_fingerprints(ssn_last4) WHERE ssn_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tcf_phone_last4 ON tax_client_fingerprints(phone_last4) WHERE phone_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tcf_legacy_id ON tax_client_fingerprints(legacy_motta_client_id) WHERE legacy_motta_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tcf_karbon ON tax_client_fingerprints(karbon_contact_key) WHERE karbon_contact_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tcf_hub ON tax_client_fingerprints(hub_contact_id) WHERE hub_contact_id IS NOT NULL;

-- 2. Tax profile computed summary (denormalized for fast access)
CREATE TABLE IF NOT EXISTS tax_profile_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proconnect_client_id TEXT NOT NULL UNIQUE,
  
  -- Return history
  total_returns INTEGER DEFAULT 0,
  tax_years_filed INTEGER[] DEFAULT '{}',
  first_year_filed INTEGER,
  last_year_filed INTEGER,
  consecutive_years INTEGER DEFAULT 0,
  
  -- Filing patterns
  primary_filing_status TEXT,
  primary_return_type TEXT,
  has_schedule_c BOOLEAN DEFAULT false,
  has_schedule_e BOOLEAN DEFAULT false,
  has_schedule_f BOOLEAN DEFAULT false,
  has_foreign_accounts BOOLEAN DEFAULT false,
  
  -- Financial trends (latest 3 years)
  income_trend JSONB DEFAULT '{}',
  agi_trend JSONB DEFAULT '{}',
  tax_trend JSONB DEFAULT '{}',
  refund_trend JSONB DEFAULT '{}',
  
  -- Key metrics (latest year)
  latest_total_income NUMERIC(15,2),
  latest_agi NUMERIC(15,2),
  latest_taxable_income NUMERIC(15,2),
  latest_total_tax NUMERIC(15,2),
  latest_effective_rate NUMERIC(5,4),
  latest_refund_or_owed NUMERIC(15,2),
  
  -- Preparers
  primary_preparer_id TEXT,
  primary_preparer_name TEXT,
  preparer_history TEXT[] DEFAULT '{}',
  
  -- Document tracking
  documents_on_file INTEGER DEFAULT 0,
  pending_documents INTEGER DEFAULT 0,
  last_document_received TIMESTAMPTZ,
  
  -- Computed status
  profile_completeness INTEGER DEFAULT 0,
  needs_attention BOOLEAN DEFAULT false,
  attention_reasons TEXT[] DEFAULT '{}',
  
  -- AI/ALFRED context
  ai_summary TEXT,
  ai_keywords TEXT[] DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Document tracking for tax returns
CREATE TABLE IF NOT EXISTS tax_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proconnect_client_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  
  -- Document info
  document_type TEXT NOT NULL,
  document_subtype TEXT,
  issuer_name TEXT,
  issuer_ein TEXT,
  
  -- Amounts (for verification)
  reported_amount NUMERIC(15,2),
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'entered', 'verified', 'issue')),
  entered_by TEXT,
  entered_at TIMESTAMPTZ,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  
  -- Storage
  blob_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  
  -- Notes
  notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(proconnect_client_id, tax_year, document_type, COALESCE(issuer_name, ''))
);

CREATE INDEX IF NOT EXISTS idx_tax_docs_client ON tax_documents(proconnect_client_id);
CREATE INDEX IF NOT EXISTS idx_tax_docs_year ON tax_documents(tax_year);
CREATE INDEX IF NOT EXISTS idx_tax_docs_status ON tax_documents(status);

-- 4. Expected documents (what we expect based on prior years)
CREATE TABLE IF NOT EXISTS tax_expected_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proconnect_client_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  
  document_type TEXT NOT NULL,
  document_subtype TEXT,
  issuer_name TEXT,
  issuer_ein TEXT,
  
  -- Expectation basis
  based_on_year INTEGER,
  expected_amount NUMERIC(15,2),
  
  -- Status
  received BOOLEAN DEFAULT false,
  received_document_id UUID REFERENCES tax_documents(id),
  
  -- Flags
  is_critical BOOLEAN DEFAULT false,
  is_recurring BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(proconnect_client_id, tax_year, document_type, COALESCE(issuer_name, ''))
);

-- 5. View for ALFRED/search - comprehensive client lookup
CREATE OR REPLACE VIEW tax_clients_searchable AS
SELECT 
  f.proconnect_client_id,
  f.display_name,
  f.first_name,
  f.last_name,
  f.business_name,
  f.ssn_last4,
  f.ein,
  f.primary_email,
  f.phone_primary,
  f.phone_last4,
  f.city,
  f.state,
  f.client_type,
  f.spouse_first_name,
  f.spouse_last_name,
  f.legacy_motta_client_id,
  f.karbon_contact_key,
  f.hub_contact_id,
  f.search_name,
  f.search_email,
  f.is_active,
  s.total_returns,
  s.tax_years_filed,
  s.first_year_filed,
  s.last_year_filed,
  s.primary_filing_status,
  s.primary_return_type,
  s.latest_total_income,
  s.latest_agi,
  s.primary_preparer_name,
  s.ai_summary,
  s.ai_keywords,
  s.profile_completeness,
  s.needs_attention,
  s.attention_reasons
FROM tax_client_fingerprints f
LEFT JOIN tax_profile_summaries s ON f.proconnect_client_id = s.proconnect_client_id;

-- 6. Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_tax_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tax_client_fingerprints_updated ON tax_client_fingerprints;
CREATE TRIGGER tax_client_fingerprints_updated
  BEFORE UPDATE ON tax_client_fingerprints
  FOR EACH ROW EXECUTE FUNCTION update_tax_profile_timestamp();

DROP TRIGGER IF EXISTS tax_profile_summaries_updated ON tax_profile_summaries;
CREATE TRIGGER tax_profile_summaries_updated
  BEFORE UPDATE ON tax_profile_summaries
  FOR EACH ROW EXECUTE FUNCTION update_tax_profile_timestamp();

DROP TRIGGER IF EXISTS tax_documents_updated ON tax_documents;
CREATE TRIGGER tax_documents_updated
  BEFORE UPDATE ON tax_documents
  FOR EACH ROW EXECUTE FUNCTION update_tax_profile_timestamp();

-- Enable trigram extension for fuzzy search (if not exists)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
