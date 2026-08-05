-- ============================================================================
-- Form 1040 TY2025: round-4 verified inputs, 35c decode, rollup constants
-- ============================================================================
-- Sentinel round 4 (2026-08-04) labeled the Schedule 1 / Schedule 3 INPUT
-- fields. These are not 1040 lines, so they land in form_1040_line_inputs
-- (see scripts/360) rather than form_1040_proconnect_map. Addresses below
-- were observed in our own Export diff — sentinel-verified, not copied
-- from Intuit's catalog — same provenance as scripts/368-375.
--
-- Also here:
--   * 35c account-type enum CONFIRMED IN BOTH DIRECTIONS: the cell read 2
--     when the return said Checking and 1 after flipping to Savings. The
--     `value_decode` plumbing itself landed separately on main.
--   * Caps/phaseouts for the line-8 and line-10 rollup estimators.
--
-- WHY THE ROLLUP ESTIMATORS MATTER: line 8 (Schedule 1 other income) and
-- line 10 (Schedule 1 adjustments) are TOTALS over many input fields. Line
-- 8 was mapped to a single "Other income" cell, so returns with
-- unemployment, alimony received, or gambling winnings rendered too low.
-- Both lines are now summed from every component we have verified.

-- ── 1. 35c enum: confirm the decode in BOTH directions ──────────────────
-- The value_decode column and its renderer/API plumbing landed separately
-- on main; this only records the empirical confirmation. Idempotent.
ALTER TABLE form_1040_proconnect_map
  ADD COLUMN IF NOT EXISTS value_decode jsonb;

UPDATE form_1040_proconnect_map
   SET value_decode = '{"1":"savings","2":"checking"}'::jsonb,
       confidence   = 'confirmed',
       notes        = 'Refund account type. Enum CONFIRMED both directions 2026-08-04: cell = 2 with Checking selected, 1 after flipping the return to Savings.'
 WHERE tax_year = 2025 AND return_type = 'IND' AND line_code = '35c';

-- ── 2. Rollup caps / phaseouts (statutory + Rev. Proc. 2024-40) ─────────
INSERT INTO form_1040_constants (tax_year, key, value, notes) VALUES
  (2025, 'educator_expense_cap',            '300',   'Educator expenses deduction cap per educator (§62(a)(2)(D))'),
  (2025, 'educator_expense_cap_mfj',        '600',   'Educator cap when both spouses are eligible educators (MFJ)'),
  (2025, 'student_loan_interest_max',       '2500',  'Student loan interest deduction cap (§221)'),
  (2025, 'student_loan_phaseout_single',    '[85000, 100000]',   'Student loan interest MAGI phaseout range: Single/HOH/QSS'),
  (2025, 'student_loan_phaseout_mfj',       '[170000, 200000]',  'Student loan interest MAGI phaseout range: MFJ'),
  (2025, 'hsa_contribution_cap',            '8550',  'HSA family-coverage contribution cap for TY2025 — used only as an absurdity ceiling on the entered amount, not as an eligibility test')
ON CONFLICT (tax_year, key) DO UPDATE SET value = EXCLUDED.value, notes = EXCLUDED.notes;

-- ── 3. Round-4 verified input fields ───────────────────────────────────
-- role 'input' = normal data entry. verified_at set because each address
-- was proven by observing a unique sentinel value land in that exact cell.
INSERT INTO form_1040_line_inputs
  (tax_year, return_type, line_code, source_kind, source_ref, agency, series_id, code_id, role, confidence, verified_at, notes)
VALUES
  -- Line 8 components (Schedule 1 income)
  (2025, 'IND', '8',  'schedule', 'Schedule 1, line 7',  'Federal', 's15',   'c2',  'input', 'high', now(), 'Unemployment compensation received (1099-G screen). Sentinel-verified.'),
  (2025, 'IND', '8',  'schedule', 'Schedule 1, line 2a', 'Federal', 's200M', 'c5',  'input', 'high', now(), 'Alimony received. NOTE suffix x1, not the usual x1000. Sentinel-verified.'),
  (2025, 'IND', '8',  'schedule', 'Schedule 1, line 8b', 'Federal', 's19',   'c3',  'input', 'high', now(), 'Gambling winnings (W-2G box 1). Sentinel-verified round 2.'),
  -- Line 10 components (Schedule 1 adjustments)
  (2025, 'IND', '10', 'schedule', 'Schedule 1, line 11', 'Federal', 's300',  'c28', 'input', 'high', now(), 'Educator expenses. Capped by statute. Sentinel-verified.'),
  (2025, 'IND', '10', 'schedule', 'Schedule 1, line 21', 'Federal', 's300',  'c23', 'input', 'high', now(), 'Total qualified student loan interest paid. Capped + MAGI phaseout. Sentinel-verified.'),
  (2025, 'IND', '10', 'schedule', 'Schedule 1, line 13', 'Federal', 's2800', 'c5',  'input', 'high', now(), 'HSA contributions you made. CAUTION: value 1 means "compute the maximum", not $1. Sentinel-verified.'),
  (2025, 'IND', '10', 'schedule', 'Schedule 1, line 18', 'Federal', 's12',   'c18', 'input', 'high', now(), 'Early withdrawal penalty (per interest payer; aggregate across instances). Sentinel-verified.'),
  -- Line 20 / 29 components (Schedule 3 credits) — cells verified, credit
  -- worksheets NOT yet implemented.
  (2025, 'IND', '20', 'schedule', 'Form 2441',           'Federal', 's31',   'c20', 'input', 'high', now(), 'Qualified dependent care expenses incurred and paid in the year. Sentinel-verified.'),
  (2025, 'IND', '20', 'schedule', 'Form 8863',           'Federal', 's36',   'c16', 'input', 'high', now(), 'Qualified tuition and fees, net of nontaxable benefits. Feeds AOTC/LLC; election is preparer-driven so the credit is not estimated. Sentinel-verified.')
ON CONFLICT (tax_year, return_type, line_code, coalesce(series_id,''), coalesce(code_id,''), coalesce(role,''))
DO UPDATE SET
  source_kind = EXCLUDED.source_kind,
  source_ref  = EXCLUDED.source_ref,
  confidence  = EXCLUDED.confidence,
  verified_at = EXCLUDED.verified_at,
  notes       = EXCLUDED.notes;

-- Alimony PAID (s300/c18) is deliberately absent: the field is an
-- expandable detail table, round 4 could not enter it, and nothing about
-- it has been observed. Do not add it on catalog evidence alone.
