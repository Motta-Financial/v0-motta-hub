-- Create karbon_invoices table for syncing invoice data from Karbon API
CREATE TABLE IF NOT EXISTS karbon_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  karbon_invoice_key TEXT NOT NULL UNIQUE,
  invoice_number TEXT,
  
  -- Work item linkage
  work_item_id UUID REFERENCES work_items(id) ON DELETE SET NULL,
  karbon_work_item_key TEXT,
  work_item_title TEXT,
  
  -- Client linkage
  client_key TEXT,
  client_name TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  
  -- Financial details
  amount NUMERIC(12,2),
  tax NUMERIC(12,2),
  total_amount NUMERIC(12,2),
  currency TEXT DEFAULT 'USD',
  
  -- Status tracking
  status TEXT, -- Draft, Sent, Paid, Overdue, Void, etc.
  issued_date DATE,
  due_date DATE,
  paid_date DATE,
  
  -- Line items stored as JSON
  line_items JSONB,
  
  -- Karbon metadata
  karbon_url TEXT,
  karbon_created_at TIMESTAMPTZ,
  karbon_modified_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  
  -- Standard timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_work_item_key ON karbon_invoices(karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_client_key ON karbon_invoices(client_key);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_status ON karbon_invoices(status);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_due_date ON karbon_invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_issued_date ON karbon_invoices(issued_date);
CREATE INDEX IF NOT EXISTS idx_karbon_invoices_modified ON karbon_invoices(karbon_modified_at);

-- Also add missing indexes on existing Karbon tables for better sync performance
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_work_item_key ON karbon_tasks(karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_assignee ON karbon_tasks(assignee_key);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_status ON karbon_tasks(status);
CREATE INDEX IF NOT EXISTS idx_karbon_tasks_modified ON karbon_tasks(karbon_modified_at);

CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_work_item_key ON karbon_timesheets(karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_user_key ON karbon_timesheets(user_key);
CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_date ON karbon_timesheets(date);
CREATE INDEX IF NOT EXISTS idx_karbon_timesheets_modified ON karbon_timesheets(karbon_modified_at);

CREATE INDEX IF NOT EXISTS idx_karbon_notes_work_item_key ON karbon_notes(karbon_work_item_key);
CREATE INDEX IF NOT EXISTS idx_karbon_notes_contact_key ON karbon_notes(karbon_contact_key);
CREATE INDEX IF NOT EXISTS idx_karbon_notes_modified ON karbon_notes(karbon_modified_at);

CREATE INDEX IF NOT EXISTS idx_sync_log_type ON sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);
CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log(started_at DESC);
