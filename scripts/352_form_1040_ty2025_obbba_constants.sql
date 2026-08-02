-- 352: Correct TY2025 Form 1040 constants to enacted OBBBA (P.L. 119-21)
-- amounts. Seed 141 was transcribed from pre-OBBBA Rev. Proc. 2024-40.
-- Applied to live DB 2026-07-25 (migration form_1040_ty2025_obbba_constants).
UPDATE form_1040_constants SET value='15750', notes='Standard deduction: Single or MFS (OBBBA §70102)' WHERE tax_year=2025 AND key='std_deduction_single';
UPDATE form_1040_constants SET value='31500', notes='Standard deduction: MFJ or QSS (OBBBA §70102)' WHERE tax_year=2025 AND key='std_deduction_mfj';
UPDATE form_1040_constants SET value='23625', notes='Standard deduction: Head of Household (OBBBA §70102)' WHERE tax_year=2025 AND key='std_deduction_hoh';
UPDATE form_1040_constants SET value='15750', notes='Standard deduction: MFS (OBBBA §70102)' WHERE tax_year=2025 AND key='std_deduction_mfs';
UPDATE form_1040_constants SET value='2200', notes='Child Tax Credit per qualifying child (OBBBA §70104, permanent)' WHERE tax_year=2025 AND key='dependent_credit_ctc';
