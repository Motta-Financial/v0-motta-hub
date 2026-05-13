-- ============================================================================
-- Training Library: Loom-backed video library for internal training content.
-- ============================================================================
-- Motta records Loom videos for SOPs, onboarding walkthroughs, and ad-hoc
-- training. Atlassian's Admin API (which owns Loom) does not expose video
-- listing endpoints, and Loom itself doesn't ship a self-serve "list workspace
-- videos" API. So we operate in a "paste-the-share-URL + enrich-via-oEmbed"
-- model:
--
--   1. A teammate pastes a Loom share URL (e.g. https://www.loom.com/share/xxx).
--   2. The Hub hits Loom's PUBLIC oEmbed endpoint to fetch title, thumbnail,
--      duration, and the canonical embed iframe HTML.
--   3. We persist the enriched record here and render it via <LoomEmbed />
--      anywhere in the app (SOPs, onboarding pages, debrief notes, etc.).
--
-- Schema decisions:
--   - `loom_video_id` is the share-URL slug (`/share/<id>`). We extract it on
--     write and use a UNIQUE constraint so the same video can't be added
--     twice. This also lets us upsert from a bulk-paste flow without a
--     pre-check round trip.
--   - `category_id` is a FK to a small lookup table rather than a free-text
--     column so the Training Library can render a stable category filter
--     bar. We seed a handful of useful defaults below; admins can edit
--     the list from the UI later.
--   - `department` is intentionally free-text (no FK) -- the firm's
--     department list changes more often than the category list and we
--     don't want a separate table just for one column.
--   - We track `added_by_id` against `team_members.id` (NOT `auth.users.id`)
--     to match every other Hub table.
--   - RLS policies are "allow all to authenticated" to match the rest of
--     the Hub schema; the access decision happens at the route layer.
-- ============================================================================

CREATE TABLE IF NOT EXISTS training_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  -- One-line description shown under the category title on the library page.
  -- Optional; left null to skip rendering the subtitle.
  description TEXT,
  -- Hex color used for the category chip / accent stripe. Defaults to the
  -- Motta sage so unset categories still render with the brand palette.
  color TEXT DEFAULT '#8E9B79',
  -- Display ordering on the library page. Smaller = earlier. We use
  -- integers so admins can renumber without rewriting the whole list.
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source of truth for the embed. Always the canonical share URL the user
  -- pasted; we do NOT rewrite this to the embed URL because the share URL
  -- is what's documented in Karbon, Slack, and elsewhere -- preserving it
  -- makes round-tripping (e.g. "find this Loom") trivial.
  loom_url TEXT NOT NULL,

  -- Extracted on write from loom_url. Used for de-dup, fast embed URL
  -- generation, and joining the same Loom referenced from multiple places.
  -- Cannot be derived as a generated column because Postgres regex
  -- functions aren't IMMUTABLE; we set it from the API route instead.
  loom_video_id TEXT NOT NULL UNIQUE,

  -- Enriched fields. All nullable because the oEmbed call can fail
  -- (private Loom, network blip) and we still want to persist the row so
  -- the user can edit metadata manually rather than re-paste.
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  author_name TEXT,

  -- Categorization. category_id is the structured filter; department and
  -- tags are softer slicing dimensions for search.
  category_id UUID REFERENCES training_categories(id) ON DELETE SET NULL,
  department TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Pinning surfaces a small set of "must watch" videos at the top of the
  -- library regardless of sort order -- used for new-hire onboarding
  -- essentials.
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,

  -- Audit trail. added_by_id is the team_member who created the row; we
  -- denormalize the display name so the library card can show "Added by
  -- Tommy" without an extra join.
  added_by_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
  added_by_name TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes optimized for the library page's three primary query shapes:
--   - List by category (filter bar click)
--   - List by department (filter bar click)
--   - Recent first (default sort)
CREATE INDEX IF NOT EXISTS idx_training_videos_category_id ON training_videos(category_id);
CREATE INDEX IF NOT EXISTS idx_training_videos_department ON training_videos(department);
CREATE INDEX IF NOT EXISTS idx_training_videos_created_at ON training_videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_videos_is_pinned ON training_videos(is_pinned) WHERE is_pinned = TRUE;

-- Auto-bump updated_at on row mutation so the library page can show a
-- "last modified" indicator without us having to remember to set it from
-- every PATCH handler.
CREATE OR REPLACE FUNCTION training_videos_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS training_videos_updated_at ON training_videos;
CREATE TRIGGER training_videos_updated_at
  BEFORE UPDATE ON training_videos
  FOR EACH ROW
  EXECUTE FUNCTION training_videos_set_updated_at();

DROP TRIGGER IF EXISTS training_categories_updated_at ON training_categories;
CREATE TRIGGER training_categories_updated_at
  BEFORE UPDATE ON training_categories
  FOR EACH ROW
  EXECUTE FUNCTION training_videos_set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Matches the Hub-wide pattern: enable RLS and grant ALL to authenticated
-- (and service-role via the admin client which bypasses RLS anyway). The
-- per-action guardrails live in the route handlers.
ALTER TABLE training_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on training_categories" ON training_categories;
CREATE POLICY "Allow all on training_categories"
  ON training_categories
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on training_videos" ON training_videos;
CREATE POLICY "Allow all on training_videos"
  ON training_videos
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── Seed categories ────────────────────────────────────────────────────────
-- A short opinionated default set so the library page has a populated
-- filter bar from day one. Admins can rename / delete / reorder from the UI.
-- Using ON CONFLICT DO NOTHING so re-running this migration is safe.
INSERT INTO training_categories (name, description, color, sort_order) VALUES
  ('Onboarding',       'Day-one walkthroughs for new teammates',       '#6B745D', 10),
  ('SOPs',             'Standard operating procedures by department',  '#8E9B79', 20),
  ('Tax',              'Workflow and software training for the Tax team', '#A2845E', 30),
  ('Accounting',       'Bookkeeping and accounting workflow training', '#5F7A8C', 40),
  ('Sales',            'Proposal, intake, and Ignition workflows',     '#B07A4A', 50),
  ('Software & Tools', 'Karbon, ProConnect, ALFRED, etc.',             '#7A6B8C', 60),
  ('Culture',          'Firm values, recognition, comms norms',        '#8C6B7A', 70)
ON CONFLICT (name) DO NOTHING;
