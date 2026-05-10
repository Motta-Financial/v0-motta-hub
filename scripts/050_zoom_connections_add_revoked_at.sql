-- ─────────────────────────────────────────────────────────────────────────────
-- Add `revoked_at` column to `zoom_connections`.
--
-- Why this exists
-- ────────────────
-- The `app.deauthorized` Zoom webhook fires when a team member clicks
-- "Remove" on the Motta Hub Zoom App in their Zoom account, or when an
-- account admin revokes the install. The handler for that event needs
-- to:
--   1. Stamp the connection row with the moment of revocation so we
--      can stop using its tokens immediately.
--   2. Keep the row around for a Zoom-mandated 6-month retention
--      window (so we can answer Zoom's compliance audits about what
--      data we held and when we purged it).
-- The existing `is_active = false` flag is a "should we use this?"
-- signal but doesn't preserve the timestamp; `revoked_at` is the
-- audit-trail column.
--
-- Side effects
-- ────────────
-- Adding a nullable timestamptz column on a table that's currently
-- empty (or near-empty) is a fast metadata-only change.  No data is
-- backfilled because previously-active rows were never revoked.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.zoom_connections
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

COMMENT ON COLUMN public.zoom_connections.revoked_at IS
  'Set by the app.deauthorized webhook handler when a user uninstalls the Motta Hub Zoom App. NULL means the connection has never been revoked. Combine with is_active=false to filter out unusable connections in app queries.';
