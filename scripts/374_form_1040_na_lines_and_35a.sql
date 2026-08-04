-- ============================================================================
-- Form 1040 TY2025: N/A lines + computable 35a (2026-08-04)
-- ============================================================================
-- 1. `not_applicable` marks lines that can NEVER hold a value, so coverage
--    denominators stop counting them:
--      * line 30 — "Reserved for future use" on the IRS form itself
--      * line 12b — the charitable-if-standard deduction does not exist
--        for TY2025 (2021-only provision; OBBBA's non-itemizer charity
--        deduction starts TY2026)
-- 2. Line 35a (refund amount requested) is deterministic on every return
--    we render: overpayment minus the portion applied to next year —
--    subtract_floor_zero(34, 36). Flip it to a computed line.
--
-- Also documents catalog findings (2026-08-04): lines 1h and 1i have only
-- [Adjust] cells in the Intuit field dictionary (corrections to computed
-- carries, not value inputs) — both are ruled out for direct mapping.

ALTER TABLE form_1040_lines
  ADD COLUMN IF NOT EXISTS not_applicable boolean NOT NULL DEFAULT false;

UPDATE form_1040_lines
   SET not_applicable = true
 WHERE tax_year = 2025 AND line_code IN ('30', '12b');

UPDATE form_1040_lines
   SET is_computed = true,
       computation = '{"kind":"subtract_floor_zero","operands":["34","36"]}'::jsonb,
       notes = 'Computed: overpayment (34) minus amount applied to next year (36). The taxpayer can request less, but on rendered returns this identity holds.'
 WHERE tax_year = 2025 AND line_code = '35a';

UPDATE form_1040_proconnect_map
   SET notes = 'Ruled out 2026-08-04: the Intuit catalog has only [Adjust] cells for this line (corrections, not value inputs). Value is form-computed by PTO.'
 WHERE tax_year = 2025 AND return_type = 'IND'
   AND line_code IN ('1g', '1h', '1i');
