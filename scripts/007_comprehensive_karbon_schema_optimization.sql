-- =====================================================
-- COMPREHENSIVE KARBON SCHEMA OPTIMIZATION
-- =====================================================
-- This migration optimizes the schema for Karbon API integration
-- by adding missing fields, proper indexes, and linking capabilities
-- =====================================================

-- =====================================================
-- 1. CONTACTS TABLE ENHANCEMENTS
-- =====================================================

-- Add missing Karbon-specific fields to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS karbon_client_group_key text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_since date;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS referral_source text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS accounting_detail jsonb DEFAULT '{}';

-- Create index on karbon_contact_key for fast lookups
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_key ON contacts(karbon_contact_key) WHERE karbon_contact_key IS NOT NULL;

-- Create index on primary_email for matching
CREATE INDEX IF NOT EXISTS idx_contacts_primary_email ON contacts(primary_email) WHERE primary_email IS NOT NULL;

-- =====================================================
-- 2. ORGANIZATIONS TABLE ENHANCEMENTS
-- =====================================================

-- Add missing Karbon-specific fields to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS karbon_client_group_key text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS karbon_organization_url text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS client_since date;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referral_source text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS accounting_detail jsonb DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- Create index on karbon_organization_key for fast lookups
CREATE INDEX IF NOT EXISTS idx_organizations_karbon_key ON organizations(karbon_organization_key) WHERE karbon_organization_key IS NOT NULL;

-- Create index on primary_email for matching
CREATE INDEX IF NOT EXISTS idx_organizations_primary_email ON organizations(primary_email) WHERE primary_email IS NOT NULL;

-- =====================================================
-- 3. WORK_ITEMS TABLE ENHANCEMENTS
-- =====================================================

-- Add missing Karbon-specific fields to work_items
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS karbon_client_group_key text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS karbon_assignee_key text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS karbon_work_type_key text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS karbon_client_manager_key text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS karbon_client_owner_key text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assignee_name text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assignee_email text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS client_group_name text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS deadline_date date;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS todo_period date;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS user_role_assignments jsonb DEFAULT '[]';
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS fee_settings jsonb DEFAULT '{}';

-- Create indexes for Karbon keys
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_key ON work_items(karbon_work_item_key) WHERE karbon_work_item_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_client_key ON work_items(karbon_client_key) WHERE karbon_client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_assignee_key ON work_items(karbon_assignee_key) WHERE karbon_assignee_key IS NOT NULL;

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_workflow_status ON work_items(workflow_status) WHERE workflow_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_work_type ON work_items(work_type) WHERE work_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_client_type ON work_items(client_type) WHERE client_type IS NOT NULL;

-- =====================================================
-- 4. TEAM_MEMBERS TABLE ENHANCEMENTS
-- =====================================================

-- Add index on karbon_user_key for fast lookups
CREATE INDEX IF NOT EXISTS idx_team_members_karbon_key ON team_members(karbon_user_key) WHERE karbon_user_key IS NOT NULL;

-- Add index on email for matching
CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(email) WHERE email IS NOT NULL;

-- =====================================================
-- 5. CLIENT_GROUPS TABLE ENHANCEMENTS  
-- =====================================================

-- Create index on karbon_client_group_key
CREATE INDEX IF NOT EXISTS idx_client_groups_karbon_key ON client_groups(karbon_client_group_key) WHERE karbon_client_group_key IS NOT NULL;

-- =====================================================
-- 6. HELPER FUNCTIONS FOR KARBON KEY RESOLUTION
-- =====================================================

-- Function to resolve karbon_client_key to internal contact_id or organization_id
CREATE OR REPLACE FUNCTION resolve_karbon_client_key(
  p_karbon_client_key text,
  p_client_type text DEFAULT NULL
) RETURNS TABLE(contact_id uuid, organization_id uuid, resolved_type text) AS $$
BEGIN
  -- If client_type is specified, search that table first
  IF p_client_type = 'Contact' OR p_client_type = 'Person' THEN
    RETURN QUERY
    SELECT c.id as contact_id, NULL::uuid as organization_id, 'Contact'::text as resolved_type
    FROM contacts c
    WHERE c.karbon_contact_key = p_karbon_client_key
    LIMIT 1;
    
    IF FOUND THEN RETURN; END IF;
  END IF;
  
  IF p_client_type = 'Organization' OR p_client_type = 'Company' THEN
    RETURN QUERY
    SELECT NULL::uuid as contact_id, o.id as organization_id, 'Organization'::text as resolved_type
    FROM organizations o
    WHERE o.karbon_organization_key = p_karbon_client_key
    LIMIT 1;
    
    IF FOUND THEN RETURN; END IF;
  END IF;
  
  -- If no client_type specified or not found, search both tables
  -- First try contacts
  RETURN QUERY
  SELECT c.id as contact_id, NULL::uuid as organization_id, 'Contact'::text as resolved_type
  FROM contacts c
  WHERE c.karbon_contact_key = p_karbon_client_key
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- Then try organizations
  RETURN QUERY
  SELECT NULL::uuid as contact_id, o.id as organization_id, 'Organization'::text as resolved_type
  FROM organizations o
  WHERE o.karbon_organization_key = p_karbon_client_key
  LIMIT 1;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to resolve karbon_user_key to internal team_member_id
CREATE OR REPLACE FUNCTION resolve_karbon_user_key(p_karbon_user_key text) 
RETURNS uuid AS $$
DECLARE
  v_team_member_id uuid;
BEGIN
  SELECT id INTO v_team_member_id
  FROM team_members
  WHERE karbon_user_key = p_karbon_user_key
  LIMIT 1;
  
  RETURN v_team_member_id;
END;
$$ LANGUAGE plpgsql;

-- Function to resolve karbon_work_type_key to internal work_type_id
CREATE OR REPLACE FUNCTION resolve_karbon_work_type_key(p_karbon_work_type_key text) 
RETURNS uuid AS $$
DECLARE
  v_work_type_id uuid;
BEGIN
  SELECT id INTO v_work_type_id
  FROM work_types
  WHERE karbon_work_type_key = p_karbon_work_type_key
  LIMIT 1;
  
  RETURN v_work_type_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. TRIGGER TO AUTO-LINK WORK ITEMS ON INSERT/UPDATE
-- =====================================================

CREATE OR REPLACE FUNCTION link_work_item_references()
RETURNS TRIGGER AS $$
DECLARE
  v_resolved RECORD;
BEGIN
  -- Resolve client reference if karbon_client_key is set but contact_id/organization_id is not
  IF NEW.karbon_client_key IS NOT NULL AND NEW.contact_id IS NULL AND NEW.organization_id IS NULL THEN
    SELECT * INTO v_resolved FROM resolve_karbon_client_key(NEW.karbon_client_key, NEW.client_type);
    IF v_resolved IS NOT NULL THEN
      NEW.contact_id := v_resolved.contact_id;
      NEW.organization_id := v_resolved.organization_id;
    END IF;
  END IF;
  
  -- Resolve assignee reference if karbon_assignee_key is set but assignee_id is not
  IF NEW.karbon_assignee_key IS NOT NULL AND NEW.assignee_id IS NULL THEN
    NEW.assignee_id := resolve_karbon_user_key(NEW.karbon_assignee_key);
  END IF;
  
  -- Resolve work type reference if karbon_work_type_key is set but work_type_id is not
  IF NEW.karbon_work_type_key IS NOT NULL AND NEW.work_type_id IS NULL THEN
    NEW.work_type_id := resolve_karbon_work_type_key(NEW.karbon_work_type_key);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop first if exists to avoid conflicts)
DROP TRIGGER IF EXISTS trg_link_work_item_references ON work_items;
CREATE TRIGGER trg_link_work_item_references
  BEFORE INSERT OR UPDATE ON work_items
  FOR EACH ROW
  EXECUTE FUNCTION link_work_item_references();

-- =====================================================
-- 8. PROCEDURE TO BATCH LINK EXISTING RECORDS
-- =====================================================

CREATE OR REPLACE PROCEDURE batch_link_work_items()
LANGUAGE plpgsql AS $$
DECLARE
  v_work_item RECORD;
  v_resolved RECORD;
  v_updated_count integer := 0;
BEGIN
  -- Update work items that have karbon_client_key but no contact_id/organization_id
  FOR v_work_item IN 
    SELECT id, karbon_client_key, client_type 
    FROM work_items 
    WHERE karbon_client_key IS NOT NULL 
      AND contact_id IS NULL 
      AND organization_id IS NULL
  LOOP
    SELECT * INTO v_resolved FROM resolve_karbon_client_key(v_work_item.karbon_client_key, v_work_item.client_type);
    IF v_resolved IS NOT NULL THEN
      UPDATE work_items 
      SET contact_id = v_resolved.contact_id,
          organization_id = v_resolved.organization_id,
          updated_at = NOW()
      WHERE id = v_work_item.id;
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Updated % work items with client references', v_updated_count;
  
  -- Update work items that have karbon_assignee_key but no assignee_id
  v_updated_count := 0;
  UPDATE work_items w
  SET assignee_id = (SELECT id FROM team_members tm WHERE tm.karbon_user_key = w.karbon_assignee_key LIMIT 1),
      updated_at = NOW()
  WHERE karbon_assignee_key IS NOT NULL
    AND assignee_id IS NULL
    AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.karbon_user_key = w.karbon_assignee_key);
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % work items with assignee references', v_updated_count;
  
END;
$$;

-- =====================================================
-- 9. VIEW FOR UNIFIED CLIENT LOOKUP
-- =====================================================

CREATE OR REPLACE VIEW v_karbon_clients AS
SELECT 
  karbon_contact_key as karbon_key,
  id as internal_id,
  'Contact' as client_type,
  COALESCE(first_name || ' ' || last_name, primary_email, 'Unknown') as display_name,
  primary_email as email,
  contact_type as entity_type,
  created_at,
  updated_at
FROM contacts
WHERE karbon_contact_key IS NOT NULL

UNION ALL

SELECT 
  karbon_organization_key as karbon_key,
  id as internal_id,
  'Organization' as client_type,
  name as display_name,
  primary_email as email,
  entity_type,
  created_at,
  updated_at
FROM organizations
WHERE karbon_organization_key IS NOT NULL;

-- =====================================================
-- 10. COMMENT DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN contacts.karbon_contact_key IS 'Karbon API ContactKey - alphanumeric string identifier';
COMMENT ON COLUMN organizations.karbon_organization_key IS 'Karbon API OrganizationKey - alphanumeric string identifier';
COMMENT ON COLUMN work_items.karbon_work_item_key IS 'Karbon API WorkItemKey - alphanumeric string identifier';
COMMENT ON COLUMN work_items.karbon_client_key IS 'Karbon API ClientKey - can reference either Contact or Organization based on client_type';
COMMENT ON COLUMN work_items.client_type IS 'Indicates whether karbon_client_key refers to Contact or Organization';

COMMENT ON FUNCTION resolve_karbon_client_key IS 'Resolves a Karbon ClientKey to internal contact_id or organization_id';
COMMENT ON FUNCTION resolve_karbon_user_key IS 'Resolves a Karbon UserKey to internal team_member_id';
COMMENT ON PROCEDURE batch_link_work_items IS 'Batch links existing work items to their corresponding contacts/organizations/team members';
COMMENT ON VIEW v_karbon_clients IS 'Unified view of all Karbon clients (contacts + organizations) for easy lookup';
