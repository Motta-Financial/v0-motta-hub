-- Add foreign key constraints for work_items table
-- These link work_items to contacts, organizations, client_groups, and team_members

-- First, let's add indexes on Karbon keys for fast lookups across tables
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_key ON contacts(karbon_contact_key) WHERE karbon_contact_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_karbon_key ON organizations(karbon_organization_key) WHERE karbon_organization_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_key ON work_items(karbon_work_item_key) WHERE karbon_work_item_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_client_key ON work_items(karbon_client_key) WHERE karbon_client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_groups_karbon_key ON client_groups(karbon_client_group_key) WHERE karbon_client_group_key IS NOT NULL;

-- Add foreign key constraints (only if they don't exist)
-- work_items -> contacts
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_contact'
  ) THEN
    ALTER TABLE work_items 
    ADD CONSTRAINT fk_work_items_contact 
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- work_items -> organizations
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_organization'
  ) THEN
    ALTER TABLE work_items 
    ADD CONSTRAINT fk_work_items_organization 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- work_items -> client_groups
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_client_group'
  ) THEN
    ALTER TABLE work_items 
    ADD CONSTRAINT fk_work_items_client_group 
    FOREIGN KEY (client_group_id) REFERENCES client_groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- work_items -> team_members (assignee)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_assignee'
  ) THEN
    ALTER TABLE work_items 
    ADD CONSTRAINT fk_work_items_assignee 
    FOREIGN KEY (assignee_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- work_items -> team_members (client_manager)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_client_manager'
  ) THEN
    ALTER TABLE work_items 
    ADD CONSTRAINT fk_work_items_client_manager 
    FOREIGN KEY (client_manager_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- work_items -> team_members (client_owner)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_client_owner'
  ) THEN
    ALTER TABLE work_items 
    ADD CONSTRAINT fk_work_items_client_owner 
    FOREIGN KEY (client_owner_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- work_items -> work_types
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_work_type'
  ) THEN
    ALTER TABLE work_items 
    ADD CONSTRAINT fk_work_items_work_type 
    FOREIGN KEY (work_type_id) REFERENCES work_types(id) ON DELETE SET NULL;
  END IF;
END $$;

-- contacts -> team_members (client_manager and client_owner)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_contacts_client_manager'
  ) THEN
    ALTER TABLE contacts 
    ADD CONSTRAINT fk_contacts_client_manager 
    FOREIGN KEY (client_manager_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_contacts_client_owner'
  ) THEN
    ALTER TABLE contacts 
    ADD CONSTRAINT fk_contacts_client_owner 
    FOREIGN KEY (client_owner_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- client_groups -> contacts (primary_contact)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_client_groups_primary_contact'
  ) THEN
    ALTER TABLE client_groups 
    ADD CONSTRAINT fk_client_groups_primary_contact 
    FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- client_groups -> team_members (client_manager and client_owner)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_client_groups_client_manager'
  ) THEN
    ALTER TABLE client_groups 
    ADD CONSTRAINT fk_client_groups_client_manager 
    FOREIGN KEY (client_manager_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_client_groups_client_owner'
  ) THEN
    ALTER TABLE client_groups 
    ADD CONSTRAINT fk_client_groups_client_owner 
    FOREIGN KEY (client_owner_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_work_items_status_due_date ON work_items(status, due_date);
CREATE INDEX IF NOT EXISTS idx_work_items_workflow_status ON work_items(workflow_status);
CREATE INDEX IF NOT EXISTS idx_work_items_contact_id ON work_items(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_organization_id ON work_items(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_primary_email ON contacts(primary_email) WHERE primary_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_primary_email ON organizations(primary_email) WHERE primary_email IS NOT NULL;
