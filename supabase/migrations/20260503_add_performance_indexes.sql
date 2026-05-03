-- ============================================================================
-- Performance Indexes Migration
-- Generated: 2026-05-03
-- Purpose: Add indexes for frequently queried columns to improve query performance
-- ============================================================================

-- Work Items - heavily queried table
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_primary_status ON work_items(primary_status);
CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items(due_date);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee_name ON work_items(assignee_name);
CREATE INDEX IF NOT EXISTS idx_work_items_work_type ON work_items(work_type);
CREATE INDEX IF NOT EXISTS idx_work_items_client_name ON work_items(client_name);
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_work_item_key ON work_items(karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_work_items_organization_id ON work_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_work_items_contact_id ON work_items(contact_id);
CREATE INDEX IF NOT EXISTS idx_work_items_created_at ON work_items(created_at DESC);

-- Ignition Invoices - frequently filtered by status and date
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_status ON ignition_invoices(status);
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_invoice_date ON ignition_invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_due_date ON ignition_invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_organization_id ON ignition_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_contact_id ON ignition_invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_ignition_invoices_stripe_invoice_id ON ignition_invoices(stripe_invoice_id);

-- Ignition Proposals - frequently filtered and sorted
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_status ON ignition_proposals(status);
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_sent_at ON ignition_proposals(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_accepted_at ON ignition_proposals(accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_organization_id ON ignition_proposals(organization_id);
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_contact_id ON ignition_proposals(contact_id);
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_total_value ON ignition_proposals(total_value DESC);

-- Debriefs - frequently filtered by date and type
CREATE INDEX IF NOT EXISTS idx_debriefs_debrief_date ON debriefs(debrief_date DESC);
CREATE INDEX IF NOT EXISTS idx_debriefs_debrief_type ON debriefs(debrief_type);
CREATE INDEX IF NOT EXISTS idx_debriefs_status ON debriefs(status);
CREATE INDEX IF NOT EXISTS idx_debriefs_organization_id ON debriefs(organization_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_contact_id ON debriefs(contact_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_team_member_id ON debriefs(team_member_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_work_item_id ON debriefs(work_item_id);
CREATE INDEX IF NOT EXISTS idx_debriefs_created_at ON debriefs(created_at DESC);

-- Organizations - client lookups
CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);
CREATE INDEX IF NOT EXISTS idx_organizations_full_name ON organizations(full_name);
CREATE INDEX IF NOT EXISTS idx_organizations_karbon_organization_key ON organizations(karbon_organization_key);
CREATE INDEX IF NOT EXISTS idx_organizations_state ON organizations(state);
CREATE INDEX IF NOT EXISTS idx_organizations_primary_email ON organizations(primary_email);

-- Contacts - client lookups
CREATE INDEX IF NOT EXISTS idx_contacts_full_name ON contacts(full_name);
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_contact_key ON contacts(karbon_contact_key);
CREATE INDEX IF NOT EXISTS idx_contacts_primary_email ON contacts(primary_email);
CREATE INDEX IF NOT EXISTS idx_contacts_state ON contacts(state);

-- Team Members - frequently joined
CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(email);
CREATE INDEX IF NOT EXISTS idx_team_members_karbon_user_key ON team_members(karbon_user_key);
CREATE INDEX IF NOT EXISTS idx_team_members_is_active ON team_members(is_active);

-- Karbon Tasks - frequently filtered by status and assignee
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_status ON karbon_tasks(status);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_due_date ON karbon_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_assignee_name ON karbon_tasks(assignee_name);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_work_item_id ON karbon_tasks(work_item_id);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_karbon_work_item_key ON karbon_tasks(karbon_work_item_key);

-- Karbon Notes - frequently filtered
CREATE INDEX IF NOT EXISTS idx_karbon_notes_work_item_id ON karbon_notes(work_item_id);
CREATE INDEX IF NOT EXISTS idx_karbon_notes_karbon_work_item_key ON karbon_notes(karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_notes_created_at ON karbon_notes(karbon_created_at DESC);

-- Karbon Invoices - frequently filtered
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_status ON karbon_invoices(status);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_issued_date ON karbon_invoices(issued_date DESC);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_work_item_id ON karbon_invoices(work_item_id);

-- Ignition Clients - matching lookups
CREATE INDEX IF NOT EXISTS idx_ignition_clients_match_status ON ignition_clients(match_status);
CREATE INDEX IF NOT EXISTS idx_ignition_clients_email ON ignition_clients(email);
CREATE INDEX IF NOT EXISTS idx_ignition_clients_name ON ignition_clients(name);

-- Calendly Events - scheduling queries
CREATE INDEX IF NOT EXISTS idx_calendly_events_start_time ON calendly_events(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_calendly_events_status ON calendly_events(status);
CREATE INDEX IF NOT EXISTS idx_calendly_events_team_member_id ON calendly_events(team_member_id);

-- Meetings - scheduling queries  
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_start ON meetings(scheduled_start DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_host_id ON meetings(host_id);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_work_items_status_due_date ON work_items(status, due_date);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee_status ON work_items(assignee_name, status);
CREATE INDEX IF NOT EXISTS idx_ignition_proposals_status_sent_at ON ignition_proposals(status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_debriefs_type_date ON debriefs(debrief_type, debrief_date DESC);

-- ============================================================================
-- NOTE: Run ANALYZE after creating indexes to update query planner statistics
-- ANALYZE work_items;
-- ANALYZE ignition_invoices;
-- ANALYZE ignition_proposals;
-- ANALYZE debriefs;
-- ANALYZE organizations;
-- ANALYZE contacts;
-- ============================================================================
