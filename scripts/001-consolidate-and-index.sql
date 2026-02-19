-- ============================================================
-- 001-consolidate-and-index.sql
-- Adds FK constraints, performance indexes, mapping views,
-- and the debrief_comments table.
-- ============================================================

-- ============================================================
-- 1. FOREIGN KEY CONSTRAINTS on debriefs
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debriefs_team_member_id_fkey') THEN
    ALTER TABLE debriefs ADD CONSTRAINT debriefs_team_member_id_fkey
      FOREIGN KEY (team_member_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debriefs_created_by_id_fkey') THEN
    ALTER TABLE debriefs ADD CONSTRAINT debriefs_created_by_id_fkey
      FOREIGN KEY (created_by_id) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debriefs_contact_id_fkey') THEN
    ALTER TABLE debriefs ADD CONSTRAINT debriefs_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debriefs_organization_id_fkey') THEN
    ALTER TABLE debriefs ADD CONSTRAINT debriefs_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debriefs_work_item_id_fkey') THEN
    ALTER TABLE debriefs ADD CONSTRAINT debriefs_work_item_id_fkey
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL;
  END IF;
END$$;


-- ============================================================
-- 2. CREATE debrief_comments TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS debrief_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  debrief_id uuid NOT NULL REFERENCES debriefs(id) ON DELETE CASCADE,
  author_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
  author_name text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debrief_comments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'debrief_comments_allow_all') THEN
    CREATE POLICY debrief_comments_allow_all ON debrief_comments FOR ALL USING (true);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_debrief_comments_debrief ON debrief_comments (debrief_id);
CREATE INDEX IF NOT EXISTS idx_debrief_comments_author ON debrief_comments (author_id);


-- ============================================================
-- 3. PERFORMANCE INDEXES
-- ============================================================

-- contacts
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_key ON contacts (karbon_contact_key);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts (status);
CREATE INDEX IF NOT EXISTS idx_contacts_full_name ON contacts (full_name);
CREATE INDEX IF NOT EXISTS idx_contacts_client_owner_key ON contacts (client_owner_key);

-- organizations
CREATE INDEX IF NOT EXISTS idx_orgs_karbon_key ON organizations (karbon_organization_key);
CREATE INDEX IF NOT EXISTS idx_orgs_name ON organizations (name);
CREATE INDEX IF NOT EXISTS idx_orgs_client_owner_key ON organizations (client_owner_key);

-- work_items (most heavily queried)
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_key ON work_items (karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items (status);
CREATE INDEX IF NOT EXISTS idx_work_items_workflow_status ON work_items (workflow_status);
CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items (due_date);
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_client_key ON work_items (karbon_client_key);
CREATE INDEX IF NOT EXISTS idx_work_items_contact_id ON work_items (contact_id);
CREATE INDEX IF NOT EXISTS idx_work_items_organization_id ON work_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee_key ON work_items (assignee_key);
CREATE INDEX IF NOT EXISTS idx_work_items_work_type ON work_items (work_type);
CREATE INDEX IF NOT EXISTS idx_work_items_client_name ON work_items (client_name);
CREATE INDEX IF NOT EXISTS idx_work_items_primary_status ON work_items (primary_status);
CREATE INDEX IF NOT EXISTS idx_work_items_client_group_key ON work_items (client_group_key);

-- karbon_tasks
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_key ON karbon_tasks (karbon_task_key);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_work_item_key ON karbon_tasks (karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_status ON karbon_tasks (status);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_assignee_key ON karbon_tasks (assignee_key);

-- karbon_timesheets
CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_key ON karbon_timesheets (karbon_timesheet_key);
CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_work_item_key ON karbon_timesheets (karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_user_key ON karbon_timesheets (user_key);
CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_date ON karbon_timesheets (date);

-- karbon_invoices
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_key ON karbon_invoices (karbon_invoice_key);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_work_item_key ON karbon_invoices (karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_client_key ON karbon_invoices (client_key);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_status ON karbon_invoices (status);

-- karbon_notes
CREATE INDEX IF NOT EXISTS idx_karbon_notes_key ON karbon_notes (karbon_note_key);
CREATE INDEX IF NOT EXISTS idx_karbon_notes_work_item_key ON karbon_notes (karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_notes_contact_key ON karbon_notes (karbon_contact_key);

-- debriefs
CREATE INDEX IF NOT EXISTS idx_debriefs_team_member ON debriefs (team_member_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_created_by ON debriefs (created_by_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_contact ON debriefs (contact_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_organization ON debriefs (organization_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_work_item ON debriefs (work_item_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_date ON debriefs (debrief_date);
CREATE INDEX IF NOT EXISTS idx_debriefs_karbon_key ON debriefs (karbon_client_key);
CREATE INDEX IF NOT EXISTS idx_debriefs_created_at ON debriefs (created_at);

-- team_members
CREATE INDEX IF NOT EXISTS idx_team_members_karbon_key ON team_members (karbon_user_key);
CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members (email);
CREATE INDEX IF NOT EXISTS idx_team_members_auth_user ON team_members (auth_user_id);

-- client_groups
CREATE INDEX IF NOT EXISTS idx_client_groups_karbon_key ON client_groups (karbon_client_group_key);

-- tasks (app-level)
CREATE INDEX IF NOT EXISTS idx_tasks_work_item ON tasks (work_item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date);

-- sync_log
CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log (started_at);
CREATE INDEX IF NOT EXISTS idx_sync_log_type ON sync_log (sync_type);

-- activity_log
CREATE INDEX IF NOT EXISTS idx_activity_log_team_member ON activity_log (team_member_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at);


-- ============================================================
-- 4. CONSOLIDATED MAPPING VIEWS
-- ============================================================

-- debriefs_full: the single source of truth for debrief queries
CREATE OR REPLACE VIEW debriefs_full AS
SELECT
  d.*,
  tm.full_name  AS team_member_full_name,
  tm.avatar_url AS team_member_avatar_url,
  cb.full_name  AS created_by_full_name,
  cb.avatar_url AS created_by_avatar_url,
  c.full_name   AS contact_full_name,
  o.name        AS organization_display_name,
  wi.title      AS work_item_title,
  wi.client_name AS work_item_client_name,
  wi.karbon_url  AS work_item_karbon_url
FROM debriefs d
LEFT JOIN team_members tm ON d.team_member_id = tm.id
LEFT JOIN team_members cb ON d.created_by_id  = cb.id
LEFT JOIN contacts     c  ON d.contact_id      = c.id
LEFT JOIN organizations o ON d.organization_id  = o.id
LEFT JOIN work_items  wi  ON d.work_item_id     = wi.id;


-- work_items_enriched: pre-joined view for dashboards
CREATE OR REPLACE VIEW work_items_enriched AS
SELECT
  wi.*,
  c.full_name              AS contact_full_name,
  c.primary_email          AS contact_email,
  o.name                   AS org_name,
  o.primary_email          AS org_email,
  tm_assignee.full_name    AS assignee_full_name,
  tm_manager.full_name     AS manager_full_name,
  tm_owner.full_name       AS owner_full_name
FROM work_items wi
LEFT JOIN contacts      c           ON wi.contact_id         = c.id
LEFT JOIN organizations o           ON wi.organization_id    = o.id
LEFT JOIN team_members  tm_assignee ON wi.assignee_key       = tm_assignee.karbon_user_key
LEFT JOIN team_members  tm_manager  ON wi.client_manager_key = tm_manager.karbon_user_key
LEFT JOIN team_members  tm_owner    ON wi.client_owner_key   = tm_owner.karbon_user_key;


-- clients_unified: single view of contacts + organizations
CREATE OR REPLACE VIEW clients_unified AS
SELECT
  id,
  karbon_contact_key AS karbon_key,
  full_name          AS name,
  'contact'          AS client_type,
  primary_email,
  phone_primary      AS phone,
  city, state, status,
  client_owner_key, client_manager_key,
  avatar_url,
  karbon_url,
  last_synced_at
FROM contacts
WHERE status = 'Active'
UNION ALL
SELECT
  id,
  karbon_organization_key AS karbon_key,
  name,
  'organization'          AS client_type,
  primary_email,
  phone,
  city, state, NULL AS status,
  client_owner_key, client_manager_key,
  NULL AS avatar_url,
  karbon_url,
  last_synced_at
FROM organizations;


-- karbon_sync_health: monitoring view for sync status
CREATE OR REPLACE VIEW karbon_sync_health AS
SELECT 'contacts' AS entity, COUNT(*) AS total_records, MAX(last_synced_at) AS last_sync,
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') AS synced_last_24h
FROM contacts
UNION ALL
SELECT 'organizations', COUNT(*), MAX(last_synced_at),
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') FROM organizations
UNION ALL
SELECT 'work_items', COUNT(*), MAX(last_synced_at),
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') FROM work_items
UNION ALL
SELECT 'karbon_tasks', COUNT(*), MAX(last_synced_at),
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') FROM karbon_tasks
UNION ALL
SELECT 'karbon_timesheets', COUNT(*), MAX(last_synced_at),
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') FROM karbon_timesheets
UNION ALL
SELECT 'karbon_invoices', COUNT(*), MAX(last_synced_at),
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') FROM karbon_invoices
UNION ALL
SELECT 'karbon_notes', COUNT(*), MAX(last_synced_at),
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') FROM karbon_notes
UNION ALL
SELECT 'team_members', COUNT(*), MAX(last_synced_at),
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') FROM team_members
UNION ALL
SELECT 'client_groups', COUNT(*), MAX(last_synced_at),
  COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '1 day') FROM client_groups;
