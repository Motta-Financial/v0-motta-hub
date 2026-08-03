-- 355: Wrap bare auth.role() calls in RLS policies with a scalar
-- subquery. Postgres re-evaluates a bare auth.role() FOR EVERY ROW the
-- policy filters; (SELECT auth.role()) is hoisted into an InitPlan and
-- evaluated once per statement. Flagged by the Supabase performance
-- advisor (auth_rls_initplan) on every proconnect_* table — these are
-- the tables the tax dashboard scans hardest (proconnect_engagements
-- ~900 rows and growing every season, proconnect_clients 2,253,
-- proconnect_return_field_cells up to ~5k per return).
--
-- Semantics are identical; this is purely an evaluation-cost fix.

ALTER POLICY "Authenticated read on jotform_webhook_events" ON jotform_webhook_events
  USING ((SELECT auth.role()) = 'authenticated');

ALTER POLICY proconnect_clients_read ON proconnect_clients
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated','service_role']));
ALTER POLICY proconnect_clients_write ON proconnect_clients
  USING ((SELECT auth.role()) = 'service_role');

ALTER POLICY proconnect_custom_statuses_read ON proconnect_custom_statuses
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated','service_role']));
ALTER POLICY proconnect_custom_statuses_write ON proconnect_custom_statuses
  USING ((SELECT auth.role()) = 'service_role');

ALTER POLICY proconnect_engagements_read ON proconnect_engagements
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated','service_role']));
ALTER POLICY proconnect_engagements_write ON proconnect_engagements
  USING ((SELECT auth.role()) = 'service_role');

ALTER POLICY proconnect_oauth_tokens_service ON proconnect_oauth_tokens
  USING ((SELECT auth.role()) = 'service_role');

ALTER POLICY proconnect_sync_logs_read ON proconnect_sync_logs
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated','service_role']));
ALTER POLICY proconnect_sync_logs_write ON proconnect_sync_logs
  USING ((SELECT auth.role()) = 'service_role');

ALTER POLICY proconnect_webhook_events_service ON proconnect_webhook_events
  USING ((SELECT auth.role()) = 'service_role');
