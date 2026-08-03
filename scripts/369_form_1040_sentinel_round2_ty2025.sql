-- ============================================================================
-- Form 1040 TY2025 ProConnect mappings — sentinel round 2 (2026-07-30)
-- ============================================================================
-- Same method and scratch return as scripts/368 (sentinel copy de74b2b2).
-- Applied live by scripts/364 --apply; this migration makes it reproducible.
--
-- Also learned this round (documented, NOT mapped):
--   * s5400 estimated-payment "amount paid" codes: c2=Q1, c4=Q2, c6=Q3,
--     c8=Q4. Line 26 stays mapped to Q1 only — the map schema holds ONE
--     cell per line and the '*' mechanism aggregates prefixes, not codes.
--     Summing c2+c4+c6+c8 (+ prior-year overpayment applied) needs a
--     multi-cell mechanism first.
--   * s19 = W-2G screen (repeating): c3 = box 1 winnings, c6 = box 4
--     federal withholding.
--   * s7200 = apply-overpayment-to-next-year screen: c13 = option code
--     (1 = apply to Q1), c118 = dollar amount. NOTE: s7200 cells flush to
--     the export LATE — they appeared only on a later save cycle.
--   * Line 10 (adjustments total) is NOT single-cell mappable: PTO's
--     "Other Adjustments" screen has only specific named sub-line fields,
--     and on real returns line 10 is dominated by PTO-computed components
--     (SE tax deduction, IRA deduction, student loan interest).
-- ============================================================================

INSERT INTO form_1040_proconnect_map
  (tax_year, return_type, line_code, series_id, prefix_id, code_id, suffix_id, cell_field, confidence, notes)
VALUES
  (2025, 'IND', '25c', 's19',   '*',  'c6',   'x1000', 'val', 'confirmed', 'W-2G box 4 federal withholding; sum across W-2Gs. NOTE: 1040 25c also includes Form 8959 withholding — PTO-computed, not in export.'),
  (2025, 'IND', '36',  's7200', 'p0', 'c118', 'x1000', 'val', 'confirmed', 'Amount of overpayment applied to next year''s estimates. Series flushes late to the export.')
ON CONFLICT (tax_year, return_type, line_code) DO UPDATE SET
  series_id  = EXCLUDED.series_id,
  prefix_id  = EXCLUDED.prefix_id,
  code_id    = EXCLUDED.code_id,
  suffix_id  = EXCLUDED.suffix_id,
  cell_field = EXCLUDED.cell_field,
  confidence = EXCLUDED.confidence,
  notes      = EXCLUDED.notes;

-- Line 10: mark as deliberately unmappable so nobody re-attempts it.
UPDATE form_1040_proconnect_map
   SET notes = 'Not single-cell mappable (2026-07-30): line 10 is a total of mostly PTO-computed adjustments; the Other Adjustments screen holds only named sub-line fields.'
 WHERE tax_year = 2025 AND return_type = 'IND' AND line_code = '10'
   AND series_id IS NULL;
