-- Migration: Add Karbon URLs and Link Records
-- This script adds karbon_url columns to contacts and organizations,
-- and creates functions to auto-generate URLs from Karbon keys

-- Set the Karbon base URL (your tenant URL)
-- Format: https://app2.karbonhq.com/{TENANT_ID}#/
DO $$
BEGIN
  -- Create a settings table if it doesn't exist to store the Karbon tenant URL
  CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  
  -- Insert the Karbon base URL setting
  INSERT INTO public.app_settings (key, value, description)
  VALUES ('karbon_base_url', 'https://app2.karbonhq.com/4mTyp9lLRWTC#', 'Base URL for Karbon links')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
END $$;

-- Enable RLS on app_settings
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on app_settings" ON public.app_settings;
CREATE POLICY "Allow all on app_settings" ON public.app_settings FOR ALL USING (true);

-- Add karbon_url to contacts if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'karbon_url'
  ) THEN
    ALTER TABLE public.contacts ADD COLUMN karbon_url TEXT;
  END IF;
END $$;

-- Add karbon_url to organizations if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'karbon_url'
  ) THEN
    ALTER TABLE public.organizations ADD COLUMN karbon_url TEXT;
  END IF;
END $$;

-- Create function to generate Karbon URLs
CREATE OR REPLACE FUNCTION public.generate_karbon_url(entity_type TEXT, karbon_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  base_url TEXT;
  path_segment TEXT;
BEGIN
  IF karbon_key IS NULL OR karbon_key = '' THEN
    RETURN NULL;
  END IF;
  
  -- Get base URL from settings
  SELECT value INTO base_url FROM public.app_settings WHERE key = 'karbon_base_url';
  
  IF base_url IS NULL THEN
    base_url := 'https://app2.karbonhq.com/4mTyp9lLRWTC#';
  END IF;
  
  -- Determine path segment based on entity type
  CASE LOWER(entity_type)
    WHEN 'work_item', 'work', 'workitem' THEN
      path_segment := '/work/';
    WHEN 'contact', 'contacts' THEN
      path_segment := '/contacts/';
    WHEN 'organization', 'organizations' THEN
      path_segment := '/organizations/';
    ELSE
      RETURN NULL;
  END CASE;
  
  RETURN base_url || path_segment || karbon_key;
END;
$$;

-- Update existing contacts with Karbon URLs
UPDATE public.contacts
SET karbon_url = public.generate_karbon_url('contact', karbon_contact_key)
WHERE karbon_contact_key IS NOT NULL 
  AND karbon_contact_key != ''
  AND (karbon_url IS NULL OR karbon_url = '');

-- Update existing organizations with Karbon URLs
UPDATE public.organizations
SET karbon_url = public.generate_karbon_url('organization', karbon_organization_key)
WHERE karbon_organization_key IS NOT NULL 
  AND karbon_organization_key != ''
  AND (karbon_url IS NULL OR karbon_url = '');

-- Update existing work_items with Karbon URLs (if missing)
UPDATE public.work_items
SET karbon_url = public.generate_karbon_url('work_item', karbon_work_item_key)
WHERE karbon_work_item_key IS NOT NULL 
  AND karbon_work_item_key != ''
  AND (karbon_url IS NULL OR karbon_url = '');

-- Create trigger function to auto-generate Karbon URL for contacts
CREATE OR REPLACE FUNCTION public.auto_set_contact_karbon_url()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.karbon_contact_key IS NOT NULL AND NEW.karbon_contact_key != '' THEN
    NEW.karbon_url := public.generate_karbon_url('contact', NEW.karbon_contact_key);
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger function to auto-generate Karbon URL for organizations
CREATE OR REPLACE FUNCTION public.auto_set_organization_karbon_url()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.karbon_organization_key IS NOT NULL AND NEW.karbon_organization_key != '' THEN
    NEW.karbon_url := public.generate_karbon_url('organization', NEW.karbon_organization_key);
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger function to auto-generate Karbon URL for work_items
CREATE OR REPLACE FUNCTION public.auto_set_work_item_karbon_url()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.karbon_work_item_key IS NOT NULL AND NEW.karbon_work_item_key != '' THEN
    NEW.karbon_url := public.generate_karbon_url('work_item', NEW.karbon_work_item_key);
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trg_auto_set_contact_karbon_url ON public.contacts;
DROP TRIGGER IF EXISTS trg_auto_set_organization_karbon_url ON public.organizations;
DROP TRIGGER IF EXISTS trg_auto_set_work_item_karbon_url ON public.work_items;

-- Create triggers
CREATE TRIGGER trg_auto_set_contact_karbon_url
  BEFORE INSERT OR UPDATE OF karbon_contact_key ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_contact_karbon_url();

CREATE TRIGGER trg_auto_set_organization_karbon_url
  BEFORE INSERT OR UPDATE OF karbon_organization_key ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_organization_karbon_url();

CREATE TRIGGER trg_auto_set_work_item_karbon_url
  BEFORE INSERT OR UPDATE OF karbon_work_item_key ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_work_item_karbon_url();

-- ============================================================
-- LINK WORK ITEMS TO CLIENTS
-- ============================================================

-- Create indexes for faster lookups if they don't exist
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_contact_key ON public.contacts(karbon_contact_key) WHERE karbon_contact_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_karbon_organization_key ON public.organizations(karbon_organization_key) WHERE karbon_organization_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_client_key ON public.work_items(karbon_client_key) WHERE karbon_client_key IS NOT NULL;

-- Function to link work items to contacts/organizations based on karbon_client_key
CREATE OR REPLACE FUNCTION public.link_work_item_to_client(work_item_row work_items)
RETURNS TABLE(contact_uuid UUID, organization_uuid UUID)
LANGUAGE plpgsql
AS $$
DECLARE
  v_contact_id UUID;
  v_organization_id UUID;
BEGIN
  -- If no karbon_client_key, return nulls
  IF work_item_row.karbon_client_key IS NULL OR work_item_row.karbon_client_key = '' THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID;
    RETURN;
  END IF;
  
  -- Check client_type to determine where to look
  IF LOWER(COALESCE(work_item_row.client_type, '')) = 'contact' THEN
    -- Look for a contact
    SELECT id INTO v_contact_id
    FROM public.contacts
    WHERE karbon_contact_key = work_item_row.karbon_client_key
    LIMIT 1;
    
    RETURN QUERY SELECT v_contact_id, NULL::UUID;
  ELSIF LOWER(COALESCE(work_item_row.client_type, '')) = 'organization' THEN
    -- Look for an organization
    SELECT id INTO v_organization_id
    FROM public.organizations
    WHERE karbon_organization_key = work_item_row.karbon_client_key
    LIMIT 1;
    
    RETURN QUERY SELECT NULL::UUID, v_organization_id;
  ELSE
    -- Try both - check contacts first, then organizations
    SELECT id INTO v_contact_id
    FROM public.contacts
    WHERE karbon_contact_key = work_item_row.karbon_client_key
    LIMIT 1;
    
    IF v_contact_id IS NOT NULL THEN
      RETURN QUERY SELECT v_contact_id, NULL::UUID;
      RETURN;
    END IF;
    
    SELECT id INTO v_organization_id
    FROM public.organizations
    WHERE karbon_organization_key = work_item_row.karbon_client_key
    LIMIT 1;
    
    RETURN QUERY SELECT NULL::UUID, v_organization_id;
  END IF;
END;
$$;

-- Update all work items to link to their clients
WITH linked AS (
  SELECT 
    w.id,
    w.karbon_client_key,
    w.client_type,
    c.id AS found_contact_id,
    o.id AS found_org_id
  FROM public.work_items w
  LEFT JOIN public.contacts c ON c.karbon_contact_key = w.karbon_client_key
  LEFT JOIN public.organizations o ON o.karbon_organization_key = w.karbon_client_key
  WHERE w.karbon_client_key IS NOT NULL AND w.karbon_client_key != ''
)
UPDATE public.work_items wi
SET 
  contact_id = CASE 
    WHEN LOWER(COALESCE(linked.client_type, '')) = 'contact' THEN linked.found_contact_id
    WHEN LOWER(COALESCE(linked.client_type, '')) = 'organization' THEN NULL
    ELSE COALESCE(linked.found_contact_id, wi.contact_id)
  END,
  organization_id = CASE 
    WHEN LOWER(COALESCE(linked.client_type, '')) = 'organization' THEN linked.found_org_id
    WHEN LOWER(COALESCE(linked.client_type, '')) = 'contact' THEN NULL
    ELSE COALESCE(linked.found_org_id, wi.organization_id)
  END
FROM linked
WHERE wi.id = linked.id
  AND (wi.contact_id IS NULL OR wi.organization_id IS NULL);

-- Create trigger function to auto-link work items on insert/update
CREATE OR REPLACE FUNCTION public.auto_link_work_item_to_client()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_contact_id UUID;
  v_organization_id UUID;
BEGIN
  -- Only process if karbon_client_key is set
  IF NEW.karbon_client_key IS NOT NULL AND NEW.karbon_client_key != '' THEN
    
    -- Determine where to look based on client_type
    IF LOWER(COALESCE(NEW.client_type, '')) = 'contact' THEN
      SELECT id INTO v_contact_id
      FROM public.contacts
      WHERE karbon_contact_key = NEW.karbon_client_key
      LIMIT 1;
      
      NEW.contact_id := COALESCE(v_contact_id, NEW.contact_id);
      
    ELSIF LOWER(COALESCE(NEW.client_type, '')) = 'organization' THEN
      SELECT id INTO v_organization_id
      FROM public.organizations
      WHERE karbon_organization_key = NEW.karbon_client_key
      LIMIT 1;
      
      NEW.organization_id := COALESCE(v_organization_id, NEW.organization_id);
      
    ELSE
      -- Try both
      SELECT id INTO v_contact_id
      FROM public.contacts
      WHERE karbon_contact_key = NEW.karbon_client_key
      LIMIT 1;
      
      IF v_contact_id IS NOT NULL THEN
        NEW.contact_id := v_contact_id;
      ELSE
        SELECT id INTO v_organization_id
        FROM public.organizations
        WHERE karbon_organization_key = NEW.karbon_client_key
        LIMIT 1;
        
        NEW.organization_id := COALESCE(v_organization_id, NEW.organization_id);
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trg_auto_link_work_item_to_client ON public.work_items;

-- Create trigger for auto-linking
CREATE TRIGGER trg_auto_link_work_item_to_client
  BEFORE INSERT OR UPDATE OF karbon_client_key, client_type ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_work_item_to_client();

-- ============================================================
-- SUMMARY VIEW: Work Items with Client Details
-- ============================================================

CREATE OR REPLACE VIEW public.v_work_items_with_clients AS
SELECT 
  w.id,
  w.title,
  w.work_type,
  w.workflow_status,
  w.status,
  w.due_date,
  w.start_date,
  w.completed_date,
  w.tax_year,
  w.karbon_work_item_key,
  w.karbon_url AS work_item_karbon_url,
  w.client_type,
  w.karbon_client_key,
  -- Contact info
  w.contact_id,
  c.full_name AS contact_name,
  c.primary_email AS contact_email,
  c.karbon_contact_key,
  c.karbon_url AS contact_karbon_url,
  -- Organization info
  w.organization_id,
  o.name AS organization_name,
  o.primary_email AS organization_email,
  o.karbon_organization_key,
  o.karbon_url AS organization_karbon_url,
  -- Combined client name
  COALESCE(c.full_name, o.name) AS client_name,
  COALESCE(c.karbon_url, o.karbon_url) AS client_karbon_url,
  -- Timestamps
  w.created_at,
  w.updated_at,
  w.last_synced_at
FROM public.work_items w
LEFT JOIN public.contacts c ON w.contact_id = c.id
LEFT JOIN public.organizations o ON w.organization_id = o.id;

-- Grant access to the view
GRANT SELECT ON public.v_work_items_with_clients TO authenticated, anon;

-- ============================================================
-- REPORT: Link Status Summary
-- ============================================================

DO $$
DECLARE
  total_work_items INTEGER;
  linked_to_contact INTEGER;
  linked_to_org INTEGER;
  unlinked INTEGER;
  has_key_no_link INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_work_items FROM public.work_items;
  SELECT COUNT(*) INTO linked_to_contact FROM public.work_items WHERE contact_id IS NOT NULL;
  SELECT COUNT(*) INTO linked_to_org FROM public.work_items WHERE organization_id IS NOT NULL;
  SELECT COUNT(*) INTO unlinked FROM public.work_items WHERE contact_id IS NULL AND organization_id IS NULL;
  SELECT COUNT(*) INTO has_key_no_link FROM public.work_items 
    WHERE karbon_client_key IS NOT NULL 
      AND karbon_client_key != ''
      AND contact_id IS NULL 
      AND organization_id IS NULL;
  
  RAISE NOTICE '=== WORK ITEM LINK STATUS ===';
  RAISE NOTICE 'Total Work Items: %', total_work_items;
  RAISE NOTICE 'Linked to Contact: %', linked_to_contact;
  RAISE NOTICE 'Linked to Organization: %', linked_to_org;
  RAISE NOTICE 'Unlinked: %', unlinked;
  RAISE NOTICE 'Has Key but No Link: % (client not yet imported)', has_key_no_link;
END $$;
