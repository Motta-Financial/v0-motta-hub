-- 210_marketing_schema.sql
--
-- Cross-project integration for motta.cpa (Vercel project
-- `prj_EuqYEqjELxtf52nD7RbY4XxGrlAp`) <-> ALFRED Hub
-- (`prj_VvPN85eN7oCBBRzcLD7YYokXbxo8`). Both projects share THIS
-- Supabase instance, but they live at different trust levels:
--
--   • Hub  = service-role key, full schema, all webhooks/cron live here
--   • Site = anon key only, read-only Supabase access, writes proxy
--           through the Hub's `/api/public/*` endpoints
--
-- Goal of this migration: give the marketing site its own schema
-- (`marketing.*`) so it can ship blog posts, case studies, and live
-- "trust signal" stats WITHOUT polluting the Hub's `public.*` tables
-- and WITHOUT ever needing the service role key.
--
-- Conventions (do not regress):
--   1. Public-facing reads from motta.cpa go through `marketing.*`
--      tables/views with explicit `anon SELECT` policies.
--   2. Public-facing writes (contact, intake, newsletter, referral)
--      stay on Hub `/api/public/*` routes — do NOT add INSERT
--      policies for `anon` on `public.*` tables.
--   3. The "live stats" hero strip on motta.cpa reads from
--      `marketing.firm_stats_public`, a SECURITY-DEFINER view that
--      pre-aggregates Hub data so the anon role never sees PII.
--   4. Schema migrations are authored ONLY from this Hub repo. The
--      marketing project never owns DDL.

-- ── 1. Schema + grants ───────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS marketing;

-- Anon (the marketing site's PostgREST role) gets USAGE on the schema
-- but no table-level grants by default — every table opts in below.
GRANT USAGE ON SCHEMA marketing TO anon, authenticated, service_role;

-- ── 2. Newsletter subscribers ────────────────────────────────────
-- Stored in marketing.* (not public.contacts) because not every
-- subscriber is a prospect — these are content-funnel leads. If/when
-- they DO become a prospect (intake form, contact form, referral)
-- the Hub's findOrCreateHubContact merges them into public.contacts
-- by email at that point.
CREATE TABLE IF NOT EXISTS marketing.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text,
  source text,                 -- "homepage_footer", "blog_post_slug", etc.
  utm_source text,
  utm_medium text,
  utm_campaign text,
  ip_address text,
  user_agent text,
  -- Double-opt-in: row exists immediately, but `confirmed_at` is null
  -- until they click the confirmation link emailed by the Hub.
  confirmed_at timestamptz,
  confirmation_token text UNIQUE,  -- single-use; cleared after confirm
  unsubscribed_at timestamptz,
  -- If/when the email is also a Hub contact, link it. Updated by a
  -- one-shot reconciler when the user becomes a real client.
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_uidx
  ON marketing.newsletter_subscribers (lower(email))
  WHERE unsubscribed_at IS NULL;

CREATE INDEX IF NOT EXISTS newsletter_subscribers_unconfirmed_idx
  ON marketing.newsletter_subscribers (created_at DESC)
  WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL;

CREATE OR REPLACE FUNCTION marketing.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS newsletter_subscribers_updated_at
  ON marketing.newsletter_subscribers;
CREATE TRIGGER newsletter_subscribers_updated_at
  BEFORE UPDATE ON marketing.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION marketing.set_updated_at();

-- RLS: anon CANNOT read or insert directly. All writes go through
-- the Hub's `/api/public/newsletter` route (service-role insert).
-- Reads from the marketing site (e.g. unsubscribe page) go through
-- a Hub route too — never direct.
ALTER TABLE marketing.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS. We add an explicit deny-all policy for
-- anon so any future "SELECT * FROM marketing.newsletter_subscribers"
-- from the marketing site fails LOUDLY instead of silently.
DROP POLICY IF EXISTS newsletter_anon_no_access
  ON marketing.newsletter_subscribers;
CREATE POLICY newsletter_anon_no_access
  ON marketing.newsletter_subscribers
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- ── 3. Blog posts (anon-readable; CMS lives in the Hub) ──────────
CREATE TABLE IF NOT EXISTS marketing.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  subtitle text,
  excerpt text,
  body_md text NOT NULL,        -- markdown; rendered on the marketing site
  cover_image_url text,
  -- Author display fields — denormalized so the marketing site can
  -- render without joining into public.team_members (which has PII
  -- like phone numbers we don't want exposed to anon).
  author_name text,
  author_role text,
  author_avatar_url text,
  -- Lifecycle: draft → scheduled → published → archived
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  published_at timestamptz,
  -- SEO
  seo_title text,
  seo_description text,
  og_image_url text,
  -- Tagging — array of slugs, kept simple (no separate tags table
  -- until we actually have a taxonomy worth normalizing).
  tags text[] NOT NULL DEFAULT '{}',
  -- Optional: tie a post to a service line so /tax /advisory /etc on
  -- motta.cpa can pull "related posts" without a JOIN.
  service_focus text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blog_posts_published_idx
  ON marketing.blog_posts (published_at DESC)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS blog_posts_tags_gin
  ON marketing.blog_posts USING gin (tags);

DROP TRIGGER IF EXISTS blog_posts_updated_at ON marketing.blog_posts;
CREATE TRIGGER blog_posts_updated_at
  BEFORE UPDATE ON marketing.blog_posts
  FOR EACH ROW EXECUTE FUNCTION marketing.set_updated_at();

ALTER TABLE marketing.blog_posts ENABLE ROW LEVEL SECURITY;

-- Anon can SELECT only published posts. Drafts/scheduled stay
-- visible only via service role (Hub admin UI).
DROP POLICY IF EXISTS blog_posts_anon_select_published ON marketing.blog_posts;
CREATE POLICY blog_posts_anon_select_published
  ON marketing.blog_posts
  FOR SELECT TO anon
  USING (status = 'published' AND published_at <= now());

GRANT SELECT ON marketing.blog_posts TO anon;

-- ── 4. Case studies (anon-readable) ──────────────────────────────
CREATE TABLE IF NOT EXISTS marketing.case_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  client_display_name text NOT NULL,   -- "A Bay Area dental practice"
  industry text,
  -- Pull-quote + attribution. Attribution can be anonymized.
  quote text,
  attribution text,                    -- "Owner, dental practice (CA)"
  -- Result metrics — small array of {label, value, unit}.
  -- e.g. [{ "label": "Tax savings", "value": 38000, "unit": "USD" }]
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  body_md text,
  cover_image_url text,
  service_focus text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_studies_published_idx
  ON marketing.case_studies (published_at DESC)
  WHERE status = 'published';

DROP TRIGGER IF EXISTS case_studies_updated_at ON marketing.case_studies;
CREATE TRIGGER case_studies_updated_at
  BEFORE UPDATE ON marketing.case_studies
  FOR EACH ROW EXECUTE FUNCTION marketing.set_updated_at();

ALTER TABLE marketing.case_studies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_studies_anon_select_published ON marketing.case_studies;
CREATE POLICY case_studies_anon_select_published
  ON marketing.case_studies
  FOR SELECT TO anon
  USING (status = 'published' AND published_at <= now());

GRANT SELECT ON marketing.case_studies TO anon;

-- ── 5. Live "firm stats" view for the marketing hero strip ───────
-- Aggregates Hub data (public.contacts, public.tax_returns,
-- public.organizations) and exposes a SAFE row to anon. Numbers only,
-- no PII, refreshed on demand by the marketing site (it's a regular
-- view, not a materialized view — Postgres caching + Vercel CDN
-- caching at the route level is more than enough for a hero strip).
--
-- Schema-aware notes:
--   - contacts has no is_active column; "active client" =
--     is_prospect IS NOT TRUE AND status IS DISTINCT FROM 'archived'
--   - we use public.tax_returns.filed_date (the canonical Hub table)
--     for filed-returns YTD; proconnect_engagements.efile_status is
--     more accurate but not all returns flow through ProConnect yet.
--   - organizations.state is the source of truth for states served.
CREATE OR REPLACE VIEW marketing.firm_stats_public AS
SELECT
  -- Active client count: contacts not flagged as prospect or archived.
  (SELECT count(*)::int
     FROM public.contacts
    WHERE coalesce(is_prospect, false) = false
      AND (status IS NULL OR status NOT IN ('archived', 'inactive', 'lost'))
  ) AS active_clients,
  -- Tax returns filed in the current calendar year per Hub records.
  (SELECT count(*)::int
     FROM public.tax_returns
    WHERE filed_date IS NOT NULL
      AND date_trunc('year', filed_date) = date_trunc('year', now())
  ) AS returns_filed_ytd,
  -- States we serve, distinct count from organizations + contacts.
  (SELECT count(DISTINCT s)::int FROM (
     SELECT upper(state) AS s FROM public.organizations
       WHERE state IS NOT NULL AND state <> ''
     UNION
     SELECT upper(state) AS s FROM public.contacts
       WHERE state IS NOT NULL AND state <> ''
   ) u) AS states_served,
  -- Last-updated stamp — marketing site can show "as of <time>".
  now() AS as_of;

-- The view runs as the role that QUERIES it. Anon doesn't have
-- SELECT on the underlying public.* tables, so we expose this view
-- as SECURITY DEFINER via a function instead, then GRANT EXECUTE.
CREATE OR REPLACE FUNCTION marketing.firm_stats_public_rpc()
RETURNS TABLE (
  active_clients int,
  returns_filed_ytd int,
  states_served int,
  as_of timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, marketing
AS $$
  SELECT active_clients, returns_filed_ytd, states_served, as_of
    FROM marketing.firm_stats_public;
$$;

REVOKE ALL ON FUNCTION marketing.firm_stats_public_rpc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing.firm_stats_public_rpc() TO anon;

-- ── 6. Cross-project event log ───────────────────────────────────
-- Every cross-project hit (marketing -> Hub or Hub -> marketing) is
-- logged here so we have a single audit trail across both Vercel
-- projects. Useful for: "did this newsletter signup actually reach
-- the Hub?", "is the marketing site rate-limited?", etc.
CREATE TABLE IF NOT EXISTS marketing.cross_project_events (
  id bigserial PRIMARY KEY,
  -- "site->hub" or "hub->site"
  direction text NOT NULL CHECK (direction IN ('site->hub', 'hub->site')),
  -- The endpoint hit, e.g. "/api/public/newsletter"
  endpoint text NOT NULL,
  -- HTTP status returned
  status int,
  -- Free-form context — request id, user agent, error, etc.
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cross_project_events_recent_idx
  ON marketing.cross_project_events (created_at DESC);

ALTER TABLE marketing.cross_project_events ENABLE ROW LEVEL SECURITY;
-- Anon: no access. Service role: full access (used by Hub middleware).
DROP POLICY IF EXISTS cross_project_events_anon_no_access
  ON marketing.cross_project_events;
CREATE POLICY cross_project_events_anon_no_access
  ON marketing.cross_project_events
  FOR ALL TO anon USING (false) WITH CHECK (false);
