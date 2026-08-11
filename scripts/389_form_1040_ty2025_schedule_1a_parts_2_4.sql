-- ============================================================================
-- Form 1040 TY2025: Schedule 1-A Parts II-IV constants (tips / overtime / QPVLI)
-- ============================================================================
-- Companion to scripts/386, which added line 13b and the Part V senior
-- deduction. These are the other three Schedule 1-A deductions.
--
-- WHY: lib/tax/intake/compute.ts put OBBBA qualified tips and overtime into
-- Form 1040 line 10 (Schedule 1 adjustments to income), which is above the
-- line. They are Schedule 1-A deductions and belong on line 13b, BELOW the
-- line. The misplacement understated AGI by the full tips + overtime amount,
-- and AGI drives Social Security taxability, the CTC phaseout, the Part V
-- senior deduction phaseout, NIIT, and the phaseouts of these very
-- deductions. It also left the caps unmodelled, so the figure was flagged
-- "indicative" rather than computed.
--
-- All amounts and mechanics are transcribed from Schedule 1-A (Form 1040)
-- 2025, Cat. No. 95872Q, created 11/4/25.
--
-- NOTE ON THE ROUNDING DIRECTION — it differs between the parts, and the
-- form is explicit about it:
--   Part II  line 11 (tips):    "decrease the result to the next lower whole
--                                number"   -> FLOOR the thousands quotient
--   Part III line 19 (overtime): "decrease ... next lower whole number"
--                                          -> FLOOR
--   Part IV  line 28 (QPVLI):   "increase the result to the next higher
--                                whole number"  -> CEIL
-- Getting this backwards changes the deduction by up to one increment
-- ($100 for tips/overtime, $200 for vehicle loan interest).
--
-- MFS: Parts II-V all carry the same caution — "If married, you must file
-- jointly to claim this deduction." There is therefore no MFS variant of any
-- cap or threshold below; an MFS return claims none of these.
--
-- Idempotent: safe to re-run.
-- ============================================================================

INSERT INTO form_1040_constants (tax_year, key, value, notes) VALUES

  -- ── Part II: qualified tips (lines 4-13) ──────────────────────────────
  (2025, 'tips_deduction_cap', '25000',
   'Schedule 1-A line 7: qualified tips deduction cap. Only tips received in an occupation on the IRS.gov/TippedOccupations list count, and a valid SSN is required.'),

  -- ── Part III: qualified overtime (lines 14-21) ────────────────────────
  (2025, 'overtime_deduction_cap', '12500',
   'Schedule 1-A line 15: qualified overtime compensation deduction cap, all statuses except MFJ.'),
  (2025, 'overtime_deduction_cap_mfj', '25000',
   'Schedule 1-A line 15: qualified overtime deduction cap, married filing jointly.'),

  -- Parts II and III share one phase-out: $100 per whole $1,000 of MAGI
  -- above the threshold, the quotient rounded DOWN.
  (2025, 'tips_overtime_phaseout_start', '150000',
   'Schedule 1-A lines 9 and 17: MAGI above which the tips and overtime deductions phase down. All statuses except MFJ.'),
  (2025, 'tips_overtime_phaseout_start_mfj', '300000',
   'Schedule 1-A lines 9 and 17: tips/overtime MAGI phase-down threshold, married filing jointly.'),
  (2025, 'tips_overtime_phaseout_per_1000', '100',
   'Schedule 1-A lines 11-12 and 19-20: the deduction is reduced by this much for each WHOLE $1,000 of MAGI above the threshold (quotient rounded DOWN — see the migration header).'),

  -- ── Part IV: qualified passenger vehicle loan interest (lines 22-30) ──
  (2025, 'qpvli_deduction_cap', '10000',
   'Schedule 1-A line 24: qualified passenger vehicle loan interest deduction cap. Excludes interest already deducted on Schedule C/E/F.'),
  (2025, 'qpvli_phaseout_start', '100000',
   'Schedule 1-A line 26: MAGI above which the vehicle loan interest deduction phases down. All statuses except MFJ.'),
  (2025, 'qpvli_phaseout_start_mfj', '200000',
   'Schedule 1-A line 26: QPVLI MAGI phase-down threshold, married filing jointly.'),
  (2025, 'qpvli_phaseout_per_1000', '200',
   'Schedule 1-A lines 28-29: reduced by this much per $1,000 of MAGI above the threshold, quotient rounded UP (opposite of Parts II/III).')

ON CONFLICT (tax_year, key) DO UPDATE
  SET value = EXCLUDED.value, notes = EXCLUDED.notes;
