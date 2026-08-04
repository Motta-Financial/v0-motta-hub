-- 354: firm_settings — first step of the single-tenant → licensable
-- product conversion. Every firm-specific value the app previously
-- hardcoded (domains, URLs, email addresses, timezone, CORS hosts)
-- gets a durable home here. lib/firm-settings.ts is the only reader;
-- resolution order there is DB row → env var → coded Motta default,
-- so a missing row or missing table can never break the app.
--
-- Multi-tenancy note: when tenant_id lands (THEN-tier roadmap), this
-- table gains a tenant_id column and the PK becomes (tenant_id, key).
-- Keys are namespaced (firm.*, assistant.*, integrations.*) to keep
-- that migration mechanical.

CREATE TABLE IF NOT EXISTS firm_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE firm_settings ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in team member (values are firm metadata,
-- not secrets — credentials stay in env vars / the future vault).
-- Writes go through the service role only (admin API routes), so no
-- INSERT/UPDATE/DELETE policies are defined.
DROP POLICY IF EXISTS firm_settings_read ON firm_settings;
CREATE POLICY firm_settings_read ON firm_settings
  FOR SELECT TO authenticated USING (true);

INSERT INTO firm_settings (key, value, description) VALUES
  ('firm.name',                   '"Motta Financial"',
   'Display name used in emails, PDFs, page titles.'),
  ('firm.short_name',             '"Motta"',
   'Short brand name for compact UI contexts.'),
  ('firm.hub_url',                '"https://hub.motta.cpa"',
   'Canonical Hub base URL — links in notifications, OAuth redirects, webhook targets.'),
  ('firm.public_site_url',        '"https://motta.cpa"',
   'Public marketing site base URL.'),
  ('firm.internal_email_domains', '["motta.cpa", "mottafinancial.com"]',
   'Email domains that identify firm staff (vs. clients) in matchers and intake flows.'),
  ('firm.from_email',             '"ALFRED Ai <Info@mottafinancial.com>"',
   'Default From: header for outbound transactional email.'),
  ('firm.support_email',          '"Info@mottafinancial.com"',
   'Reply-to / support inbox surfaced to clients.'),
  ('firm.timezone',               '"America/New_York"',
   'Firm home timezone for cron windows, briefings, and scheduling math.'),
  ('firm.cors_allowed_hosts',     '["motta.cpa", "www.motta.cpa", "hub.motta.cpa", "www.mottafinancial.com", "mottafinancial.com"]',
   'Origins allowed to call the public intake/contact endpoints.'),
  ('firm.cors_preview_prefixes',  '["newmottawebsite", "motta-", "v0-motta-hub"]',
   'Vercel preview hostname prefixes treated as first-party during QA.'),
  ('assistant.name',              '"ALFRED"',
   'The AI assistant brand name shown across the Hub.'),
  ('assistant.email',             '"Info@mottafinancial.com"',
   'Service-account identity ALFRED acts as (Karbon notes, email sends).')
ON CONFLICT (key) DO NOTHING;
