-- ProConnect OAuth governance
-- Migration 344: record WHO connected the firm's ProConnect app and the
-- last token-refresh error, so /tax/settings can show "connected by" and a
-- "reconnect required" state.
--
-- This is intentionally ADDITIVE to the existing singleton
-- `proconnect_oauth_tokens` table (created in 200_proconnect_sync_schema.sql).
-- We do NOT rename the table or change how tokens are stored, because the
-- nightly Supabase Edge Functions (proconnect-refresh-token, proconnect-sync*)
-- and the /api/tax/proconnect-status route all read this table directly.
--
-- Column reuse:
--   * `created_at`  already serves as "connected since"
--   * `updated_at`  already serves as "last refreshed"
-- so we only need the two new governance columns below.

ALTER TABLE proconnect_oauth_tokens
  ADD COLUMN IF NOT EXISTS connected_by_team_member_id uuid
    REFERENCES team_members(id) ON DELETE SET NULL;

ALTER TABLE proconnect_oauth_tokens
  ADD COLUMN IF NOT EXISTS last_refresh_error text;

COMMENT ON COLUMN proconnect_oauth_tokens.connected_by_team_member_id IS
  'team_members.id of the admin who completed the OAuth consent (from the signed OAuth state). Surfaced on /tax/settings as "Connected by".';

COMMENT ON COLUMN proconnect_oauth_tokens.last_refresh_error IS
  'Last refresh-token error message, if any. When non-null the settings card shows a "Reconnect required" prompt. Cleared on a successful (re)connect.';
