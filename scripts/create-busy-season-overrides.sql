-- Table to store busy season tracker overrides/changes for tax work items
-- This allows team members to assign work items to queue, change status, add notes, etc.
-- and have those changes persist and be visible to all team members

CREATE TABLE IF NOT EXISTS public.busy_season_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  karbon_work_key TEXT NOT NULL UNIQUE,
  
  -- Override fields (null means use Karbon data)
  assigned_to TEXT,
  preparer TEXT,
  reviewer TEXT,
  primary_status TEXT,
  document_status TEXT,
  in_queue BOOLEAN DEFAULT FALSE,
  is_priority BOOLEAN DEFAULT FALSE,
  notes TEXT,
  
  -- Assignment history stored as JSONB array
  assignment_notes JSONB DEFAULT '[]'::JSONB,
  
  -- Tracking
  last_updated_by TEXT,
  last_updated_by_type TEXT DEFAULT 'internal',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups by karbon_work_key
CREATE INDEX IF NOT EXISTS idx_busy_season_overrides_karbon_work_key 
ON public.busy_season_overrides(karbon_work_key);

-- Enable RLS
ALTER TABLE public.busy_season_overrides ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (team members)
CREATE POLICY "Allow all on busy_season_overrides" 
ON public.busy_season_overrides 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_busy_season_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS busy_season_overrides_updated_at ON public.busy_season_overrides;
CREATE TRIGGER busy_season_overrides_updated_at
  BEFORE UPDATE ON public.busy_season_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_busy_season_overrides_updated_at();
