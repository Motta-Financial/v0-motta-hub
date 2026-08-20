-- 401_proconnect_tax_return_creation_jobs.sql
--
-- Closes the one confirmed gap from the Phase 1+ ProConnect Open API doc
-- (external view) that the Hub had zero coverage for: Create Tax Return
-- in PTO.
--
--   POST https://{DATA_SERVICE}/v2/clients/oii-client/{clientOiiId}/returns
--   Payload: { name, type, year, source }
--
-- Same audit discipline as proconnect_import_jobs (script 130): every
-- attempt is recorded, including rejected ones, so "why does this client
-- have an extra return in PTO" is always answerable. This matters more
-- here than on Import — the doc has no delete/clear endpoint for tax
-- returns at all, so a bad create is not recoverable through the API.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS proconnect_tax_return_creation_jobs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Origin — nullable so this table can also serve non-prospect callers later.
  prospect_submission_id  uuid REFERENCES prospect_submissions(id) ON DELETE SET NULL,
  -- Targeting (matched server-side, never trusted from the request body)
  proconnect_client_id    text NOT NULL,
  -- Request shape (mirrors the Data Service payload verbatim)
  requested_name          text NOT NULL,
  requested_type          text NOT NULL,   -- IND | COR | PAR | SCO | FID | EXM | GFT
  requested_year          integer NOT NULL,
  requested_source        text,            -- prior-year engagement id, for proforma
  -- Response
  status                  text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  http_status             integer,
  response_raw            jsonb,
  -- Best-effort id extracted from the create response — the doc does not
  -- document the response shape, so this may be null even on success.
  -- The nightly/on-demand engagement sync is the reliable path to a row
  -- in proconnect_engagements, not this column.
  created_engagement_id   text,
  error_message           text,
  -- Bookkeeping — same convention as proconnect_import_jobs
  triggered_by            text,            -- e.g. 'manual:tom@motta.com'
  trigger_context         jsonb,
  intuit_tid              text,
  started_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,
  CONSTRAINT proconnect_tax_return_creation_jobs_status_chk
    CHECK ( (status = 'pending' AND completed_at IS NULL) OR completed_at IS NOT NULL )
);

CREATE INDEX IF NOT EXISTS idx_pc_return_creation_jobs_prospect
  ON proconnect_tax_return_creation_jobs (prospect_submission_id)
  WHERE prospect_submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pc_return_creation_jobs_client
  ON proconnect_tax_return_creation_jobs (proconnect_client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_return_creation_jobs_status
  ON proconnect_tax_return_creation_jobs (status) WHERE status IN ('failed', 'pending');

COMMENT ON TABLE proconnect_tax_return_creation_jobs IS
  'One row per POST /v2/clients/oii-client/{id}/returns call (Create Tax Return in PTO). Audited like proconnect_import_jobs — there is no delete endpoint for a created return, so every attempt (including rejected ones) must be reconstructable later.';
