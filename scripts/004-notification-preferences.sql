-- Per-user email preferences for the platform notification system.
-- A row per (team_member, category). Missing rows default to "email enabled".
-- Categories align with the EMAIL_CATEGORIES constant in lib/email.ts.

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_member_id, category)
);

CREATE INDEX IF NOT EXISTS idx_notif_prefs_member ON notification_preferences(team_member_id);
CREATE INDEX IF NOT EXISTS idx_notif_prefs_category ON notification_preferences(category);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_preferences_allow_all" ON notification_preferences;
CREATE POLICY "notification_preferences_allow_all"
  ON notification_preferences FOR ALL
  USING (true) WITH CHECK (true);
