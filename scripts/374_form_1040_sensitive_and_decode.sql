-- 374: Sensitive-field access audit log + enum value decoding for the
--      Form 1040 viewer.
--
-- Two concerns, one migration:
--
--   1. SSNs / EINs / bank routing + account numbers must never leave the
--      server unmasked on the render endpoint. Reveals happen through a
--      dedicated endpoint that logs WHO looked at WHAT, WHEN. This table
--      is that audit trail.
--
--   2. Some ProConnect cells carry enum CODES, not labels (e.g. line 35c
--      account type exports as "2", which was observed to mean "checking"
--      on a real Phase 1 export). `value_decode` stores a code→label map
--      per mapped line so the renderer can translate without hardcoding.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS sensitive_field_access_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id   text NOT NULL,
  line_code   text NOT NULL,
  accessed_by text,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  context     text
);

ALTER TABLE sensitive_field_access_log ENABLE ROW LEVEL SECURITY;

-- Service-role only (written by API routes with the service key);
-- no user-facing access needed.
DROP POLICY IF EXISTS sensitive_field_access_log_service_only ON sensitive_field_access_log;
CREATE POLICY sensitive_field_access_log_service_only ON sensitive_field_access_log
  FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_sensitive_field_access_log_return
  ON sensitive_field_access_log (return_id, accessed_at DESC);

COMMENT ON TABLE sensitive_field_access_log IS
  'Audit trail for reveals of masked sensitive 1040 fields (SSN/EIN/routing/account). One row per reveal via /api/forms/1040/[returnId]/reveal.';

-- Code→label map for enum-coded cells, e.g. '{"2": "checking", "1": "savings"}'.
ALTER TABLE form_1040_proconnect_map
  ADD COLUMN IF NOT EXISTS value_decode jsonb;

COMMENT ON COLUMN form_1040_proconnect_map.value_decode IS
  'Optional code→label translation for enum-coded ProConnect values (e.g. 35c account type: {"2": "checking", "1": "savings"}). Renderer passes unknown codes through as "Code <n>".';

-- Seed 35c (TY2025 IND account type). 2=checking was observed on a real
-- export; 1=savings is presumed and NOT yet verified — which is why
-- confidence stays 'inferred'. Do NOT upgrade confidence here.
UPDATE form_1040_proconnect_map
SET value_decode = '{"2": "checking", "1": "savings"}'::jsonb
WHERE tax_year = 2025
  AND return_type = 'IND'
  AND line_code = '35c';
