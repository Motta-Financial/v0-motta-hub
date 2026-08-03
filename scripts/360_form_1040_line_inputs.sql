-- 360: form_1040_line_inputs — how each 1040 line is DERIVED, and which
-- ProConnect input fields feed it.
--
-- ─── WHY THIS EXISTS ────────────────────────────────────────────────
-- form_1040_proconnect_map answers "which cell holds line 1a's value".
-- That works only for lines that ARE input fields. But most of the 1040
-- face is not: of 72 seeded lines, 15 are pure arithmetic over other
-- lines and ~20 more are rollups ProConnect computes from a schedule,
-- worksheet, or tax table. You never type "adjusted gross income" — you
-- type W-2s and 1099s and ProConnect derives it.
--
-- So a second relation is needed: line -> the SOURCE that produces it,
-- and the ProConnect series/codes that feed that source. This is what
-- Layer C (document -> fields) requires. To file a return from source
-- documents you must know that a W-2 box 1 goes to s11/c3, not that
-- "line 11 is AGI".
--
-- ─── DATA IS NOT IN THIS FILE ───────────────────────────────────────
-- The rows reference Intuit's IVCS/FRF catalog (series, code, and their
-- meanings), which is partner-confidential under the Open API partner
-- agreement — and Motta-Financial/v0-motta-hub is a PUBLIC repository.
-- Schema only here. Rows were applied out-of-band, same discipline as
-- scripts/358. See the private research memo for the full mapping.
--
-- ─── SOURCE-KIND TAXONOMY ───────────────────────────────────────────
--   line_arithmetic  Pure sum/diff over other 1040 lines. Already
--                    encoded in form_1040_lines.computation and
--                    evaluated by lib/forms/form-1040.ts. 15 lines.
--   schedule         Rolls up from an attached schedule (Sch 1/2/3/A/D,
--                    8812, EIC). Inputs live on that schedule's series.
--   worksheet        Derived by an IRS worksheet from other amounts
--                    (taxable social security, taxable IRA/pension).
--   table_lookup     Tax tables / capital-gain worksheet (line 16).
--   statutory        A statutory amount driven by filing status, age and
--                    blindness rather than any entered figure — the
--                    standard deduction, including OBBBA's §63(f)
--                    additional senior amount.
--
-- ─── ROLE TAXONOMY ─────────────────────────────────────────────────
--   input          Normal data entry (W-2 box 1, SSA-1099 box 5).
--   override       An [Override] field that displaces the computation.
--                  Present on most computed amounts; the reason a
--                  computed line can still carry an entered value.
--   discriminator  Routes an input to one line vs another. The important
--                  one: s14/c2 "(7) IRA/SEP/SIMPLE" decides whether a
--                  1099-R lands on line 4 (IRA) or line 5 (pension) —
--                  the SAME gross/taxable codes serve both.
--   control        Changes which branch computes (force itemized vs
--                  standard; suppress ACTC).
--
-- NOTE ON TRUST: every row is derived from Intuit's own field
-- descriptions, but assigning a code to an IRS line number is still an
-- interpretive step. `confidence` records that, and nothing here has been
-- verified against a real Export — Export is still 403-blocked. Verify
-- before any of this drives a write. Intuit's guidance stands: the
-- product is the authority, via Return Actions > Customer Support Tools.

CREATE TABLE IF NOT EXISTS public.form_1040_line_inputs (
  id            bigserial PRIMARY KEY,
  tax_year      int  NOT NULL,
  return_type   text NOT NULL DEFAULT 'IND',
  line_code     text NOT NULL,          -- FK-ish to form_1040_lines.line_code

  source_kind   text NOT NULL,          -- see taxonomy above
  source_ref    text,                   -- 'Schedule 1, line 10', 'Form 8995', ...

  -- The ProConnect address of a contributing field. NULL series/code is
  -- legitimate: line 16 is a tax-table lookup with no input field at all.
  agency        text,                   -- 'Federal' or state abbrev
  series_id     text,
  code_id       text,
  role          text,                   -- input | override | discriminator | control

  confidence    text NOT NULL DEFAULT 'medium',  -- high | medium | low
  verified_at   timestamptz,            -- set once confirmed against a real Export
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.form_1040_line_inputs IS
  'Derivation map: 1040 line -> computation source -> contributing '
  'ProConnect input fields. Complements form_1040_proconnect_map, which '
  'only covers lines that are themselves input fields. References '
  'partner-confidential catalog addresses — do not commit row data.';

CREATE INDEX IF NOT EXISTS form_1040_line_inputs_line_idx
  ON public.form_1040_line_inputs (tax_year, return_type, line_code);

CREATE INDEX IF NOT EXISTS form_1040_line_inputs_series_idx
  ON public.form_1040_line_inputs (tax_year, agency, series_id, code_id);

-- One row per (line, field, role); a NULL code_id means "this line has a
-- source but no single contributing field" (table lookups), and several
-- such rows per line are legitimate, so the uniqueness key includes role.
CREATE UNIQUE INDEX IF NOT EXISTS form_1040_line_inputs_uniq
  ON public.form_1040_line_inputs
     (tax_year, return_type, line_code, coalesce(series_id,''), coalesce(code_id,''), coalesce(role,''));

ALTER TABLE public.form_1040_line_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_1040_line_inputs_read ON public.form_1040_line_inputs;
CREATE POLICY form_1040_line_inputs_read
  ON public.form_1040_line_inputs FOR SELECT
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated', 'service_role']));

DROP POLICY IF EXISTS form_1040_line_inputs_write ON public.form_1040_line_inputs;
CREATE POLICY form_1040_line_inputs_write
  ON public.form_1040_line_inputs FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- Reminder: scripts/359 revoked anon SELECT on every existing view, but
-- ALTER DEFAULT PRIVILEGES was deliberately not applied. This is a TABLE
-- with explicit RLS, so it is fail-closed regardless — but if a view is
-- ever built over it, re-run the anon audit query in 359.
