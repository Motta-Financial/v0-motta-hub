-- Update work_items table to ensure proper Karbon sync support
-- Run this in Supabase SQL Editor

-- Add unique constraint on karbon_work_item_key if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'work_items_karbon_work_item_key_key'
  ) THEN
    ALTER TABLE work_items 
    ADD CONSTRAINT work_items_karbon_work_item_key_key 
    UNIQUE (karbon_work_item_key);
  END IF;
END $$;

-- Create index for faster Karbon sync lookups
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_key 
ON work_items(karbon_work_item_key);

CREATE INDEX IF NOT EXISTS idx_work_items_last_synced 
ON work_items(last_synced_at);

CREATE INDEX IF NOT EXISTS idx_work_items_status 
ON work_items(status);

CREATE INDEX IF NOT EXISTS idx_work_items_work_type 
ON work_items(work_type);

-- Add updated_at trigger if not exists
CREATE OR REPLACE FUNCTION update_work_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_work_items_updated_at ON work_items;

CREATE TRIGGER update_work_items_updated_at
  BEFORE UPDATE ON work_items
  FOR EACH ROW
  EXECUTE FUNCTION update_work_items_updated_at();

-- Verify the sync_log table exists for tracking sync operations
CREATE TABLE IF NOT EXISTS sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL,
  sync_direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL DEFAULT 'pending',
  records_fetched INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  error_details JSONB,
  triggered_by_id UUID,
  is_manual BOOLEAN DEFAULT false
);

-- Enable RLS on sync_log
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- Allow all operations on sync_log for now
CREATE POLICY IF NOT EXISTS "Allow all on sync_log" ON sync_log
  FOR ALL USING (true) WITH CHECK (true);
