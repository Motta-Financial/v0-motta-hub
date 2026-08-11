-- ============================================================================
-- Form 1040 TY2025: Schedule 1-A / line 13b + enhanced senior deduction
-- ============================================================================
-- Audit finding (2026-08-11): the TY2025 line schema seeded by scripts/141 is
-- the PRE-2025 Form 1040 layout. The real 2025 form (Cat. No. 11320B, created
-- 9/5/25) restructured page 2:
--
--     11a  adjusted gross income          (was: 11)
--     11b  amount from line 11a
--     12a  someone can claim you/spouse as a dependent   [checkbox]
--     12b  spouse itemizes on a separate return          [checkbox]
--     12c  you were a dual-status alien                  [checkbox]
--     12d  you/spouse born before January 2, 1961; blind [checkboxes]
--     12e  standard deduction or itemized deductions
--     13a  qualified business income deduction
--     13b  additional deductions from Schedule 1-A, line 38   <-- NEW
--     14   add lines 12e, 13a, and 13b
--     15   subtract line 14 from line 11b
--
-- Schedule 1-A (Form 1040) is new for 2025 and carries the four OBBBA
-- below-the-line deductions: qualified tips (Part II), qualified overtime
-- (Part III), qualified passenger vehicle loan interest (Part IV), and the
-- enhanced deduction for seniors (Part V). Part VI line 38 totals them and
-- lands on Form 1040 line 13b.
--
-- WHY THIS IS A MATH BUG, NOT A LABELLING ONE
-- The Hub had no line 13b at all, and line 14 summed only (12c, 13). So the
-- senior deduction — up to $6,000 per eligible taxpayer, $12,000 MFJ — had
-- nowhere to land. Every client 65 or older rendered with taxable income
-- (line 15) overstated by that amount, which then overstated line 16 (tax),
-- line 19 (CTC limit) and lines 27/28. It is a below-the-line deduction
-- available to itemizers as well as to standard-deduction filers, so it
-- CANNOT be folded into line 12a; it needs its own line.
--
-- SCOPE OF THIS MIGRATION
-- Adds the two missing lines (6d, 13b), rewires line 14, and seeds the
-- Part V constants. It deliberately does NOT renumber 12a->12e / 13->13a /
-- 11->11a: those line_codes are foreign-keyed by form_1040_proconnect_map
-- and form_1040_line_inputs and referenced by lib/forms/form-1040-estimates.ts
-- and lib/tax/intake/*. Renumbering is a separate, purely cosmetic change.
-- The notes below record the divergence so it is discoverable in-table.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Open gaps in `ordinal` so new lines can be inserted in form order.
--    Ordinals are packed 1-per-line in scripts/141 (6c=120, 7=121; 13=203,
--    14=204), leaving no room. Ordinal is used ONLY for relative sort — by
--    lib/forms/form-1040.ts (loadSchema .order, evaluateComputedLines) and
--    components/tax/form-1040-viewer.tsx — so scaling by 10 preserves every
--    ordering while leaving 9 slots between each pair of lines.
--    Guarded so re-running does not scale a second time.
-- ---------------------------------------------------------------------------
UPDATE form_1040_lines
   SET ordinal = ordinal * 10
 WHERE tax_year = 2025
   AND form = '1040'
   AND NOT EXISTS (
     SELECT 1 FROM form_1040_lines
      WHERE tax_year = 2025 AND form = '1040' AND line_code = '13b'
   );

-- ---------------------------------------------------------------------------
-- 2. Line 6d — MFS lived apart from spouse the entire year.
--    Needed by the Social Security Benefits Worksheet: an MFS taxpayer who
--    lived APART all year uses the $25,000/$34,000 base amounts, while one
--    who lived WITH their spouse at any point uses a $0 base (Pub. 915).
--    The estimator currently has to assume the lived-with case for every MFS
--    return. This is a preparer-entered checkbox, therefore present in the
--    Export — it just has never been mapped. Seeding the line makes the gap
--    visible and gives a future sentinel round somewhere to attach.
-- ---------------------------------------------------------------------------
INSERT INTO form_1040_lines
  (tax_year, form, line_code, parent_code, ordinal, section, label, short_label,
   data_type, is_computed, computation, schedule_ref, worksheet_ref, notes)
VALUES
  (2025, '1040', '6d', '6', 1205, 'income',
   'If you are married filing separately and lived apart from your spouse for the entire year, check here',
   'MFS Lived Apart', 'boolean', false, NULL, NULL,
   'Social Security Benefits Worksheet',
   'New on the 2025 form. Selects the SS worksheet base amount for MFS: checked = $25,000/$34,000 (as for Single); unchecked = $0 base, so benefits are includible from the first dollar of provisional income. UNMAPPED — until it is mapped, lib/forms/form-1040-estimates.ts assumes the lived-with-spouse case for all MFS returns, which overstates taxable SS for MFS filers who lived apart.')
ON CONFLICT (tax_year, form, line_code) DO UPDATE
  SET parent_code = EXCLUDED.parent_code,
      ordinal     = EXCLUDED.ordinal,
      label       = EXCLUDED.label,
      short_label = EXCLUDED.short_label,
      data_type   = EXCLUDED.data_type,
      worksheet_ref = EXCLUDED.worksheet_ref,
      notes       = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 3. Line 13b — additional deductions from Schedule 1-A, line 38.
-- ---------------------------------------------------------------------------
INSERT INTO form_1040_lines
  (tax_year, form, line_code, parent_code, ordinal, section, label, short_label,
   data_type, is_computed, computation, schedule_ref, worksheet_ref, notes)
VALUES
  (2025, '1040', '13b', '13', 2035, 'tax_credits',
   'Additional deductions from Schedule 1-A, line 38',
   'Sch 1-A Ded', 'currency', false, NULL, 'Schedule 1-A, line 38', NULL,
   'New for TY2025 (OBBBA). Total of Schedule 1-A: qualified tips (Part II, cap $25,000), qualified overtime (Part III, cap $12,500/$25,000 MFJ), qualified passenger vehicle loan interest (Part IV, cap $10,000), and the enhanced deduction for seniors (Part V, $6,000 per eligible person). BELOW the line and available to itemizers, so it is separate from line 12a. The Hub estimates ONLY the Part V senior portion, which is derivable from date of birth and filing status; Parts II-IV depend on W-2 box 7 / employer-designated amounts and vehicle VINs that are not mapped, so a return with tips, overtime or car-loan interest will under-report this line.')
ON CONFLICT (tax_year, form, line_code) DO UPDATE
  SET parent_code   = EXCLUDED.parent_code,
      ordinal       = EXCLUDED.ordinal,
      label         = EXCLUDED.label,
      short_label   = EXCLUDED.short_label,
      data_type     = EXCLUDED.data_type,
      schedule_ref  = EXCLUDED.schedule_ref,
      notes         = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 4. Rewire line 14 to include 13b, and record the 13 -> 13a divergence.
-- ---------------------------------------------------------------------------
UPDATE form_1040_lines
   SET label       = 'Add lines 12c, 13, and 13b',
       short_label = 'Total Deductions',
       computation = '{"kind":"sum","operands":["12c","13","13b"]}'::jsonb,
       notes       = 'Computed. On the 2025 form this is "Add lines 12e, 13a, and 13b"; the Hub still carries the pre-2025 codes 12a/12c for the deduction and 13 for QBI (see scripts/386).'
 WHERE tax_year = 2025 AND line_code = '14';

UPDATE form_1040_lines
   SET notes = 'This is line 13a on the 2025 form, which split line 13 into 13a (QBI) and 13b (Schedule 1-A). The Hub keeps the code "13" because form_1040_proconnect_map and form_1040_line_inputs are foreign-keyed to it.'
 WHERE tax_year = 2025 AND line_code = '13';

-- ---------------------------------------------------------------------------
-- 5. ProConnect map rows for the two new lines. Both NULL — migration 140's
--    rule stands: never guess an address. 13b is a PTO-computed schedule
--    rollup and has no single input cell; 6d is a real input checkbox that
--    simply has not been through a sentinel round yet.
-- ---------------------------------------------------------------------------
INSERT INTO form_1040_proconnect_map
  (tax_year, form, line_code, return_type, cell_role, series_id, prefix_id,
   code_id, suffix_id, cell_field, confidence, notes)
VALUES
  (2025, '1040', '13b', 'IND', 'primary', NULL, NULL, NULL, NULL, 'val', 'unknown',
   'PTO-computed rollup of Schedule 1-A line 38 — no single input cell can hold it, same as lines 9/11/15. The Hub estimates the Part V senior portion; see lib/forms/form-1040-estimates.ts.'),
  (2025, '1040', '6d', 'IND', 'primary', NULL, NULL, NULL, NULL, 'val', 'unknown',
   'Not yet discovered. This IS an input checkbox (preparer-entered on the SS benefits screen), so a sentinel round should be able to find it. Mapping it removes the MFS lived-with-spouse assumption from the 6b estimator.')
-- cell_key is GENERATED ALWAYS ... STORED (scripts/387) and collapses to
-- '///' for an unmapped row, so it is never written directly but is part of
-- the key we conflict on.
ON CONFLICT (tax_year, return_type, form, line_code, cell_key) DO UPDATE
  SET notes = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 6. Schedule 1-A Part V constants — enhanced deduction for seniors.
--    Source: Schedule 1-A (Form 1040) 2025, Part V lines 31-37, and
--    IRC 151(d)(5) as added by OBBBA (P.L. 119-21) 70103.
--
--      31  MAGI (line 11a + excluded Puerto Rico income + Form 2555
--          lines 45 and 50 + Form 4563 line 15)
--      32  $75,000 ($150,000 if married filing jointly)
--      33  line 31 - line 32; if zero or less, the deduction is the full
--          $6,000 (no reduction)
--      34  line 33 x 6%
--      35  $6,000 - line 34, floored at zero      <- PER-PERSON amount
--      36a taxpayer's share, if born before 1961-01-02 with a valid SSN
--      36b spouse's share, same test, MFJ only
--      37  36a + 36b
--
--    Note the per-person structure: an MFJ couple with both spouses eligible
--    claims 2 x line 35, so the deduction fully phases out at MAGI $175,000
--    (single) and $250,000 (MFJ), NOT at a single shared $6,000.
--
--    MFS is INELIGIBLE: Part V's caution reads "If married, you must file
--    jointly to claim this deduction." Same for Parts II-IV.
-- ---------------------------------------------------------------------------
INSERT INTO form_1040_constants (tax_year, key, value, notes) VALUES
  (2025, 'senior_deduction_max', '6000',
   'Schedule 1-A Part V: enhanced deduction for seniors, per eligible individual, before the MAGI phase-down. $12,000 for an MFJ couple with both spouses eligible.'),
  (2025, 'senior_deduction_phaseout_start', '75000',
   'Schedule 1-A line 32: MAGI above which the senior deduction phases down. Single/MFS/HOH/QSS.'),
  (2025, 'senior_deduction_phaseout_start_mfj', '150000',
   'Schedule 1-A line 32: MAGI phase-down threshold, married filing jointly.'),
  (2025, 'senior_deduction_phaseout_rate', '0.06',
   'Schedule 1-A line 34: the per-person $6,000 is reduced by 6% of MAGI above the threshold. Fully phased out at MAGI $175,000 (single) / $250,000 (MFJ).')
ON CONFLICT (tax_year, key) DO UPDATE
  SET value = EXCLUDED.value, notes = EXCLUDED.notes;
