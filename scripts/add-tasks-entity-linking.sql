-- Migration: Add entity linking columns to tasks table
-- This allows user-created tasks to be linked to various Motta Hub entities

-- Add entity linking columns if they don't exist
DO $$ 
BEGIN
  -- Link to Karbon contact
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'contact_id') THEN
    ALTER TABLE public.tasks ADD COLUMN contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL;
  END IF;
  
  -- Link to Karbon organization
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'organization_id') THEN
    ALTER TABLE public.tasks ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
  
  -- Link to intake submission
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'intake_submission_id') THEN
    ALTER TABLE public.tasks ADD COLUMN intake_submission_id UUID REFERENCES public.jotform_intake_submissions(id) ON DELETE SET NULL;
  END IF;
  
  -- Link to proposal
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'proposal_id') THEN
    ALTER TABLE public.tasks ADD COLUMN proposal_id TEXT REFERENCES public.ignition_proposals(proposal_id) ON DELETE SET NULL;
  END IF;
  
  -- Link to debrief (for action items that get converted to tasks)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'debrief_id') THEN
    ALTER TABLE public.tasks ADD COLUMN debrief_id UUID REFERENCES public.debriefs(id) ON DELETE SET NULL;
  END IF;
  
  -- Link to Karbon work item
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'karbon_work_item_id') THEN
    ALTER TABLE public.tasks ADD COLUMN karbon_work_item_id TEXT;
  END IF;
  
  -- Sort order for drag-and-drop reordering
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'sort_order') THEN
    ALTER TABLE public.tasks ADD COLUMN sort_order INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create indexes for foreign keys (improves query performance)
CREATE INDEX IF NOT EXISTS idx_tasks_contact_id ON public.tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_organization_id ON public.tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_intake_submission_id ON public.tasks(intake_submission_id);
CREATE INDEX IF NOT EXISTS idx_tasks_proposal_id ON public.tasks(proposal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_debrief_id ON public.tasks(debrief_id);
CREATE INDEX IF NOT EXISTS idx_tasks_karbon_work_item_id ON public.tasks(karbon_work_item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_sort_order ON public.tasks(sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON public.tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
