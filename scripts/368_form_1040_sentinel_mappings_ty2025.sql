-- ============================================================================
-- Form 1040 TY2025 ProConnect mappings — sentinel-confirmed (2026-07-30)
-- ============================================================================
-- Discovered via the Intuit-sanctioned sentinel workflow (scripts/364):
-- unique values entered on a scratch COPY return ("SENTINEL TEST — DO NOT
-- FILE", engagement de74b2b2-ab40-4867-8a2a-d52f1518c58d, a copy of a real
-- return with the state removed), re-exported through the API, and matched
-- by value. Applied to the live table by scripts/364 --apply + follow-up
-- updates; this migration makes the state reproducible.
--
-- prefix_id '*' = aggregate across repeating-screen instances (see
-- scripts/367 / lib/forms/form-1040.ts AGGREGATE_PREFIX): totals-type lines
-- sum across W-2s (s11) or payers (s12 interest, s13 dividends).
--
-- 1099-R lines (4a/4b/5a/5b) are EXACT tuples on purpose: '*' would blend
-- IRA + pension gross into both 4a and 5a. Correct on returns where the
-- first 1099-R is the IRA one; proper routing needs the per-instance
-- IRA/SEP/SIMPLE checkbox cell (future mechanism).
-- ============================================================================

INSERT INTO form_1040_proconnect_map
  (tax_year, return_type, line_code, series_id, prefix_id, code_id, suffix_id, cell_field, confidence, notes)
VALUES
  -- Wages / W-2 screen (s11; repeating per employer)
  (2025, 'IND', '1a',  's11',   '*',  'c3',   'x1000', 'val', 'confirmed', 'W-2 box 1 wages; sum across W-2s. FICA-ratio + sentinel confirmed.'),
  (2025, 'IND', '25a', 's11',   '*',  'c4',   'x1000', 'val', 'confirmed', 'W-2 box 2 federal withholding; sum across W-2s.'),
  (2025, 'IND', '1c',  's11',   '*',  'c79',  'x1000', 'val', 'confirmed', 'Form 4137 unreported tips ($20+/month field); sum across W-2s.'),
  -- Interest (s12; repeating per payer)
  (2025, 'IND', '2a',  's12',   '*',  'c10',  'x1000', 'val', 'confirmed', 'Tax-exempt interest; sum across payers.'),
  (2025, 'IND', '2b',  's12',   '*',  'c2',   'x1000', 'val', 'confirmed', 'Taxable interest (Banks, S&L column); sum across payers.'),
  (2025, 'IND', '25b', 's12',   '*',  'c14',  'x1000', 'val', 'confirmed', '1099-INT federal withholding; sum across payers. NOTE: 25b on the 1040 also includes 1099-R/MISC withholding — those cells not yet labeled.'),
  -- Dividends (s13; repeating per payer)
  (2025, 'IND', '3a',  's13',   '*',  'c30',  'x1000', 'val', 'confirmed', 'Qualified dividends; sum across payers.'),
  (2025, 'IND', '3b',  's13',   '*',  'c2',   'x1000', 'val', 'confirmed', 'Ordinary dividends; sum across payers.'),
  (2025, 'IND', '7',   's13',   '*',  'c3',   'x1000', 'val', 'confirmed', 'Capital gain distributions; sum across payers. Line 7 equals this only when Sch D not required.'),
  -- 1099-R (s14; repeating per payer — EXACT tuples, see header)
  (2025, 'IND', '4a',  's14',   'p1', 'c3',   'x1000', 'val', 'confirmed', '1099-R gross, IRA/SEP/SIMPLE instance (p1 on sentinel return).'),
  (2025, 'IND', '4b',  's14',   'p1', 'c4',   'x1000', 'val', 'confirmed', '1099-R taxable, IRA/SEP/SIMPLE instance.'),
  (2025, 'IND', '5a',  's14',   'p2', 'c3',   'x1000', 'val', 'confirmed', '1099-R gross, non-IRA (pension) instance (p2 on sentinel return).'),
  (2025, 'IND', '5b',  's14',   'p2', 'c4',   'x1000', 'val', 'confirmed', '1099-R taxable, non-IRA (pension) instance.'),
  -- SS Benefits / Misc income screen (s200M; non-repeating)
  (2025, 'IND', '6a',  's200M', 'p0', 'c2',   'x1000', 'val', 'confirmed', 'SSA-1099 box 5 benefits.'),
  (2025, 'IND', '1b',  's200M', 'p0', 'c9',   'x1000', 'val', 'confirmed', 'Household employee income not on W-2.'),
  (2025, 'IND', '8',   's200M', 'p0', 'c11',  'x1000', 'val', 'confirmed', 'Other income (Sch 1 line 8z).'),
  -- Estimated payments (s5400; non-repeating)
  (2025, 'IND', '26',  's5400', 'p0', 'c2',   'x1000', 'val', 'confirmed', '2025 estimated tax, Q1 amount paid. Q2-Q4 cells not yet labeled — line 26 currently reflects Q1 input only.')
ON CONFLICT (tax_year, return_type, line_code) DO UPDATE SET
  series_id  = EXCLUDED.series_id,
  prefix_id  = EXCLUDED.prefix_id,
  code_id    = EXCLUDED.code_id,
  suffix_id  = EXCLUDED.suffix_id,
  cell_field = EXCLUDED.cell_field,
  confidence = EXCLUDED.confidence,
  notes      = EXCLUDED.notes;

-- Clear the remaining scripts/363 fabrications: PTO-computed lines that can
-- never map to an input cell (no calculated values in the export).
UPDATE form_1040_proconnect_map
   SET series_id = NULL, prefix_id = NULL, code_id = NULL, suffix_id = NULL,
       confidence = 'unknown',
       notes = 'Cleared 2026-07-30: scripts/363 short-code guess was fabricated. Line is PTO-computed on real returns — cannot map to an input cell.'
 WHERE tax_year = 2025 AND return_type = 'IND'
   AND line_code IN ('12a', '27', '38', '6b');

-- Not yet labeled (future sentinel rounds): 1d-1i, 10 (Sch 1 24z), 25c,
-- 36 (apply-to-next-year cell did not appear in export), W-2G withholding,
-- estimates Q2-Q4, and per-instance IRA-checkbox routing for 4a/5a.
