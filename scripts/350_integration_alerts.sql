-- 350: Tiny state table for integration failure alerting.
--
-- The Karbon API credentials went invalid on ~2026-06-23 and nothing
-- alerted for 17 days (the karbon-sync cron logged partial_failure
-- every run but had no alert path — unlike the ProConnect cron, which
-- emails after 3 consecutive failures). This table stores the last
-- alert timestamp per integration so crons can send at most one alert
-- per day without inventing per-cron columns.

CREATE TABLE IF NOT EXISTS integration_alerts (
  integration text PRIMARY KEY,
  last_alert_at timestamptz NOT NULL DEFAULT now(),
  last_alert_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE integration_alerts ENABLE ROW LEVEL SECURITY;

-- Service-role only (crons/webhooks); no user-facing access needed.
DROP POLICY IF EXISTS integration_alerts_service_only ON integration_alerts;
CREATE POLICY integration_alerts_service_only ON integration_alerts
  FOR ALL USING (false);

COMMENT ON TABLE integration_alerts IS
  'Last-alert-sent tracking per integration (e.g. karbon_auth). Used by cron routes to dedupe failure emails to ~1/day.';
