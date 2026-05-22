-- ============================================================================
-- Form 1040 Knowledge Base (TY-scoped, ProConnect-agnostic)
-- ============================================================================
-- Three tables that together encode "what is Form 1040" inside the Hub:
--
--   form_1040_lines           Canonical line schema (1a, 1b, 1z, 12e, 35a, ...)
--                             Every entry on the 2-page PDF, by tax year.
--   form_1040_proconnect_map  Per-(tax_year, line_code, return_type) mapping
--                             to the ProConnect series-map cell tuple. NULL
--                             until discovered from a real export — never
--                             guessed. (Same rule as ProConnect profiles +
--                             Tommy identity: do not fabricate.)
--   form_1040_constants       Year-scoped constants (std deduction amounts,
--                             age cutoff dates, etc.) that the form refers to
--                             but doesn't carry. Lets us bump TY without code.
--
-- The schema is intentionally independent of ProConnect — these tables would
-- be just as useful for a Drake/CCH/UltraTax integration. proconnect_map is
-- the only ProConnect-specific table and it's a foreign concept; the lines
-- table itself is purely an IRS artifact.
-- ============================================================================

CREATE TABLE IF NOT EXISTS form_1040_lines (
  id              SERIAL PRIMARY KEY,
  tax_year        INTEGER NOT NULL,
  line_code       TEXT    NOT NULL,         -- '1a', '1z', '6c', '12e', '25c', '35a'
  parent_code     TEXT,                     -- '1' parents 1a..1z; '12' parents 12a..12e; etc.
  ordinal         INTEGER NOT NULL,         -- display order within section
  section         TEXT    NOT NULL,         -- header | filing_status | digital_assets
                                            --   | dependents | income | tax_credits
                                            --   | payments | refund | amount_owed
                                            --   | signature | third_party
  label           TEXT    NOT NULL,
  short_label     TEXT,                     -- compact label for dense table views
  data_type       TEXT    NOT NULL,         -- currency | integer | boolean | text
                                            --   | ssn | ein | date | enum
                                            --   | checkbox_group | phone | email
                                            --   | routing | account
  enum_options    JSONB,                    -- for data_type = enum
  is_computed     BOOLEAN NOT NULL DEFAULT false,
  computation     JSONB,                    -- { kind: 'sum'|'diff'|'copy'|'subtract_floor_zero', operands: [...] }
  schedule_ref    TEXT,                     -- 'Schedule 1, line 10' (where the value lives if not on 1040)
  worksheet_ref   TEXT,                     -- 'Qualified Dividends and Capital Gain Tax Worksheet'
  attaches_form   TEXT,                     -- 'Form 8814' | 'Form 4972' | 'Schedule SE'
  is_refund_path  BOOLEAN NOT NULL DEFAULT false,   -- only relevant for refund/owed lines
  notes           TEXT,                     -- 1-3 sentence digest from 2025 instructions
  CONSTRAINT form_1040_lines_unique UNIQUE (tax_year, line_code)
);

CREATE INDEX IF NOT EXISTS idx_form_1040_lines_section
  ON form_1040_lines (tax_year, section, ordinal);

-- ---------------------------------------------------------------------------
-- ProConnect cell mapping. NULL series_id means "not yet discovered".
-- One row per (tax_year, line_code, return_type) — return_type lets us
-- accommodate the case where ProConnect uses different series for different
-- 1040 variants (1040 vs 1040-SR vs 1040-NR), even though the line numbers
-- are identical. cell_field tells the composer which leaf field on the cell
-- (val / desc / tsj / scope) actually carries this line's value. 99% of
-- numeric lines use 'val'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_1040_proconnect_map (
  tax_year         INTEGER NOT NULL,
  line_code        TEXT    NOT NULL,
  return_type      TEXT    NOT NULL DEFAULT 'IND',
  series_id        TEXT,
  prefix_id        TEXT,
  code_id          TEXT,
  suffix_id        TEXT,
  cell_field       TEXT    NOT NULL DEFAULT 'val',
  confidence       TEXT    NOT NULL DEFAULT 'unknown',  -- unknown | inferred | confirmed
  discovered_at    TIMESTAMPTZ,
  discovered_from  UUID REFERENCES proconnect_return_snapshots(id) ON DELETE SET NULL,
  notes            TEXT,
  PRIMARY KEY (tax_year, line_code, return_type),
  CONSTRAINT form_1040_pcmap_fk_line
    FOREIGN KEY (tax_year, line_code)
    REFERENCES form_1040_lines (tax_year, line_code)
    ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- TY-scoped constants. Examples (TY2025):
--   std_deduction_single        : 15750
--   std_deduction_mfj           : 31500
--   std_deduction_hoh           : 23625
--   std_deduction_mfs           : 15750
--   age_65_cutoff_birthdate     : '1961-01-02'   (born BEFORE this = age 65+)
--   epc_amount_per_taxpayer     : 3              (Presidential Election Campaign fund)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_1040_constants (
  tax_year  INTEGER NOT NULL,
  key       TEXT    NOT NULL,
  value     JSONB   NOT NULL,
  notes     TEXT,
  PRIMARY KEY (tax_year, key)
);

-- ---------------------------------------------------------------------------
-- Convenience view: every TY2025 line joined to its current PC mapping.
-- Lets the dashboard render a colored coverage matrix in one query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW form_1040_lines_with_map AS
SELECT
  l.id,
  l.tax_year,
  l.line_code,
  l.parent_code,
  l.ordinal,
  l.section,
  l.label,
  l.short_label,
  l.data_type,
  l.enum_options,
  l.is_computed,
  l.computation,
  l.schedule_ref,
  l.worksheet_ref,
  l.attaches_form,
  l.notes,
  m.return_type,
  m.series_id,
  m.prefix_id,
  m.code_id,
  m.suffix_id,
  m.cell_field,
  m.confidence,
  m.discovered_at
FROM form_1040_lines l
LEFT JOIN form_1040_proconnect_map m
  ON m.tax_year = l.tax_year
 AND m.line_code = l.line_code;
