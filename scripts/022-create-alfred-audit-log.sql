-- ============================================================
-- ALFRED AI Audit Log
-- Tracks every write action ALFRED performs on Motta Hub data.
-- Run this migration in your Supabase SQL editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS alfred_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who triggered the action
  team_member_id  UUID REFERENCES team_members(id) ON DELETE SET NULL,
  actor_name      TEXT,                        -- display name at time of action

  -- What was changed
  action_type     TEXT NOT NULL,               -- 'work_item_status_update' | 'client_info_update' | 'client_note_added'
  entity_type     TEXT NOT NULL,               -- 'work_item' | 'contact' | 'organization' | 'meeting_notes'
  entity_id       UUID,                        -- UUID of the affected record (null for notes without a linked entity)

  -- Detail
  description     TEXT NOT NULL,              -- human-readable summary
  payload         JSONB,                       -- full before/after or note content (structured)

  -- Outcome
  success         BOOLEAN NOT NULL DEFAULT TRUE
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_alfred_audit_created_at  ON alfred_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alfred_audit_team_member ON alfred_audit_log(team_member_id);
CREATE INDEX IF NOT EXISTS idx_alfred_audit_entity      ON alfred_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_alfred_audit_action_type ON alfred_audit_log(action_type);

-- RLS: authenticated users can read the audit log; only the service role can insert
ALTER TABLE alfred_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read alfred_audit_log"
  ON alfred_audit_log FOR SELECT
  TO authenticated
  USING (true);

-- Service role writes audit entries (server-side only, never from the browser)
-- INSERT is restricted to service_role via the server — no client INSERT policy needed.

-- Grant read access to authenticated users
GRANT SELECT ON alfred_audit_log TO authenticated;

COMMENT ON TABLE alfred_audit_log IS
  'Audit trail of all write actions performed by ALFRED AI on behalf of team members.';
