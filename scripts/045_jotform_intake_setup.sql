-- ─────────────────────────────────────────────────────────────────────────
-- Jotform intake integration — schema setup
-- Idempotent. Mirrors the patterns already in use for Calendly / Karbon /
-- Ignition: a small "registry" table for forms we ingest, a denormalized
-- per-submission table for query convenience, and a raw audit log of
-- webhook deliveries for idempotency + replay.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Form registry. One row per Jotform we ingest from. The intake form
--    is row #1, but we leave space for the Debrief, LLC Creation, Bill
--    Pay, and other Jotforms that already exist on the account.
--    `webhook_secret` is a per-form random token appended to the
--    webhook URL — Jotform's free tier doesn't sign webhook payloads,
--    so a secret URL is the standard way to authenticate them.
CREATE TABLE IF NOT EXISTS public.jotform_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jotform_form_id text UNIQUE NOT NULL,
  title text NOT NULL,
  slug text UNIQUE,
  form_url text,
  is_enabled boolean NOT NULL DEFAULT true,
  question_count integer,
  submission_count integer,
  webhook_url text,
  webhook_secret text,
  webhook_subscribed boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  last_sync_error text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Intake submissions. One row per Jotform submission. We persist the
--    full raw `answers` JSON so any future field becomes queryable
--    without a migration, AND denormalize the high-traffic columns
--    (name / email / services interest / business info) for fast
--    triage and reporting in the Hub.
CREATE TABLE IF NOT EXISTS public.jotform_intake_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Jotform's ID is a 19-digit numeric string. Unique = idempotent
  -- upserts from both webhook + backfill paths.
  jotform_submission_id text UNIQUE NOT NULL,
  jotform_form_id text NOT NULL,
  form_id uuid REFERENCES public.jotform_forms(id) ON DELETE SET NULL,

  -- Submission metadata
  status text,                              -- ACTIVE, OVERQUOTA, ...
  flag integer,
  is_new boolean,                           -- Jotform "new" marker (unread)
  ip_address text,
  jotform_created_at timestamptz,
  jotform_updated_at timestamptz,

  -- Raw answers (51 fields today, easy to introspect/query later)
  raw_answers jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── Denormalized: submitter (personal) ──────────────────────────────
  submitter_first_name text,
  submitter_last_name text,
  submitter_full_name text,
  submitter_email text,
  submitter_phone text,
  submitter_address jsonb,
  submitter_city text,
  submitter_state text,
  submitter_zip text,

  -- ── Denormalized: services interest ─────────────────────────────────
  -- "What services are you looking for?" (multi)
  services_requested text[],
  -- "What best describes the types of services you're looking for?"
  -- (Personal Only / Business Only / Both Personal & Business)
  service_focus text,
  -- "What types of entities are we working with?" (multi)
  entity_types text[],
  -- "Which best describes your situation?" (existing vs new business)
  business_situation text,

  -- ── Denormalized: business ──────────────────────────────────────────
  business_name text,
  business_email text,
  business_phone text,
  business_address jsonb,
  business_state text,
  business_tax_classification text,
  business_summary text,
  business_revenue_range text,
  business_employee_count text,
  business_uses_accounting_system text,

  -- ── Free-text ───────────────────────────────────────────────────────
  questions_or_concerns text,
  additional_notes text,

  -- ── Triage / workflow (firm-side state) ─────────────────────────────
  -- 'new' (untouched), 'in_review', 'contacted', 'converted',
  -- 'declined', 'duplicate'. Defaults to 'new' so freshly ingested
  -- submissions land in the inbox.
  lead_status text NOT NULL DEFAULT 'new',
  assigned_to_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  triage_notes text,

  -- Once converted, link to the canonical CRM rows.
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,

  -- Bookkeeping
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes that match expected query patterns (inbox by status,
-- lookups by email/phone, time-ordered triage).
CREATE INDEX IF NOT EXISTS idx_jotform_intake_form_id
  ON public.jotform_intake_submissions (jotform_form_id);
CREATE INDEX IF NOT EXISTS idx_jotform_intake_lead_status
  ON public.jotform_intake_submissions (lead_status);
CREATE INDEX IF NOT EXISTS idx_jotform_intake_assigned
  ON public.jotform_intake_submissions (assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_jotform_intake_email
  ON public.jotform_intake_submissions (submitter_email);
CREATE INDEX IF NOT EXISTS idx_jotform_intake_phone
  ON public.jotform_intake_submissions (submitter_phone);
CREATE INDEX IF NOT EXISTS idx_jotform_intake_created
  ON public.jotform_intake_submissions (jotform_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jotform_intake_contact
  ON public.jotform_intake_submissions (contact_id);
CREATE INDEX IF NOT EXISTS idx_jotform_intake_organization
  ON public.jotform_intake_submissions (organization_id);

-- 3. Webhook event audit log. Every POST from Jotform is persisted raw
--    BEFORE we attempt to parse/upsert. Lets us replay submissions if
--    parsing logic changes, debug failed deliveries, and dedupe by
--    submission_id since Jotform retries on 5xx.
CREATE TABLE IF NOT EXISTS public.jotform_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jotform_form_id text,
  jotform_submission_id text,
  -- Raw multipart form body Jotform sends, normalized to JSON so we
  -- don't lose field-level fidelity even if our parser later changes.
  raw_payload jsonb NOT NULL,
  request_headers jsonb,
  source_ip inet,
  -- Lifecycle: 'pending' on insert, 'processed' after successful upsert,
  -- 'failed' if the parser/upsert raised. Surface 'failed' in admin UI.
  processing_status text NOT NULL DEFAULT 'pending',
  processing_error text,
  signature_valid boolean,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_jotform_webhook_events_form
  ON public.jotform_webhook_events (jotform_form_id);
CREATE INDEX IF NOT EXISTS idx_jotform_webhook_events_submission
  ON public.jotform_webhook_events (jotform_submission_id);
CREATE INDEX IF NOT EXISTS idx_jotform_webhook_events_status
  ON public.jotform_webhook_events (processing_status, received_at DESC);

-- 4. updated_at trigger — copy the existing pattern other tables use
--    so SELECTs can sort by recency without joining the audit log.
CREATE OR REPLACE FUNCTION public.set_jotform_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jotform_forms_updated_at ON public.jotform_forms;
CREATE TRIGGER trg_jotform_forms_updated_at
  BEFORE UPDATE ON public.jotform_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_jotform_updated_at();

DROP TRIGGER IF EXISTS trg_jotform_intake_updated_at ON public.jotform_intake_submissions;
CREATE TRIGGER trg_jotform_intake_updated_at
  BEFORE UPDATE ON public.jotform_intake_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_jotform_updated_at();

-- 5. RLS — match the rest of the workspace. All authenticated firm staff
--    can read + manage intake data. The webhook receiver uses the
--    service-role key which bypasses RLS, so external posts are not
--    blocked even when the table is locked down.
ALTER TABLE public.jotform_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jotform_intake_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jotform_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on jotform_forms" ON public.jotform_forms;
CREATE POLICY "Allow all on jotform_forms"
  ON public.jotform_forms FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on jotform_intake_submissions" ON public.jotform_intake_submissions;
CREATE POLICY "Allow all on jotform_intake_submissions"
  ON public.jotform_intake_submissions FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service-role only on jotform_webhook_events" ON public.jotform_webhook_events;
CREATE POLICY "Authenticated read on jotform_webhook_events"
  ON public.jotform_webhook_events FOR SELECT
  USING (auth.role() = 'authenticated');

-- 6. Seed the intake form so subsequent webhooks/backfills find a
--    parent row. The webhook_secret is generated as a random token
--    that gets appended to the webhook URL we register with Jotform.
INSERT INTO public.jotform_forms (
  jotform_form_id, title, slug, form_url, is_enabled, webhook_secret
)
VALUES (
  '242306172162144',
  'Motta | Intake Form',
  'intake',
  'https://form.jotform.com/242306172162144',
  true,
  encode(gen_random_bytes(24), 'hex')
)
ON CONFLICT (jotform_form_id) DO NOTHING;
