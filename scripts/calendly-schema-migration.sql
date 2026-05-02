-- ─────────────────────────────────────────────────────────────────────────
-- Calendly schema migration: add tracking columns + webhook subscription
-- table needed by the refactored OAuth-aware integration.
-- Idempotent: every column add and table create uses IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Connection-level health columns. We track each connection's webhook
--    subscription separately (rather than relying on the legacy
--    CALENDLY_WEBHOOK_* env vars) and surface the most recent error so the
--    UI can prompt the user to re-authorize without round-tripping the API.
ALTER TABLE public.calendly_connections
  ADD COLUMN IF NOT EXISTS webhook_subscribed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_subscription_uri text,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz;

-- 2. Webhook subscription registry. One row per Calendly webhook URI we
--    register on behalf of a user. Multiple subscriptions may exist per
--    connection (e.g. one per scope/event), so we key on the URI and link
--    back to the connection that owns it.
CREATE TABLE IF NOT EXISTS public.calendly_webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES public.calendly_connections(id) ON DELETE CASCADE,
  calendly_webhook_uri text UNIQUE NOT NULL,
  callback_url text NOT NULL,
  scope text,
  state text,
  organization_uri text,
  user_uri text,
  events text[],
  signing_key text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendly_webhook_sub_connection
  ON public.calendly_webhook_subscriptions(connection_id);

-- 3. Webhook event audit log — append-only record of every payload received,
--    used for replay debugging and signature verification stats.
CREATE TABLE IF NOT EXISTS public.calendly_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  calendly_event_uuid text,
  signature_valid boolean NOT NULL DEFAULT false,
  signature_error text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);

CREATE INDEX IF NOT EXISTS idx_calendly_webhook_events_type_time
  ON public.calendly_webhook_events(event_type, received_at DESC);
