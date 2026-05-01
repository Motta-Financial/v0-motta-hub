-- =============================================================================
-- 031: Work-item soft-delete + first-class full-text search
-- =============================================================================
-- Purpose:
--   1. Add `deleted_in_karbon_at` so the sync routine can soft-delete rows that
--      have disappeared upstream (Karbon doesn't notify us — they just stop
--      coming back from the list endpoint). Without this we accumulate ghost
--      rows that pollute every dashboard count and search result.
--
--   2. Add a maintained `search_vector` tsvector column so every work-item
--      surface (global table, per-service-line dashboards, command palette)
--      can hit a single GIN index instead of doing per-page ILIKE %x% scans.
--
-- Safe to re-run: every step is `IF NOT EXISTS` / `OR REPLACE` guarded.
-- =============================================================================

-- 1. Soft-delete column ------------------------------------------------------
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS deleted_in_karbon_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_work_items_deleted_in_karbon_at
  ON work_items (deleted_in_karbon_at)
  WHERE deleted_in_karbon_at IS NOT NULL;

-- Partial index used by the default "live" filter on every read path.
CREATE INDEX IF NOT EXISTS idx_work_items_live
  ON work_items (last_synced_at DESC)
  WHERE deleted_in_karbon_at IS NULL;

COMMENT ON COLUMN work_items.deleted_in_karbon_at IS
  'Timestamp when this work item stopped being returned by Karbon''s list API. NULL = still live in Karbon. Set by the sync route after a successful full pull.';

-- 2. Full-text search vector -------------------------------------------------
-- We index the dimensions a Motta team member is most likely to type:
--   • title              (highest weight — A)
--   • client_name        (B)
--   • client_group_name  (B)
--   • assignee_name      (C)
--   • work_type          (C)
--   • karbon_work_item_key, user_defined_identifier (D — exact identifier hits)
--
-- A GIN index on tsvector is roughly two orders of magnitude faster than
-- chained `ILIKE '%x%'` scans across 3,400+ rows, especially for the
-- multi-column OR pattern the API currently uses.
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(client_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(client_group_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(assignee_name, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(work_type, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(karbon_work_item_key, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(user_defined_identifier, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_work_items_search_vector
  ON work_items USING GIN (search_vector);

COMMENT ON COLUMN work_items.search_vector IS
  'Maintained tsvector across title/client/group/assignee/work_type/keys for fast multi-column search. Use websearch_to_tsquery for user-typed input.';

-- 3. Backfill: mark current ghosts as deleted -------------------------------
-- Anything not touched by the most recent successful full sync (i.e. its
-- last_synced_at is older than the newest one in the table) is a row Karbon
-- no longer reports.
WITH latest AS (
  SELECT max(last_synced_at) AS ts FROM work_items WHERE last_synced_at IS NOT NULL
)
UPDATE work_items wi
SET deleted_in_karbon_at = wi.last_synced_at
FROM latest
WHERE wi.deleted_in_karbon_at IS NULL
  AND wi.last_synced_at IS NOT NULL
  AND wi.last_synced_at < latest.ts - interval '1 hour';

-- 4. Refresh the enriched view so it carries `deleted_in_karbon_at` and
--    `search_vector`. Recreated 1:1 with the old definition plus the new
--    columns so existing callers keep working.
DROP VIEW IF EXISTS work_items_enriched CASCADE;

CREATE VIEW work_items_enriched AS
SELECT wi.id,
    wi.karbon_work_item_key,
    wi.title,
    wi.description,
    wi.work_type,
    wi.work_type_id,
    wi.client_type,
    wi.contact_id,
    wi.organization_id,
    wi.client_group_id,
    wi.status,
    wi.status_code,
    wi.workflow_status,
    wi.start_date,
    wi.due_date,
    wi.completed_date,
    wi.year_end,
    wi.tax_year,
    wi.assignee_id,
    wi.client_owner_id,
    wi.client_manager_id,
    wi.budget_minutes,
    wi.estimated_minutes,
    wi.actual_minutes,
    wi.billable_minutes,
    wi.estimated_fee,
    wi.actual_fee,
    wi.priority,
    wi.is_recurring,
    wi.is_billable,
    wi.is_internal,
    wi.karbon_client_key,
    wi.karbon_url,
    wi.work_status_key,
    wi.notes,
    wi.tags,
    wi.custom_fields,
    wi.created_at,
    wi.updated_at,
    wi.last_synced_at,
    wi.work_template_key,
    wi.work_template_name,
    wi.client_group_key,
    wi.client_group_name,
    wi.assignee_key,
    wi.assignee_name,
    wi.client_manager_key,
    wi.client_manager_name,
    wi.client_partner_key,
    wi.client_partner_name,
    wi.todo_count,
    wi.completed_todo_count,
    wi.has_blocking_todos,
    wi.fee_type,
    wi.fixed_fee_amount,
    wi.hourly_rate,
    wi.budget_hours,
    wi.budget_amount,
    wi.actual_hours,
    wi.actual_amount,
    wi.extension_date,
    wi.internal_due_date,
    wi.regulatory_deadline,
    wi.client_deadline,
    wi.period_start,
    wi.period_end,
    wi.related_work_keys,
    wi.karbon_created_at,
    wi.karbon_modified_at,
    wi.client_name,
    wi.client_owner_key,
    wi.client_owner_name,
    wi.primary_status,
    wi.secondary_status,
    wi.user_defined_identifier,
    -- New columns from this migration:
    wi.deleted_in_karbon_at,
    wi.search_vector,
    c.full_name AS contact_full_name,
    c.primary_email AS contact_email,
    o.name AS org_name,
    o.primary_email AS org_email,
    tm_assignee.full_name AS assignee_full_name,
    tm_manager.full_name AS manager_full_name,
    tm_owner.full_name AS owner_full_name
FROM work_items wi
  LEFT JOIN contacts c ON wi.contact_id = c.id
  LEFT JOIN organizations o ON wi.organization_id = o.id
  LEFT JOIN team_members tm_assignee ON wi.assignee_key = tm_assignee.karbon_user_key
  LEFT JOIN team_members tm_manager ON wi.client_manager_key = tm_manager.karbon_user_key
  LEFT JOIN team_members tm_owner ON wi.client_owner_key = tm_owner.karbon_user_key;

COMMENT ON VIEW work_items_enriched IS
  'Work items joined to contacts/organizations/team_members. Includes deleted_in_karbon_at and search_vector. Filter deleted_in_karbon_at IS NULL for live items.';
