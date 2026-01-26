-- Add Karbon status and internal workflow fields to busy_season_work_items

-- Karbon status fields (synced from Karbon)
ALTER TABLE busy_season_work_items 
  ADD COLUMN IF NOT EXISTS karbon_status TEXT,
  ADD COLUMN IF NOT EXISTS karbon_secondary_status TEXT;

-- Internal workflow status (managed in app)
-- Stages: lead, documents_requested, documents_received, ready_for_prep, in_progress, review, completed
ALTER TABLE busy_season_work_items 
  ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'lead';

-- Document tracking
ALTER TABLE busy_season_work_items 
  ADD COLUMN IF NOT EXISTS documents_requested_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS documents_received_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS documents_checklist JSONB DEFAULT '[]';

-- Follow-up tracking
ALTER TABLE busy_season_work_items 
  ADD COLUMN IF NOT EXISTS last_follow_up_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_follow_up_date TIMESTAMPTZ;

-- Task tracking (synced from Karbon)
ALTER TABLE busy_season_work_items 
  ADD COLUMN IF NOT EXISTS total_tasks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_tasks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS karbon_tasks JSONB DEFAULT '[]';

-- Client communication
ALTER TABLE busy_season_work_items 
  ADD COLUMN IF NOT EXISTS last_client_activity TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_notes TEXT;

-- Add index for workflow status
CREATE INDEX IF NOT EXISTS idx_busy_season_workflow ON busy_season_work_items(workflow_status);
CREATE INDEX IF NOT EXISTS idx_busy_season_karbon_status ON busy_season_work_items(karbon_status);
