-- Link debriefs to contacts, organizations, work_items, and team members
-- This migration uses multiple matching strategies to link records

-- Step 1: Link debriefs to contacts via karbon_client_key (when client_type is 'Contact')
UPDATE debriefs d
SET contact_id = c.id
FROM contacts c
WHERE d.contact_id IS NULL
  AND d.karbon_client_key IS NOT NULL
  AND d.karbon_client_key = c.karbon_contact_key
  AND (d.client_type = 'Contact' OR d.client_type IS NULL);

-- Step 2: Link debriefs to organizations via karbon_client_key (when client_type is 'Organization')
UPDATE debriefs d
SET organization_id = o.id
FROM organizations o
WHERE d.organization_id IS NULL
  AND d.karbon_client_key IS NOT NULL
  AND d.karbon_client_key = o.karbon_organization_key
  AND d.client_type = 'Organization';

-- Step 3: Link debriefs to contacts by matching contact_name to full_name
UPDATE debriefs d
SET contact_id = c.id
FROM contacts c
WHERE d.contact_id IS NULL
  AND d.contact_name IS NOT NULL
  AND d.contact_name != ''
  AND LOWER(TRIM(d.contact_name)) = LOWER(TRIM(c.full_name));

-- Step 4: Link debriefs to organizations by matching organization_name to name
UPDATE debriefs d
SET organization_id = o.id
FROM organizations o
WHERE d.organization_id IS NULL
  AND d.organization_name IS NOT NULL
  AND d.organization_name != ''
  AND LOWER(TRIM(d.organization_name)) = LOWER(TRIM(o.name));

-- Step 5: Link debriefs to contacts via karbon_contact_url
UPDATE debriefs d
SET contact_id = c.id
FROM contacts c
WHERE d.contact_id IS NULL
  AND d.karbon_contact_url IS NOT NULL
  AND c.karbon_contact_url IS NOT NULL
  AND d.karbon_contact_url = c.karbon_contact_url;

-- Step 6: Link debriefs to work_items by matching title pattern and tax_year
-- Match work items by client + tax year + work type pattern
UPDATE debriefs d
SET work_item_id = w.id
FROM work_items w
WHERE d.work_item_id IS NULL
  AND d.tax_year IS NOT NULL
  AND w.tax_year = d.tax_year
  AND (
    (d.contact_id IS NOT NULL AND w.contact_id = d.contact_id)
    OR (d.organization_id IS NOT NULL AND w.organization_id = d.organization_id)
  )
  AND w.work_type ILIKE '%1040%'  -- Tax returns typically
  AND d.debrief_type IN ('Tax', 'Tax Return', '1040');

-- Step 7: Link debriefs to client_manager team member
UPDATE debriefs d
SET client_manager_id = t.id
FROM team_members t
WHERE d.client_manager_id IS NULL
  AND d.client_manager_name IS NOT NULL
  AND d.client_manager_name != ''
  AND LOWER(TRIM(d.client_manager_name)) = LOWER(TRIM(t.full_name));

-- Step 8: Link debriefs to client_owner team member
UPDATE debriefs d
SET client_owner_id = t.id
FROM team_members t
WHERE d.client_owner_id IS NULL
  AND d.client_owner_name IS NOT NULL
  AND d.client_owner_name != ''
  AND LOWER(TRIM(d.client_owner_name)) = LOWER(TRIM(t.full_name));

-- Step 9: Link debriefs to client_groups via contact or organization
UPDATE debriefs d
SET client_group_id = cgm.client_group_id
FROM client_group_members cgm
WHERE d.client_group_id IS NULL
  AND d.contact_id IS NOT NULL
  AND cgm.contact_id = d.contact_id
  AND cgm.is_primary = true;

-- Step 10: Create indexes for better query performance on debriefs
CREATE INDEX IF NOT EXISTS idx_debriefs_contact_id ON debriefs(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debriefs_organization_id ON debriefs(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debriefs_work_item_id ON debriefs(work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debriefs_client_group_id ON debriefs(client_group_id) WHERE client_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debriefs_karbon_client_key ON debriefs(karbon_client_key) WHERE karbon_client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debriefs_tax_year ON debriefs(tax_year) WHERE tax_year IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debriefs_debrief_date ON debriefs(debrief_date) WHERE debrief_date IS NOT NULL;

-- Step 11: Create a function to automatically link new debriefs
CREATE OR REPLACE FUNCTION link_debrief_to_clients()
RETURNS TRIGGER AS $$
BEGIN
  -- Try to link to contact via karbon_client_key
  IF NEW.contact_id IS NULL AND NEW.karbon_client_key IS NOT NULL AND (NEW.client_type = 'Contact' OR NEW.client_type IS NULL) THEN
    SELECT id INTO NEW.contact_id
    FROM contacts
    WHERE karbon_contact_key = NEW.karbon_client_key
    LIMIT 1;
  END IF;

  -- Try to link to organization via karbon_client_key
  IF NEW.organization_id IS NULL AND NEW.karbon_client_key IS NOT NULL AND NEW.client_type = 'Organization' THEN
    SELECT id INTO NEW.organization_id
    FROM organizations
    WHERE karbon_organization_key = NEW.karbon_client_key
    LIMIT 1;
  END IF;

  -- Try to link to contact by name
  IF NEW.contact_id IS NULL AND NEW.contact_name IS NOT NULL AND NEW.contact_name != '' THEN
    SELECT id INTO NEW.contact_id
    FROM contacts
    WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(NEW.contact_name))
    LIMIT 1;
  END IF;

  -- Try to link to organization by name
  IF NEW.organization_id IS NULL AND NEW.organization_name IS NOT NULL AND NEW.organization_name != '' THEN
    SELECT id INTO NEW.organization_id
    FROM organizations
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.organization_name))
    LIMIT 1;
  END IF;

  -- Try to link to client_manager
  IF NEW.client_manager_id IS NULL AND NEW.client_manager_name IS NOT NULL AND NEW.client_manager_name != '' THEN
    SELECT id INTO NEW.client_manager_id
    FROM team_members
    WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(NEW.client_manager_name))
    LIMIT 1;
  END IF;

  -- Try to link to client_owner
  IF NEW.client_owner_id IS NULL AND NEW.client_owner_name IS NOT NULL AND NEW.client_owner_name != '' THEN
    SELECT id INTO NEW.client_owner_id
    FROM team_members
    WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(NEW.client_owner_name))
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-link debriefs on insert/update
DROP TRIGGER IF EXISTS trigger_link_debrief ON debriefs;
CREATE TRIGGER trigger_link_debrief
  BEFORE INSERT OR UPDATE ON debriefs
  FOR EACH ROW
  EXECUTE FUNCTION link_debrief_to_clients();

-- Step 12: Create a view for easier querying of debriefs with linked data
CREATE OR REPLACE VIEW v_debriefs_with_clients AS
SELECT 
  d.*,
  c.full_name AS linked_contact_name,
  c.primary_email AS contact_email,
  c.phone_primary AS contact_phone,
  o.name AS linked_organization_name,
  o.primary_email AS organization_email,
  w.title AS work_item_title,
  w.workflow_status AS work_item_status,
  w.work_type AS work_item_type,
  cg.name AS client_group_name,
  cm.full_name AS linked_client_manager,
  co.full_name AS linked_client_owner
FROM debriefs d
LEFT JOIN contacts c ON d.contact_id = c.id
LEFT JOIN organizations o ON d.organization_id = o.id
LEFT JOIN work_items w ON d.work_item_id = w.id
LEFT JOIN client_groups cg ON d.client_group_id = cg.id
LEFT JOIN team_members cm ON d.client_manager_id = cm.id
LEFT JOIN team_members co ON d.client_owner_id = co.id;

-- Grant access to the view
GRANT SELECT ON v_debriefs_with_clients TO authenticated;
GRANT SELECT ON v_debriefs_with_clients TO anon;
