-- 161: prospect platform-push intent
-- ────────────────────────────────────────────────────────────────────
-- The Prospect Form is now Hub-first: it always creates the Master Hub
-- Contact (in `contacts` / `organizations`), and the teammate filing
-- the form picks which downstream platforms to also push the prospect
-- to. We persist the picker's intent on the prospect row so:
--   1. The detail page can show "queued: Karbon, ProConnect" while
--      pushes run in the background.
--   2. A teammate can later trigger a manual retry / push-after-the-
--      fact from the detail page.
--   3. We have an audit trail of which channels the prospect was
--      pushed to and when.
--
-- Karbon push is wired live today; ProConnect / Ignition columns are
-- forward-looking and capture intent until the platform-side create-
-- client APIs are wired up.

ALTER TABLE prospect_submissions
  -- Karbon
  ADD COLUMN IF NOT EXISTS push_to_karbon boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS karbon_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS karbon_push_status text
    CHECK (karbon_push_status IN ('pending', 'success', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS karbon_push_error text,
  -- ProConnect (Phase 2: requires a Phase-1 connection w/ create-client scope)
  ADD COLUMN IF NOT EXISTS push_to_proconnect boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proconnect_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS proconnect_push_status text
    CHECK (proconnect_push_status IN ('pending', 'success', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS proconnect_push_error text,
  -- Ignition (Phase 2: requires Ignition oauth + create-proposal endpoint)
  ADD COLUMN IF NOT EXISTS push_to_ignition boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ignition_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ignition_push_status text
    CHECK (ignition_push_status IN ('pending', 'success', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS ignition_push_error text;

-- Index so the "stuck pushes" admin tile can find rows quickly.
CREATE INDEX IF NOT EXISTS prospect_submissions_pending_pushes_idx
  ON prospect_submissions (created_at DESC)
  WHERE
    karbon_push_status = 'pending'
    OR proconnect_push_status = 'pending'
    OR ignition_push_status = 'pending';
