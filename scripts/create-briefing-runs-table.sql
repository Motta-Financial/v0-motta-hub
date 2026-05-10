-- Migration: Create briefing_runs table to track when daily briefings are sent
-- This allows us to fetch data "since last briefing" instead of "since yesterday"

CREATE TABLE IF NOT EXISTS public.briefing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  recipients_count INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for quickly finding the last successful briefing
CREATE INDEX IF NOT EXISTS idx_briefing_runs_completed 
  ON public.briefing_runs (completed_at DESC) 
  WHERE status = 'completed';

-- Enable RLS
ALTER TABLE public.briefing_runs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read and manage briefing_runs
CREATE POLICY "Allow authenticated to manage briefing_runs" 
  ON public.briefing_runs 
  FOR ALL 
  USING (true) 
  WITH CHECK (true);

COMMENT ON TABLE public.briefing_runs IS 'Tracks daily briefing email runs for "since last briefing" data fetching';
