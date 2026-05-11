-- Migration: Add action_items column to jotform_intake_submissions and prospect_submissions
-- This enables the Action Items functionality in the Intake Detail Sheet and Prospect Form

-- Add action_items to jotform_intake_submissions if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'jotform_intake_submissions' 
    AND column_name = 'action_items'
  ) THEN
    ALTER TABLE public.jotform_intake_submissions
    ADD COLUMN action_items JSONB;
    
    COMMENT ON COLUMN public.jotform_intake_submissions.action_items IS 
      'Array of action items with description, assignee, due_date, priority, create_task';
  END IF;
END $$;

-- Add action_items to prospect_submissions if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'prospect_submissions' 
    AND column_name = 'action_items'
  ) THEN
    ALTER TABLE public.prospect_submissions
    ADD COLUMN action_items JSONB;
    
    COMMENT ON COLUMN public.prospect_submissions.action_items IS 
      'Array of action items with description, assignee, due_date, priority, create_task';
  END IF;
END $$;
