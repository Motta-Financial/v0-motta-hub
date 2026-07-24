-- =============================================================================
-- 351: Debrief soft-delete
-- =============================================================================
-- Purpose:
--   Give the Hub a real "delete a submitted debrief" path that is recoverable
--   and auditable. Previously `DELETE /api/debriefs/[id]` hard-deleted the row
--   (and nothing in the UI called it), so a mis-attributed or duplicate debrief
--   could only be removed by dropping into Supabase — with no way to undo.
--
--   We soft-delete instead of hard-deleting because debriefs are client records:
--   they feed client profiles, deal stats, the daily briefing, search, and the
--   meeting timeline. Keeping the row (with who deleted it and why) means a
--   mistaken delete is a one-click restore rather than lost history.
--
-- Strategy:
--   1. Add `deleted_at` / `deleted_by_id` / `deleted_reason` to `debriefs`.
--   2. Filter deleted rows out INSIDE the debriefs_* views. Every view-based
--      read path (debriefs table, triage feed, global search, client profile,
--      project detail) then hides them with zero caller changes. Base-table
--      queries in app code add `.is("deleted_at", null)` explicitly.
--   3. Patch the two other views that aggregate debriefs (deals_enriched
--      debrief_count, hub_meetings_enriched has_debrief) so a deleted debrief
--      doesn't keep inflating counts or marking a meeting as debriefed.
--
-- Note: the views below are reproduced 1:1 from their live definitions with
-- only a `deleted_at IS NULL` predicate added, so CREATE OR REPLACE keeps the
-- exact same column list/order and no dependents need rebuilding.
--
-- Safe to re-run: every step is `IF NOT EXISTS` / `OR REPLACE` guarded.
-- =============================================================================

-- 1. Soft-delete columns -----------------------------------------------------
ALTER TABLE debriefs
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_id uuid REFERENCES team_members (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason text;

-- Small partial index for the "show deleted" admin list.
CREATE INDEX IF NOT EXISTS idx_debriefs_deleted_at
  ON debriefs (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- Partial index backing the default "live debriefs" ordering used by the list
-- API and the views below.
CREATE INDEX IF NOT EXISTS idx_debriefs_live_created_at
  ON debriefs (created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN debriefs.deleted_at IS
  'Soft-delete timestamp. NULL = live. Deleted rows are filtered out of debriefs_full / debriefs_with_member / debriefs_search and of every base-table read path in the app. Restore by setting back to NULL.';
COMMENT ON COLUMN debriefs.deleted_by_id IS
  'team_members.id of whoever deleted the debrief. Audit trail for the soft delete.';
COMMENT ON COLUMN debriefs.deleted_reason IS
  'Optional free-text reason captured in the delete confirmation dialog.';

-- 2. debriefs_full -----------------------------------------------------------
CREATE OR REPLACE VIEW debriefs_full AS
SELECT d.id,
    d.debrief_date,
    d.debrief_type,
    d.notes,
    d.action_items,
    d.follow_up_date,
    d.status,
    d.contact_id,
    d.organization_id,
    d.client_group_id,
    d.client_owner_id,
    d.client_manager_id,
    d.created_by_id,
    d.work_item_id,
    d.meeting_id,
    d.karbon_client_key,
    d.karbon_work_url,
    d.organization_name,
    d.client_owner_name,
    d.client_manager_name,
    d.client_type,
    d.contact_type,
    d.role,
    d.tax_year,
    d.filing_status,
    d.adjusted_gross_income,
    d.taxable_income,
    d.has_schedule_c,
    d.has_schedule_e,
    d.state_tax,
    d.recurring_revenue,
    d.created_at,
    d.updated_at,
    d.team_member_id,
    tm.full_name AS team_member_full_name,
    tm.avatar_url AS team_member_avatar_url,
    cb.full_name AS created_by_full_name,
    cb.avatar_url AS created_by_avatar_url,
    c.full_name AS contact_full_name,
    o.name AS organization_display_name,
    wi.title AS work_item_title,
    wi.client_name AS work_item_client_name,
    wi.karbon_url AS work_item_karbon_url
   FROM debriefs d
     LEFT JOIN team_members tm ON d.team_member_id = tm.id
     LEFT JOIN team_members cb ON d.created_by_id = cb.id
     LEFT JOIN contacts c ON d.contact_id = c.id
     LEFT JOIN organizations o ON d.organization_id = o.id
     LEFT JOIN work_items wi ON d.work_item_id = wi.id
  WHERE d.deleted_at IS NULL;

COMMENT ON VIEW debriefs_full IS
  'Debriefs joined to team_members/contacts/organizations/work_items. Excludes soft-deleted rows (debriefs.deleted_at IS NOT NULL).';

-- 3. debriefs_with_member ----------------------------------------------------
CREATE OR REPLACE VIEW debriefs_with_member AS
SELECT d.id,
    d.debrief_date,
    d.debrief_type,
    d.notes,
    d.action_items,
    d.follow_up_date,
    d.status,
    d.contact_id,
    d.organization_id,
    d.client_group_id,
    d.client_owner_id,
    d.client_manager_id,
    d.created_by_id,
    d.work_item_id,
    d.meeting_id,
    d.karbon_client_key,
    d.karbon_work_url,
    d.organization_name,
    d.client_owner_name,
    d.client_manager_name,
    d.client_type,
    d.contact_type,
    d.role,
    d.tax_year,
    d.filing_status,
    d.adjusted_gross_income,
    d.taxable_income,
    d.has_schedule_c,
    d.has_schedule_e,
    d.state_tax,
    d.recurring_revenue,
    d.created_at,
    d.updated_at,
    d.team_member_id,
    tm.full_name AS team_member_full_name
   FROM debriefs d
     LEFT JOIN team_members tm ON tm.id = d.team_member_id
  WHERE d.deleted_at IS NULL;

COMMENT ON VIEW debriefs_with_member IS
  'Debriefs with the assigned team member name. Excludes soft-deleted rows.';

-- 4. debriefs_search ---------------------------------------------------------
CREATE OR REPLACE VIEW debriefs_search AS
SELECT d.id,
    d.debrief_date,
    d.debrief_type,
    d.notes,
    d.action_items,
    d.follow_up_date,
    d.status,
    d.contact_id,
    d.organization_id,
    d.client_group_id,
    d.client_owner_id,
    d.client_manager_id,
    d.created_by_id,
    d.work_item_id,
    d.meeting_id,
    d.karbon_client_key,
    d.karbon_work_url,
    d.organization_name,
    d.client_owner_name,
    d.client_manager_name,
    d.client_type,
    d.contact_type,
    d.role,
    d.tax_year,
    d.filing_status,
    d.adjusted_gross_income,
    d.taxable_income,
    d.has_schedule_c,
    d.has_schedule_e,
    d.state_tax,
    d.recurring_revenue,
    d.created_at,
    d.updated_at,
    d.team_member_id,
    tm.full_name AS team_member_full_name
   FROM debriefs d
     LEFT JOIN team_members tm ON tm.id = d.team_member_id
  WHERE d.deleted_at IS NULL;

COMMENT ON VIEW debriefs_search IS
  'Debriefs shaped for the global search endpoint. Excludes soft-deleted rows.';

-- 5. deals_enriched — don't count deleted debriefs ---------------------------
CREATE OR REPLACE VIEW deals_enriched AS
SELECT d.id,
    d.contact_id,
    d.organization_id,
    d.title,
    d.stage,
    d.status,
    d.source,
    d.owner_team_member_id,
    d.estimated_value,
    d.notes,
    d.first_contact_at,
    d.closed_at,
    d.created_at,
    d.updated_at,
    COALESCE(NULLIF(TRIM(BOTH FROM ct.full_name), ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ct.first_name, ct.last_name)), ''::text), ct.primary_email) AS contact_name,
    ct.primary_email AS contact_email,
    org.name AS organization_name,
    tm.full_name AS owner_name,
    mstats.meeting_count,
    mstats.recorded_meeting_count,
    mstats.last_meeting_at,
    mstats.next_meeting_at,
    dstats.debrief_count,
    dstats.last_debrief_at,
    wstats.work_item_count
   FROM deals d
     LEFT JOIN contacts ct ON ct.id = d.contact_id
     LEFT JOIN organizations org ON org.id = d.organization_id
     LEFT JOIN team_members tm ON tm.id = d.owner_team_member_id
     LEFT JOIN LATERAL ( SELECT count(*) AS meeting_count,
            count(*) FILTER (WHERE m.zoom_meeting_id IS NOT NULL) AS recorded_meeting_count,
            max(m.scheduled_start) FILTER (WHERE m.scheduled_start <= now()) AS last_meeting_at,
            min(m.scheduled_start) FILTER (WHERE m.scheduled_start > now()) AS next_meeting_at
           FROM meetings m
          WHERE m.deal_id = d.id) mstats ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS debrief_count,
            max(db.created_at) AS last_debrief_at
           FROM debriefs db
          WHERE db.deal_id = d.id AND db.deleted_at IS NULL) dstats ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS work_item_count
           FROM deal_work_items dwi
          WHERE dwi.deal_id = d.id) wstats ON true;

-- 6. hub_meetings_enriched — a deleted debrief no longer marks has_debrief ---
CREATE OR REPLACE VIEW hub_meetings_enriched AS
SELECT m.id AS meeting_id,
    m.title,
    m.meeting_type,
    m.status,
    m.scheduled_start,
    m.scheduled_end,
    m.location_type,
    m.video_link,
    m.created_at,
    m.updated_at,
    m.contact_id,
    c.full_name AS client_name,
    c.is_prospect AS client_is_prospect,
    m.organization_id,
    o.name AS organization_name,
    m.host_id,
    tm.full_name AS host_name,
    ce.id AS calendly_event_pk,
    ce.calendly_uuid,
    ce.name AS calendly_name,
    ce.start_time AS calendly_start_time,
    ce.id IS NOT NULL AS has_calendly,
    zm.id AS zoom_meeting_pk,
    zm.zoom_meeting_id AS zoom_numeric_id,
    zm.topic AS zoom_topic,
    zm.id IS NOT NULL AS has_zoom,
    zr.id IS NOT NULL AS has_recording,
    zt.id AS transcript_id,
    zt.text_content IS NOT NULL AS has_transcript,
    zt.summary_status,
    zt.summary_note_id,
    d.id AS debrief_id,
    d.status AS debrief_status,
    d.id IS NOT NULL AS has_debrief,
    ps.id AS prospect_submission_id,
    ps.lead_status AS prospect_lead_status,
    ps.id IS NOT NULL AS has_prospect
   FROM meetings m
     LEFT JOIN contacts c ON c.id = m.contact_id
     LEFT JOIN organizations o ON o.id = m.organization_id
     LEFT JOIN team_members tm ON tm.id = m.host_id
     LEFT JOIN calendly_events ce ON ce.id::text = m.calendly_event_id
     LEFT JOIN zoom_meetings zm ON zm.id::text = m.zoom_meeting_id
     LEFT JOIN LATERAL ( SELECT zr_1.id
           FROM zoom_recordings zr_1
          WHERE zr_1.zoom_meeting_id = zm.zoom_meeting_id
          ORDER BY zr_1.created_at DESC
         LIMIT 1) zr ON true
     LEFT JOIN LATERAL ( SELECT zt_1.id,
            zt_1.text_content,
            zt_1.summary_status,
            zt_1.summary_note_id
           FROM zoom_transcripts zt_1
          WHERE zt_1.zoom_meeting_id = zm.zoom_meeting_id
          ORDER BY (zt_1.text_content IS NOT NULL) DESC, zt_1.created_at DESC
         LIMIT 1) zt ON true
     LEFT JOIN LATERAL ( SELECT d_1.id,
            d_1.status
           FROM debriefs d_1
          WHERE d_1.deleted_at IS NULL
            AND (d_1.meeting_id = m.id OR d_1.calendly_event_id = ce.id OR d_1.zoom_meeting_id = zm.id)
          ORDER BY d_1.created_at DESC
         LIMIT 1) d ON true
     LEFT JOIN LATERAL ( SELECT ps_1.id,
            ps_1.lead_status
           FROM prospect_submissions ps_1
          WHERE ps_1.contact_id = m.contact_id AND m.contact_id IS NOT NULL
          ORDER BY ps_1.created_at DESC
         LIMIT 1) ps ON true;
