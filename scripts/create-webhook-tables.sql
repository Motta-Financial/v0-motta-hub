-- Create table to track webhook subscriptions
CREATE TABLE IF NOT EXISTS karbon_webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  karbon_subscription_id TEXT UNIQUE NOT NULL,
  webhook_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  signing_key_configured BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create table to log webhook events
CREATE TABLE IF NOT EXISTS karbon_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_perma_key TEXT,
  resource_client_key TEXT,
  payload JSONB,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_webhook_events_resource_type ON karbon_webhook_events(resource_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON karbon_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_type ON karbon_webhook_subscriptions(webhook_type);

-- Add RLS policies
ALTER TABLE karbon_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE karbon_webhook_events ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view subscriptions
CREATE POLICY "Allow authenticated users to view webhook subscriptions"
  ON karbon_webhook_subscriptions FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to view webhook events
CREATE POLICY "Allow authenticated users to view webhook events"
  ON karbon_webhook_events FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to webhook subscriptions"
  ON karbon_webhook_subscriptions FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "Allow service role full access to webhook events"
  ON karbon_webhook_events FOR ALL
  TO service_role
  USING (true);
