-- ============================================================================
-- Migration 021: Optimize All Karbon-Synced Tables
-- 
-- This migration:
--   1. Removes 12 duplicate/redundant indexes (save storage, speed writes)
--   2. Adds missing columns to 6 tables for full Karbon API field coverage
--   3. Adds 15+ missing indexes for incremental sync & query performance
--   4. Adds composite indexes for common query patterns
-- ============================================================================

-- ============================================================================
-- PART 1: REMOVE DUPLICATE INDEXES
-- ============================================================================

-- contacts: has 4 indexes on karbon_contact_key, only need the UNIQUE constraint
DROP INDEX IF EXISTS idx_contacts_karbon_contact_key;
DROP INDEX IF EXISTS idx_contacts_karbon_key;
-- Keep: contacts_karbon_contact_key_key (the UNIQUE constraint)
-- Also drop the partial unique index (redundant with the full UNIQUE)
DROP INDEX IF EXISTS contacts_karbon_contact_key_idx;

-- organizations: has 4 indexes on karbon_organization_key, only need 1
DROP INDEX IF EXISTS idx_organizations_karbon_key;
DROP INDEX IF EXISTS idx_organizations_karbon_org_key;
DROP INDEX IF EXISTS idx_orgs_karbon_organization_key;
-- Keep: organizations_karbon_organization_key_key (the UNIQUE constraint)

-- karbon_tasks: duplicate work_item index
DROP INDEX IF EXISTS idx_karbon_tasks_work_item_key;
-- Keep: idx_karbon_tasks_work_item

-- karbon_timesheets: duplicate user and work_item indexes
DROP INDEX IF EXISTS idx_karbon_timesheets_user_key;
DROP INDEX IF EXISTS idx_karbon_timesheets_work_item_key;
-- Keep: idx_karbon_timesheets_user, idx_karbon_timesheets_work_item

-- karbon_notes: duplicate contact and work_item indexes
DROP INDEX IF EXISTS idx_karbon_notes_contact_key;
DROP INDEX IF EXISTS idx_karbon_notes_work_item_key;
-- Keep: idx_karbon_notes_contact, idx_karbon_notes_work_item

-- busy_season_work_items: plain index redundant with UNIQUE constraint
DROP INDEX IF EXISTS idx_busy_season_karbon_key;
-- Keep: busy_season_work_items_karbon_work_key_key (UNIQUE)

-- work_items: plain index redundant with UNIQUE constraint
DROP INDEX IF EXISTS idx_work_items_karbon_key;
-- Keep: work_items_karbon_work_item_key_key (UNIQUE)


-- ============================================================================
-- PART 2: ADD MISSING COLUMNS FOR FULL KARBON API COVERAGE
-- ============================================================================

-- --- client_groups: currently missing almost all Karbon fields ---
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS primary_contact_key text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS primary_contact_name text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS client_owner_key text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS client_owner_name text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS client_manager_key text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS client_manager_name text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS members jsonb DEFAULT '[]'::jsonb;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS restriction_level text DEFAULT 'Public';
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS user_defined_identifier text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS entity_description text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS karbon_url text;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS karbon_created_at timestamptz;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS karbon_modified_at timestamptz;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- --- contacts: add missing Karbon API fields ---
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS middle_name text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS salutation text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS suffix text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_owner_key text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_manager_key text;

-- --- organizations: add Karbon key references for owner/manager ---
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS client_owner_key text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS client_manager_key text;

-- --- work_items: add denormalized display fields and Karbon key references ---
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assignee_key text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assignee_name text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS work_status_key text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS client_owner_key text;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS client_manager_key text;

-- --- team_members: add sync tracking ---
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS karbon_url text;

-- --- work_status: add the raw Karbon primary/secondary names ---
ALTER TABLE work_status ADD COLUMN IF NOT EXISTS primary_status_name text;
ALTER TABLE work_status ADD COLUMN IF NOT EXISTS secondary_status_name text;


-- ============================================================================
-- PART 3: ADD MISSING INDEXES FOR PERFORMANCE
-- ============================================================================

-- --- Incremental sync indexes (every Karbon-synced table needs karbon_modified_at) ---
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_modified 
  ON contacts (karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_karbon_modified 
  ON organizations (karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_karbon_modified 
  ON work_items (karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_groups_karbon_modified
  ON client_groups (karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_karbon_tasks_modified
  ON karbon_tasks (karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_modified
  ON karbon_timesheets (karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_karbon_notes_modified
  ON karbon_notes (karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_karbon_invoices_modified
  ON karbon_invoices (karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;

-- --- Work Items query indexes ---
CREATE INDEX IF NOT EXISTS idx_work_items_work_status_key
  ON work_items (work_status_key) WHERE work_status_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_client_group
  ON work_items (client_group_key) WHERE client_group_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_assignee_key
  ON work_items (assignee_key) WHERE assignee_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_client_name
  ON work_items (client_name) WHERE client_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_deadline
  ON work_items (deadline_date) WHERE deadline_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_start_date
  ON work_items (start_date) WHERE start_date IS NOT NULL;

-- Composite: active work items by type and status (common dashboard query)
CREATE INDEX IF NOT EXISTS idx_work_items_type_status
  ON work_items (work_type, primary_status);

-- --- Organizations: full_name for search ---
CREATE INDEX IF NOT EXISTS idx_organizations_full_name
  ON organizations (full_name) WHERE full_name IS NOT NULL;

-- --- Team Members: lookup by email and name ---
CREATE INDEX IF NOT EXISTS idx_team_members_email
  ON team_members (email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_name
  ON team_members (name) WHERE name IS NOT NULL;

-- --- Karbon Invoices: additional lookup ---
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_client_name
  ON karbon_invoices (client_name) WHERE client_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_karbon_invoices_due_date
  ON karbon_invoices (due_date) WHERE due_date IS NOT NULL;

-- --- Karbon Timesheets: composite for time reporting ---
CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_date_user
  ON karbon_timesheets (date, user_key);

-- --- Client Groups: lookup indexes ---
CREATE INDEX IF NOT EXISTS idx_client_groups_name
  ON client_groups (name) WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_groups_udi
  ON client_groups (user_defined_identifier) WHERE user_defined_identifier IS NOT NULL;

-- --- Sync Log: direction filter ---
CREATE INDEX IF NOT EXISTS idx_sync_log_direction
  ON sync_log (sync_direction) WHERE sync_direction IS NOT NULL;

-- --- Contacts: owner/manager key lookups for linking ---
CREATE INDEX IF NOT EXISTS idx_contacts_client_owner_key
  ON contacts (client_owner_key) WHERE client_owner_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_client_manager_key
  ON contacts (client_manager_key) WHERE client_manager_key IS NOT NULL;

-- --- Organizations: owner/manager key lookups ---
CREATE INDEX IF NOT EXISTS idx_organizations_client_owner_key
  ON organizations (client_owner_key) WHERE client_owner_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_client_manager_key
  ON organizations (client_manager_key) WHERE client_manager_key IS NOT NULL;
