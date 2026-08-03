-- 361: Tax intake — gather 1040 source documents IN the Hub, then import
-- them into ProConnect.
--
-- ─── THE ARCHITECTURAL DECISION THIS ENCODES ────────────────────────
-- The Hub gathers at the SOURCE-DOCUMENT level, not the 1040-line level.
-- That is forced by the Import API, not a preference:
--
--   * Import writes only to series/prefix/code/suffix addresses, and
--     those correspond to ProConnect's INPUT SCREENS — s11 is the W-2
--     screen, s12 1099-INT, s14 1099-R, s400 Schedule A, s51 Schedule C.
--   * There is NO address for "line 11 AGI" or "line 16 tax". Line 16 has
--     no input code at all, and the standard deduction is derived from
--     date of birth (see scripts/360 and form_1040_line_inputs).
--
-- So gathering 1040 lines would produce data that mostly cannot be
-- imported. Gathering documents — "this W-2 has box 1 = X" — gives every
-- value a real address, and the 1040 face becomes a COMPUTED PREVIEW for
-- preparer review rather than something anyone types.
--
-- ─── PREFIX = INSTANCE ──────────────────────────────────────────────
-- Multiple documents of one type are distinguished by PREFIX, not by
-- different codes: three W-2s are p0/p1/p2 against the same s11 codes.
-- tax_input_documents.instance_index carries that, and the serializer
-- maps index N -> "p{N}".
--
-- ⚠️ ASSUMPTION TO VERIFY ON THE FIRST SUCCESSFUL EXPORT: that p0..pN is
-- how ProConnect enumerates repeated documents. The catalog contains no
-- prefix information at all (it is keyed on agency/series/code only), so
-- this is inferred from the Phase 1 field model, not confirmed. Nothing
-- should be committed with dryRun:false until an Export shows real
-- prefixes on a return that has two W-2s.
--
-- ─── SCOPE: firm-staff intake ───────────────────────────────────────
-- Preparers key documents in; there is no client-facing surface. The
-- review columns (submitted_by, reviewed_at, reviewed_by) exist so a
-- client portal can be layered on later without migrating data.
--
-- Row data for tax_input_field_defs is loaded out-of-band: it embeds
-- Intuit catalog addresses, which are partner-confidential, and this
-- repository is PUBLIC. Same discipline as scripts/358 and 360.

-- ── 1. A gathering, one per (client, tax year) ───────────────────────
CREATE TABLE IF NOT EXISTS public.tax_input_sets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year      int  NOT NULL,
  return_type   text NOT NULL DEFAULT 'IND',

  -- Hub-side client identity. Nullable because a set may be started from
  -- a prospect before the Hub contact exists.
  contact_id       uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- ProConnect targets, filled once known. proconnect_client_id is the
  -- NUMERIC id_client used on Export/Import paths — not oiiClientId.
  proconnect_client_id text,
  proconnect_return_id text,

  -- gathering -> ready -> importing -> imported | failed
  status        text NOT NULL DEFAULT 'gathering',

  filing_status text,          -- single | mfj | mfs | hoh | qss

  notes         text,
  created_by    uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One active gathering per client-year. Partial so historical/archived
-- sets can coexist if a status like 'superseded' is added later.
CREATE UNIQUE INDEX IF NOT EXISTS tax_input_sets_client_year_uniq
  ON public.tax_input_sets (contact_id, tax_year, return_type)
  WHERE contact_id IS NOT NULL AND status <> 'superseded';

CREATE INDEX IF NOT EXISTS tax_input_sets_year_idx
  ON public.tax_input_sets (tax_year, status);

-- ── 2. Document-type definitions + their ProConnect mapping ──────────
-- This is the bridge: one row per (doc_type, field_key) carrying the
-- catalog address that field imports to. Reference data, not per-client.
CREATE TABLE IF NOT EXISTS public.tax_input_field_defs (
  id          bigserial PRIMARY KEY,
  tax_year    int  NOT NULL,
  return_type text NOT NULL DEFAULT 'IND',
  doc_type    text NOT NULL,          -- 'w2', '1099int', '1099r', ...
  field_key   text NOT NULL,          -- 'box1_wages', 'employer_ein'

  label       text NOT NULL,          -- what the preparer sees
  data_type   text NOT NULL,          -- currency | text | ssn | ein | state | checkbox | integer
  required    boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0,
  help_text   text,

  -- ── ProConnect target ──
  agency      text NOT NULL DEFAULT 'Federal',
  series_id   text NOT NULL,
  code_id     text NOT NULL,
  suffix_id   text NOT NULL DEFAULT 'x1000',
  -- Which leaf property of the cell receives the value.
  cell_field  text NOT NULL DEFAULT 'val',
  -- T/S/J/N when the code honours it; NULL when it does not.
  tsj         text,

  -- How much we trust field_key -> (series, code). 'high' means Intuit's
  -- own description names the W-2 box unambiguously.
  confidence  text NOT NULL DEFAULT 'medium',
  verified_at timestamptz,            -- set once confirmed against an Export
  notes       text,

  UNIQUE (tax_year, return_type, doc_type, field_key)
);

CREATE INDEX IF NOT EXISTS tax_input_field_defs_doc_idx
  ON public.tax_input_field_defs (tax_year, return_type, doc_type, sort_order);

-- ── 3. A gathered document instance ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_input_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input_set_id  uuid NOT NULL REFERENCES public.tax_input_sets(id) ON DELETE CASCADE,
  doc_type      text NOT NULL,

  -- 0-based. Becomes prefix p{instance_index} on import.
  instance_index int NOT NULL DEFAULT 0,

  -- Preparer-facing label ("Acme Corp W-2").
  label         text,
  -- 'T' taxpayer / 'S' spouse. Drives s11/c1 (Spouse W-2) for wages.
  taxpayer_spouse text NOT NULL DEFAULT 'T',

  -- Provenance: keyed by hand, or extracted from an uploaded document.
  source        text NOT NULL DEFAULT 'manual',   -- manual | ocr | import
  source_ref    text,

  submitted_by  uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  reviewed_by   uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (input_set_id, doc_type, instance_index)
);

CREATE INDEX IF NOT EXISTS tax_input_documents_set_idx
  ON public.tax_input_documents (input_set_id, doc_type, instance_index);

-- ── 4. The entered values ───────────────────────────────────────────
-- Normalized rather than a jsonb blob so each value joins to its field
-- def (and therefore to a catalog address) for validation and import.
--
-- ⚠️ PII: value_text/value_num hold real taxpayer figures, and an SSN or
-- EIN whenever the field def says so. RLS is service-role-only below;
-- do not build a view over this table without re-running the anon audit
-- in scripts/359.
CREATE TABLE IF NOT EXISTS public.tax_input_values (
  id          bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES public.tax_input_documents(id) ON DELETE CASCADE,
  field_key   text NOT NULL,

  value_text  text,
  value_num   numeric,

  updated_by  uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (document_id, field_key)
);

CREATE INDEX IF NOT EXISTS tax_input_values_doc_idx
  ON public.tax_input_values (document_id);

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.tax_input_sets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_input_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_input_values     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_input_field_defs ENABLE ROW LEVEL SECURITY;

-- Field DEFINITIONS are reference data every signed-in preparer needs to
-- render a form: authenticated read.
DROP POLICY IF EXISTS tax_input_field_defs_read ON public.tax_input_field_defs;
CREATE POLICY tax_input_field_defs_read
  ON public.tax_input_field_defs FOR SELECT
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated', 'service_role']));
DROP POLICY IF EXISTS tax_input_field_defs_write ON public.tax_input_field_defs;
CREATE POLICY tax_input_field_defs_write
  ON public.tax_input_field_defs FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- Actual taxpayer DATA is service-role only. Every read goes through an
-- API route that has already authenticated the preparer, so there is no
-- reason to expose these tables to the authenticated role directly —
-- and doing so would put real SSNs one PostgREST query away from any
-- signed-in session. Deliberately stricter than the proconnect_* tables.
DROP POLICY IF EXISTS tax_input_sets_service ON public.tax_input_sets;
CREATE POLICY tax_input_sets_service ON public.tax_input_sets FOR ALL
  USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS tax_input_documents_service ON public.tax_input_documents;
CREATE POLICY tax_input_documents_service ON public.tax_input_documents FOR ALL
  USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS tax_input_values_service ON public.tax_input_values;
CREATE POLICY tax_input_values_service ON public.tax_input_values FOR ALL
  USING ((SELECT auth.role()) = 'service_role');
