-- 130_proconnect_return_data.sql
--
-- Phase 1 of the ProConnect Open API: Series-Map Export & Import endpoints.
-- See user_read_only_context/text_attachments/ProConnect-Open-API-Doc---Phase-1-(external-view)-mSn4k.pdf
--
-- This migration adds three first-class concepts that we have zero coverage
-- for today:
--
--   1. proconnect_return_snapshots
--      Header row per (client, return) capturing the latest export. Stores
--      the version stamp + per-series version stamps so subsequent
--      diff/import flows can pass the correct optimistic-concurrency
--      `version` back to ProConnect.
--
--   2. proconnect_return_field_cells
--      One row per leaf cell (series, prefix, code, suffix). This is the
--      query-friendly normalization of the nested data tree returned by
--      GET /v2/clients/{c}/returns/{r}/data. We keep raw_json on the
--      snapshot row for forensics, but every code lookup, search, and
--      ALFRED query goes through this normalized table.
--
--   3. proconnect_import_jobs + proconnect_import_entry_results
--      Audit log for every POST /v2/clients/{c}/returns/{r}/import/series/{s}.
--      Captures dryRun vs commit, the entries we attempted, and the
--      per-entry success/failure results. This is what the Tax team will
--      reconcile against when an import partially fails (the API returns
--      200 even with failures — see §B.6).
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------

-- 1. Snapshot header (one row per return)
CREATE TABLE IF NOT EXISTS proconnect_return_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ProConnect identifiers
  proconnect_client_id    text NOT NULL,
  return_id               uuid NOT NULL,
  firm_id                 uuid,
  -- Display / metadata from the export response
  return_name             text,
  client_name             text,
  tax_year                integer,
  return_type             text,        -- IND | COR | SCO | PAR | FID | EXM | GFT
  -- Optimistic concurrency
  version                 uuid,        -- top-level `version` (UUIDv1) — required on subsequent imports
  series_versions         jsonb,       -- [{series, version}] from export
  -- E-file + agency snapshots
  efile_items             jsonb,       -- [{efileId, included}]
  agencies                jsonb,       -- [{abbrev}]
  -- Full nested series map for forensics. Use proconnect_return_field_cells
  -- for all queryable access — do NOT scan this jsonb at request time.
  raw_data                jsonb,
  -- ProConnect lifecycle
  proconnect_created_time timestamptz,
  proconnect_created_by   text,
  -- Sync bookkeeping
  exported_at             timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proconnect_return_snapshots_uniq
    UNIQUE (proconnect_client_id, return_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_snapshots_client
  ON proconnect_return_snapshots (proconnect_client_id);
CREATE INDEX IF NOT EXISTS idx_pc_snapshots_return
  ON proconnect_return_snapshots (return_id);
CREATE INDEX IF NOT EXISTS idx_pc_snapshots_year_type
  ON proconnect_return_snapshots (tax_year, return_type);

COMMENT ON TABLE proconnect_return_snapshots IS
  'One row per (clientId, returnId) capturing the latest GET /v2/.../data response. The `version` and `series_versions` fields are required when issuing a subsequent POST import.';

-- 2. Normalized leaf cells (one row per series/prefix/code/suffix)
CREATE TABLE IF NOT EXISTS proconnect_return_field_cells (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   uuid NOT NULL REFERENCES proconnect_return_snapshots(id) ON DELETE CASCADE,
  return_id     uuid NOT NULL,
  -- Series-map locators (matches §1.1 of the Phase 1 doc)
  series_id     text NOT NULL,                 -- e.g. "s1", "s11", "s200"
  prefix_id     text NOT NULL DEFAULT 'p0',
  code_id       text NOT NULL,                 -- e.g. "c43", "c1000110153"
  suffix_id     text NOT NULL DEFAULT 'x1000',
  -- FieldCell payload
  val           text,
  description   text,                          -- aliased from JSON `desc` (reserved word in SQL)
  src           text,                          -- agency abbrev (US, CA, …)
  tsj           text,                          -- T | S | J | N | ''
  scope         text,                          -- Federal | State | Global | …
  source        text,                          -- data-entry source indicator
  city_abbrev   text,
  import_source text[],                        -- ['isDetailImport', …]
  -- Full leaf JSON for forwards-compat (the doc warns clients must ignore unknown fields)
  raw_cell      jsonb,
  exported_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proconnect_return_cells_uniq
    UNIQUE (return_id, series_id, prefix_id, code_id, suffix_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_cells_snapshot
  ON proconnect_return_field_cells (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_pc_cells_return_series
  ON proconnect_return_field_cells (return_id, series_id);
CREATE INDEX IF NOT EXISTS idx_pc_cells_code
  ON proconnect_return_field_cells (code_id);
CREATE INDEX IF NOT EXISTS idx_pc_cells_src
  ON proconnect_return_field_cells (src) WHERE src IS NOT NULL;

COMMENT ON TABLE proconnect_return_field_cells IS
  'Normalized leaf nodes from the GET /v2/.../data response. Truncated and re-loaded on every export — never patched in place — so the table always reflects the most recent ProConnect snapshot.';

-- 3. Import job audit log (header + per-entry results)
CREATE TABLE IF NOT EXISTS proconnect_import_jobs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Targeting
  proconnect_client_id     text NOT NULL,
  return_id                uuid NOT NULL,
  series_id                text NOT NULL,                 -- "s11"
  -- Request shape
  dry_run                  boolean NOT NULL DEFAULT false,
  request_version          uuid,                          -- the `version` we sent on POST
  entry_count_requested    integer NOT NULL,
  entries_payload          jsonb,                         -- the full {entries: [...]} we POSTed
  -- Response
  status                   text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','partial','failed')),
  http_status              integer,
  imported_count           integer NOT NULL DEFAULT 0,
  error_count              integer NOT NULL DEFAULT 0,
  response_version         uuid,                          -- new per-series version returned (omitted on dryRun)
  response_summary         jsonb,
  response_raw             jsonb,
  -- Bookkeeping
  triggered_by             text,                          -- e.g. 'manual:tom@motta.com', 'cron', 'webhook'
  trigger_context          jsonb,                         -- arbitrary context (request id, source page, …)
  intuit_tid               text,                          -- correlation id we sent on the request
  error_message            text,
  started_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  CONSTRAINT proconnect_import_jobs_status_chk
    CHECK ( (status = 'pending' AND completed_at IS NULL) OR completed_at IS NOT NULL )
);

CREATE INDEX IF NOT EXISTS idx_pc_import_jobs_return
  ON proconnect_import_jobs (return_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_import_jobs_client
  ON proconnect_import_jobs (proconnect_client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_import_jobs_status
  ON proconnect_import_jobs (status) WHERE status IN ('failed','partial','pending');

COMMENT ON TABLE proconnect_import_jobs IS
  'One row per POST /v2/.../import/series/{s} call. Required for audit, retry, and reconciling partial-success responses (the API returns 200 even when some entries fail — see §B.6 of the Phase 1 doc).';

-- 4. Per-entry results for failed imports (the API only returns errors,
--    not successes, so we leave imported entries to be implied from
--    proconnect_import_jobs.imported_count + the entries_payload).
CREATE TABLE IF NOT EXISTS proconnect_import_entry_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES proconnect_import_jobs(id) ON DELETE CASCADE,
  prefix_id       text NOT NULL,
  code_id         text NOT NULL,
  suffix_id       text NOT NULL,
  -- Stored validation failures from the response
  -- [{code, field, message}, …]
  error_details   jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_import_entry_results_job
  ON proconnect_import_entry_results (job_id);

COMMENT ON TABLE proconnect_import_entry_results IS
  'Per-entry validation failures from POST /v2/.../import/series/{s}. The Phase 1 doc §B.6 returns an `errors[]` array with prefixId, codeId, suffixId, and errorDetails — all preserved here verbatim.';

-- 5. Trigger: keep updated_at on snapshots fresh on every change
CREATE OR REPLACE FUNCTION proconnect_return_snapshots_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pc_snapshots_updated_at ON proconnect_return_snapshots;
CREATE TRIGGER trg_pc_snapshots_updated_at
  BEFORE UPDATE ON proconnect_return_snapshots
  FOR EACH ROW EXECUTE FUNCTION proconnect_return_snapshots_set_updated_at();

-- 6. View: latest export per return joined with engagement context.
--    /api/proconnect/returns/[returnId] reads from this view directly.
DROP VIEW IF EXISTS proconnect_returns_with_data;
CREATE VIEW proconnect_returns_with_data AS
SELECT
  s.id                      AS snapshot_id,
  s.proconnect_client_id,
  s.return_id,
  s.firm_id,
  s.return_name,
  s.client_name,
  s.tax_year,
  s.return_type,
  s.version,
  s.series_versions,
  s.efile_items,
  s.agencies,
  s.proconnect_created_time,
  s.proconnect_created_by,
  s.exported_at,
  -- Joins back to the engagement we already track so the UI can show
  -- preparer + custom status alongside the field data.
  e.engagement_id,
  e.preparer_name,
  e.user_defined_status_name,
  e.user_defined_status_color,
  c.display_name           AS client_display_name,
  c.client_type
FROM proconnect_return_snapshots s
LEFT JOIN proconnect_engagements_enriched e
  ON e.engagement_id::text = s.return_id::text
LEFT JOIN proconnect_clients c
  ON c.proconnect_client_id = s.proconnect_client_id;

COMMENT ON VIEW proconnect_returns_with_data IS
  'Latest export snapshot per return joined with the enriched engagement view (preparer, custom status) and the client display name. /api/proconnect/returns/* reads from this view.';
