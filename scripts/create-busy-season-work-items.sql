-- Busy Season Work Items table
-- Stores tax prep work items synced from Karbon, with team edits persisted here

CREATE TABLE IF NOT EXISTS busy_season_work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  karbon_work_key TEXT UNIQUE NOT NULL,
  
  -- Client info
  client_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  
  -- Status tracking
  primary_status TEXT NOT NULL DEFAULT 'Documents Received',
  document_status TEXT,
  
  -- Assignment
  preparer TEXT,
  reviewer TEXT,
  assigned_to TEXT,
  in_queue BOOLEAN DEFAULT false,
  is_priority BOOLEAN DEFAULT false,
  
  -- Dates
  due_date TIMESTAMPTZ,
  
  -- Notes and progress
  notes TEXT,
  progress INTEGER DEFAULT 0,
  documents_received BOOLEAN DEFAULT false,
  
  -- Karbon link
  karbon_url TEXT,
  
  -- Audit fields
  last_updated_by TEXT,
  last_updated_by_type TEXT DEFAULT 'internal',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_busy_season_karbon_key ON busy_season_work_items(karbon_work_key);
CREATE INDEX IF NOT EXISTS idx_busy_season_status ON busy_season_work_items(primary_status);
CREATE INDEX IF NOT EXISTS idx_busy_season_entity ON busy_season_work_items(entity_type);
CREATE INDEX IF NOT EXISTS idx_busy_season_in_queue ON busy_season_work_items(in_queue);

-- Assignment history table for tracking changes
CREATE TABLE IF NOT EXISTS busy_season_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID REFERENCES busy_season_work_items(id) ON DELETE CASCADE,
  assigned_to TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_history_work_item ON busy_season_assignment_history(work_item_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_busy_season_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS busy_season_work_items_updated ON busy_season_work_items;
CREATE TRIGGER busy_season_work_items_updated
  BEFORE UPDATE ON busy_season_work_items
  FOR EACH ROW
  EXECUTE FUNCTION update_busy_season_timestamp();
