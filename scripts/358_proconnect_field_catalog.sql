-- 358: proconnect_field_catalog — Layer B, the field dictionary.
--
-- Intuit (Steven Wheelis) provided the IVCS/FRF field mapping for IND
-- tax year 2025 on 2026-07-26. This is the catalog whose absence was the
-- hard gate on every automation ambition: we could write to any field
-- code we *knew*, but had no dictionary saying what a code MEANS.
--
-- ─── DATA IS NOT IN THIS FILE, BY DESIGN ────────────────────────────
-- The catalog is partner-confidential under the Open API partner
-- agreement, and Motta-Financial/v0-motta-hub is a PUBLIC repository.
-- This migration creates schema only. Rows are loaded out-of-band by
-- scripts/358-load-proconnect-catalog.mjs, which reads the CSV from a
-- path given at runtime. The source extract is gitignored.
--
-- ─── SHAPE OF THE SOURCE ────────────────────────────────────────────
-- 67,810 rows. Columns: agency, series, code, description, screenTitle,
-- type, charLimit, tsj, constraints. Verified properties:
--   * unique on (agency, series, code) — zero duplicates
--   * 48 agencies (Federal 44,334 rows + 47 states/DC)
--   * 748 series (s1..s29909), 2,897 codes (c0..c1500300001), 821 screens
--   * type ∈ {NUMBER 51671, STRING 10229, '' 2503, DATE 2444, SSN 963}
--   * 1,677 of 2,897 codes carry DIFFERENT meanings under different
--     series — `code` alone is meaningless. Hence (agency, series, code)
--     is the natural key and no lookup may omit series.
--   * the catalog has NO prefix/suffix: those are runtime instance
--     discriminators (p0 / x1000 defaults), not catalog entries.
--
-- ─── WHY `rules` MATTERS ────────────────────────────────────────────
-- `constraints` is a semicolon-delimited mini-language. Exhaustively
-- enumerated across all 67,810 rows: 612 distinct strings, exactly 13
-- tokens, zero unparsed remainder. Parsing it lets the Hub reject a bad
-- Import entry LOCALLY instead of discovering it from Intuit — which
-- matters enormously because there is no ProConnect sandbox and every
-- call touches a real client return.
--
-- The 13 tokens and the sub-field they govern:
--   formattedNumber            val is a formatted number
--   min=N / max=N              numeric bounds on val (note sci-notation
--                              forms: 9.99999999E8, -9.99999999E8)
--   minOr=[0, -1]              val must match one of the alternatives
--                              (the -1 sentinel is a ProConnect override)
--   date                       val is a date
--   maxLength=N                val/text length cap
--   desc:maxLength=N           `desc` sub-field permitted, with cap
--   src:STRING / src:ENUM      `src` sub-field permitted (free / enum)
--   source:maxLength=N         `source` sub-field permitted, with cap
--   tsj:maxLength=N            `tsj` sub-field permitted (agrees with the
--                              tsj column on 100% of rows — verified)
--   cityAbbrev:STRING          `cityAbbrev` sub-field permitted
--   amt:NUMBER                 `amt` sub-field permitted (2 rows only)
--
-- A sub-field is permitted IFF its token is present. That derivation is
-- what pre-empts the Import API's SUB_FIELD_NOT_ALLOWED (Layer-3) error.
--
-- NOTE ON TRUST: Intuit's guidance is that the ProConnect product is the
-- authority if the file and the product disagree — Return Actions >
-- Customer Support Tools reveals the mapping of entered data on a real
-- return. Treat this table as authoritative-but-verifiable, and confirm
-- against a real export before writing to any code for the first time.

CREATE TABLE IF NOT EXISTS public.proconnect_field_catalog (
  tax_year        int     NOT NULL,
  -- IND/COR/SCO/PAR/FID/EXM/GFT. Only IND is populated today; the column
  -- exists so a second year or module loads without a migration.
  return_type     text    NOT NULL,
  agency          text    NOT NULL,          -- 'Federal' or state/DC abbrev
  series_id       text    NOT NULL,          -- ^s\d+$
  code_id         text    NOT NULL,          -- ^c\d{1,10}$

  description     text    NOT NULL,          -- Intuit's own field label
  screen_title    text,                      -- the PTO input screen
  value_type      text,                      -- NUMBER | STRING | DATE | SSN | NULL
  char_limit      int,
  tsj_allowed     boolean NOT NULL DEFAULT false,

  constraints_raw text,                      -- verbatim, for re-parsing
  rules           jsonb   NOT NULL DEFAULT '{}'::jsonb,  -- parsed; see above

  -- True when the field holds a taxpayer identifier or other sensitive
  -- value (value_type='SSN', or an EIN/TIN/account-number description).
  -- Drives masking wherever field values surface.
  is_sensitive    boolean NOT NULL DEFAULT false,

  source_file     text,                      -- provenance of the extract
  loaded_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tax_year, return_type, agency, series_id, code_id)
);

COMMENT ON TABLE public.proconnect_field_catalog IS
  'Intuit IVCS/FRF field dictionary (Layer B). Partner-confidential — '
  'never commit the source extract; this repo is public. Keyed on '
  '(agency, series, code) because 1,677 codes mean different things '
  'under different series.';

-- Import pre-validation resolves an entire series at once, so this is
-- the hot path: "give me every code defined under s11 for Federal".
CREATE INDEX IF NOT EXISTS proconnect_field_catalog_series_idx
  ON public.proconnect_field_catalog (tax_year, return_type, agency, series_id);

-- "Which code is wages?" — full-text search over Intuit's labels, used by
-- the catalog lookup API and by ALFRED.
CREATE INDEX IF NOT EXISTS proconnect_field_catalog_description_fts
  ON public.proconnect_field_catalog
  USING gin (to_tsvector('english', description || ' ' || coalesce(screen_title, '')));

-- Screen-oriented browsing (the PTO UI groups by input screen).
CREATE INDEX IF NOT EXISTS proconnect_field_catalog_screen_idx
  ON public.proconnect_field_catalog (tax_year, return_type, screen_title);

-- Enumerating sensitive fields must stay cheap — it gates masking.
CREATE INDEX IF NOT EXISTS proconnect_field_catalog_sensitive_idx
  ON public.proconnect_field_catalog (tax_year, return_type)
  WHERE is_sensitive;

ALTER TABLE public.proconnect_field_catalog ENABLE ROW LEVEL SECURITY;

-- Mirrors the sibling proconnect_* policies, with auth.role() wrapped in
-- a scalar subquery so Postgres evaluates it once per statement rather
-- than once per row (see scripts/355 — this table is scanned in bulk).
DROP POLICY IF EXISTS proconnect_field_catalog_read ON public.proconnect_field_catalog;
CREATE POLICY proconnect_field_catalog_read
  ON public.proconnect_field_catalog FOR SELECT
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated', 'service_role']));

DROP POLICY IF EXISTS proconnect_field_catalog_write ON public.proconnect_field_catalog;
CREATE POLICY proconnect_field_catalog_write
  ON public.proconnect_field_catalog FOR ALL
  USING ((SELECT auth.role()) = 'service_role');
