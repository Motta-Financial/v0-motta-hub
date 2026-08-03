-- ============================================================================
-- Form 1040 TY2025 Seed Data
-- ============================================================================
-- This script seeds form_1040_lines and form_1040_constants for tax year 2025.
-- Line labels, ordinals, and sections are transcribed from the official IRS
-- Form 1040 (Rev. January 2026) PDF and instructions. All amounts come from
-- Revenue Procedure 2024-40 (inflation adjustments for TY2025).
--
-- The proconnect_map rows are initialized as EMPTY — they're discovered
-- dynamically when we first export a real 1040 return from ProConnect. Never
-- fabricate cell coordinates from guesswork.
-- ============================================================================

-- Idempotent: delete existing TY2025 data before re-seeding
DELETE FROM form_1040_proconnect_map WHERE tax_year = 2025;
DELETE FROM form_1040_lines           WHERE tax_year = 2025;
DELETE FROM form_1040_constants       WHERE tax_year = 2025;

-- ---------------------------------------------------------------------------
-- Constants
-- ---------------------------------------------------------------------------
INSERT INTO form_1040_constants (tax_year, key, value, notes) VALUES
  (2025, 'std_deduction_single',           '15000',            'Standard deduction: Single or MFS'),
  (2025, 'std_deduction_mfj',              '30000',            'Standard deduction: Married Filing Jointly or QSS'),
  (2025, 'std_deduction_hoh',              '22500',            'Standard deduction: Head of Household'),
  (2025, 'std_deduction_mfs',              '15000',            'Standard deduction: Married Filing Separately'),
  (2025, 'additional_std_65_blind_single', '2000',             'Additional std deduction per 65+/blind: Single or HOH'),
  (2025, 'additional_std_65_blind_mfj',    '1600',             'Additional std deduction per 65+/blind: MFJ, MFS, QSS'),
  (2025, 'age_65_cutoff_birthdate',        '"1961-01-02"',     'Born BEFORE this date = age 65+ in TY2025'),
  (2025, 'epc_amount',                     '3',                'Presidential Election Campaign fund designation'),
  (2025, 'dependent_credit_ctc',           '2000',             'Child Tax Credit per qualifying child'),
  (2025, 'dependent_credit_odc',           '500',              'Other Dependent Credit per qualifying dependent'),
  (2025, 'ctc_refundable_limit',           '1700',             'Additional CTC refundable portion limit per child'),
  (2025, 'earned_income_threshold_ctc',    '2500',             'EI threshold for CTC computation'),
  (2025, 'mfj_ctc_phaseout_start',         '400000',           'CTC phaseout starts at AGI for MFJ'),
  (2025, 'other_ctc_phaseout_start',       '200000',           'CTC phaseout starts at AGI for other filing statuses')
ON CONFLICT (tax_year, key) DO UPDATE SET value = EXCLUDED.value, notes = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- Lines (Page 1)
-- ---------------------------------------------------------------------------
INSERT INTO form_1040_lines
  (tax_year, line_code, parent_code, ordinal, section, label, short_label, data_type, is_computed, computation, schedule_ref, notes)
VALUES
  -- Header / Filing Status (boxes, not numbered lines)
  (2025, 'fs_single',             NULL, 1,  'filing_status', 'Single',                                       'Single',    'boolean', false, NULL, NULL, NULL),
  (2025, 'fs_mfj',                NULL, 2,  'filing_status', 'Married filing jointly',                       'MFJ',       'boolean', false, NULL, NULL, 'Check if MFJ even if one spouse had no income'),
  (2025, 'fs_mfs',                NULL, 3,  'filing_status', 'Married filing separately',                    'MFS',       'boolean', false, NULL, NULL, 'Enter spouse SSN or NRA above'),
  (2025, 'fs_hoh',                NULL, 4,  'filing_status', 'Head of household',                            'HOH',       'boolean', false, NULL, NULL, 'Requires qualifying person; attach Sch EIC if claiming EIC'),
  (2025, 'fs_qss',                NULL, 5,  'filing_status', 'Qualifying surviving spouse',                  'QSS',       'boolean', false, NULL, NULL, 'Year of spouse death required'),

  -- Digital Assets question
  (2025, 'digital_assets',        NULL, 10, 'digital_assets', 'Digital assets question (Yes/No)',            'Crypto?',   'boolean', false, NULL, NULL, 'Answer required; "No" if only held in traditional brokerage'),

  -- Income section
  (2025, '1a',  '1',  100, 'income', 'Total amount from Form(s) W-2, box 1',                        'W-2 Wages',          'currency', false, NULL, NULL, 'Attach Form(s) W-2'),
  (2025, '1b',  '1',  101, 'income', 'Household employee wages not reported on W-2',                'HH Wages',           'currency', false, NULL, NULL, NULL),
  (2025, '1c',  '1',  102, 'income', 'Tip income not reported on line 1a',                          'Tips',               'currency', false, NULL, NULL, 'Attach Form 4137 if required'),
  (2025, '1d',  '1',  103, 'income', 'Medicaid waiver payments not reported on W-2',                'Medicaid Waivers',   'currency', false, NULL, NULL, 'See Pub 525'),
  (2025, '1e',  '1',  104, 'income', 'Taxable dependent care benefits from Form 2441, line 26',    'Dep Care',           'currency', false, NULL, 'Form 2441, line 26', NULL),
  (2025, '1f',  '1',  105, 'income', 'Employer-provided adoption benefits from Form 8839, line 29', 'Adoption',          'currency', false, NULL, 'Form 8839, line 29', NULL),
  (2025, '1g',  '1',  106, 'income', 'Wages from Form 8919, line 6',                                '8919 Wages',         'currency', false, NULL, 'Form 8919, line 6', NULL),
  (2025, '1h',  '1',  107, 'income', 'Other earned income (Pub 525)',                               'Other Earned',       'currency', false, NULL, NULL, 'Strike pay, disability, etc.'),
  (2025, '1i',  '1',  108, 'income', 'Nontaxable combat pay election',                              'Combat Pay Elect',   'currency', false, NULL, NULL, 'See instructions'),
  (2025, '1z',  '1',  109, 'income', 'Add lines 1a through 1h',                                     'Total Wages',        'currency', true,  '{"kind":"sum","operands":["1a","1b","1c","1d","1e","1f","1g","1h"]}', NULL, 'Computed'),

  (2025, '2a',  '2',  110, 'income', 'Tax-exempt interest',                                         'Exempt Int',         'currency', false, NULL, NULL, 'Do not include on line 2b'),
  (2025, '2b',  '2',  111, 'income', 'Taxable interest',                                            'Taxable Int',        'currency', false, NULL, NULL, 'Attach Schedule B if over $1,500'),

  (2025, '3a',  '3',  112, 'income', 'Qualified dividends',                                         'Qual Divs',          'currency', false, NULL, NULL, 'See instructions'),
  (2025, '3b',  '3',  113, 'income', 'Ordinary dividends',                                          'Ord Divs',           'currency', false, NULL, NULL, 'Attach Schedule B if over $1,500'),

  (2025, '4a',  '4',  114, 'income', 'IRA distributions',                                           'IRA Dist',           'currency', false, NULL, NULL, 'Total distribution amount'),
  (2025, '4b',  '4',  115, 'income', 'Taxable amount',                                              'IRA Taxable',        'currency', false, NULL, NULL, NULL),

  (2025, '5a',  '5',  116, 'income', 'Pensions and annuities',                                      'Pensions',           'currency', false, NULL, NULL, 'Total distribution amount'),
  (2025, '5b',  '5',  117, 'income', 'Taxable amount',                                              'Pens Taxable',       'currency', false, NULL, NULL, 'May use Simplified Method worksheet'),

  (2025, '6a',  '6',  118, 'income', 'Social security benefits',                                    'SS Benefits',        'currency', false, NULL, NULL, 'From SSA-1099 box 5'),
  (2025, '6b',  '6',  119, 'income', 'Taxable amount',                                              'SS Taxable',         'currency', false, NULL, NULL, 'Use Soc Sec Benefits Worksheet'),
  (2025, '6c',  '6',  120, 'income', 'If electing lump-sum, check here',                            'Lump Sum Elec',      'boolean',  false, NULL, NULL, NULL),

  (2025, '7',   NULL, 121, 'income', 'Capital gain or (loss). Attach Schedule D if required.',     'Cap Gain/Loss',      'currency', false, NULL, 'Schedule D', 'If not required, enter directly from 1099'),
  (2025, '8',   NULL, 122, 'income', 'Additional income from Schedule 1, line 10',                  'Sched 1 Income',     'currency', false, NULL, 'Schedule 1, line 10', NULL),
  (2025, '9',   NULL, 123, 'income', 'Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7, and 8. This is your total income.', 'Total Income', 'currency', true, '{"kind":"sum","operands":["1z","2b","3b","4b","5b","6b","7","8"]}', NULL, 'Computed'),

  (2025, '10',  NULL, 124, 'income', 'Adjustments to income from Schedule 1, line 26',              'Sched 1 Adj',        'currency', false, NULL, 'Schedule 1, line 26', NULL),
  (2025, '11',  NULL, 125, 'income', 'Subtract line 10 from line 9. This is your adjusted gross income.', 'AGI', 'currency', true, '{"kind":"diff","operands":["9","10"]}', NULL, 'Computed'),

  -- Page 2 — Tax and Credits
  (2025, '12a', '12', 200, 'tax_credits', 'Standard deduction or itemized deductions (from Sch A)', 'Std/Itemized', 'currency', false, NULL, 'Schedule A', 'Check 12a box if std; if itemized, enter from Sch A'),
  (2025, '12b', '12', 201, 'tax_credits', 'Charitable contributions if taking standard deduction',  'Char Contrib',       'currency', false, NULL, NULL, 'Up to $300 ($600 MFJ) for 2021 only; not available TY2025'),
  (2025, '12c', '12', 202, 'tax_credits', 'Add lines 12a and 12b',                                   'Total Deduction',    'currency', true,  '{"kind":"sum","operands":["12a","12b"]}', NULL, 'Computed'),

  (2025, '13',  NULL, 203, 'tax_credits', 'Qualified business income deduction from Form 8995 or 8995-A', 'QBI Ded',    'currency', false, NULL, 'Form 8995(-A)', NULL),
  (2025, '14',  NULL, 204, 'tax_credits', 'Add lines 12c and 13',                                    'Total Ded+QBI',      'currency', true,  '{"kind":"sum","operands":["12c","13"]}', NULL, 'Computed'),
  (2025, '15',  NULL, 205, 'tax_credits', 'Subtract line 14 from line 11. If zero or less, enter 0. This is your taxable income.', 'Taxable Income', 'currency', true, '{"kind":"subtract_floor_zero","operands":["11","14"]}', NULL, 'Computed'),

  (2025, '16',  NULL, 206, 'tax_credits', 'Tax (see instructions). Check if from: (a) Form(s) 8814 (b) Form 4972 (c) Other', 'Tax', 'currency', false, NULL, NULL, 'Use Tax Table, Tax Comp Worksheet, or Qual Div/Cap Gain worksheet'),
  (2025, '17',  NULL, 207, 'tax_credits', 'Amount from Schedule 2, line 3',                          'Sched 2 Tax',        'currency', false, NULL, 'Schedule 2, line 3', NULL),
  (2025, '18',  NULL, 208, 'tax_credits', 'Add lines 16 and 17',                                     'Total Tax Before',   'currency', true,  '{"kind":"sum","operands":["16","17"]}', NULL, 'Computed'),

  (2025, '19',  NULL, 209, 'tax_credits', 'Child tax credit or credit for other dependents from Sch 8812', 'CTC/ODC',    'currency', false, NULL, 'Schedule 8812', NULL),
  (2025, '20',  NULL, 210, 'tax_credits', 'Amount from Schedule 3, line 8',                          'Sched 3 Credits',    'currency', false, NULL, 'Schedule 3, line 8', NULL),
  (2025, '21',  NULL, 211, 'tax_credits', 'Add lines 19 and 20',                                     'Total Credits',      'currency', true,  '{"kind":"sum","operands":["19","20"]}', NULL, 'Computed'),
  (2025, '22',  NULL, 212, 'tax_credits', 'Subtract line 21 from line 18. If zero or less, enter 0.', 'Tax After Credits', 'currency', true, '{"kind":"subtract_floor_zero","operands":["18","21"]}', NULL, 'Computed'),

  (2025, '23',  NULL, 213, 'tax_credits', 'Other taxes from Schedule 2, line 21',                    'Other Taxes',        'currency', false, NULL, 'Schedule 2, line 21', NULL),
  (2025, '24',  NULL, 214, 'tax_credits', 'Add lines 22 and 23. This is your total tax.',            'Total Tax',          'currency', true,  '{"kind":"sum","operands":["22","23"]}', NULL, 'Computed'),

  -- Payments
  (2025, '25a', '25', 300, 'payments', 'Federal income tax withheld from W-2s',                      'W-2 Withholding',    'currency', false, NULL, NULL, 'From box 2 of W-2'),
  (2025, '25b', '25', 301, 'payments', 'Federal income tax withheld from 1099s',                     '1099 Withholding',   'currency', false, NULL, NULL, NULL),
  (2025, '25c', '25', 302, 'payments', 'Other withholding / Form W-4P or 1099-R',                    'Other Withholding',  'currency', false, NULL, NULL, NULL),
  (2025, '25d', '25', 303, 'payments', 'Add lines 25a, 25b, and 25c',                                'Total Withholding',  'currency', true,  '{"kind":"sum","operands":["25a","25b","25c"]}', NULL, 'Computed'),

  (2025, '26',  NULL, 304, 'payments', 'Estimated tax payments and amount applied from prior year', 'Est Tax Pmts',       'currency', false, NULL, NULL, NULL),
  (2025, '27',  NULL, 305, 'payments', 'Earned income credit (EIC)',                                 'EIC',                'currency', false, NULL, 'Schedule EIC', 'Attach Sch EIC if claiming'),
  (2025, '28',  NULL, 306, 'payments', 'Additional child tax credit from Schedule 8812',            'Add''l CTC',         'currency', false, NULL, 'Schedule 8812', 'Refundable portion'),
  (2025, '29',  NULL, 307, 'payments', 'American opportunity credit from Form 8863, line 8',        'AOTC Refundable',    'currency', false, NULL, 'Form 8863, line 8', 'Refundable portion'),
  (2025, '30',  NULL, 308, 'payments', 'Reserved for future use',                                    'Reserved',           'currency', false, NULL, NULL, NULL),
  (2025, '31',  NULL, 309, 'payments', 'Amount from Schedule 3, line 15',                            'Sched 3 Pmts',       'currency', false, NULL, 'Schedule 3, line 15', NULL),
  (2025, '32',  NULL, 310, 'payments', 'Add lines 27, 28, 29, 30, and 31. These are your total other payments and refundable credits.', 'Other Pmts/Creds', 'currency', true, '{"kind":"sum","operands":["27","28","29","30","31"]}', NULL, 'Computed'),
  (2025, '33',  NULL, 311, 'payments', 'Add lines 25d, 26, and 32. These are your total payments.',  'Total Payments',     'currency', true,  '{"kind":"sum","operands":["25d","26","32"]}', NULL, 'Computed'),

  -- Refund
  (2025, '34',  NULL, 400, 'refund', 'If line 33 is more than line 24, subtract line 24 from line 33. This is the amount you overpaid.', 'Overpayment', 'currency', true, '{"kind":"subtract_floor_zero","operands":["33","24"]}', NULL, 'Computed; refund path'),
  (2025, '35a', '35', 401, 'refund', 'Amount of line 34 you want refunded to you',                  'Refund Amt',         'currency', false, NULL, NULL, NULL),
  (2025, '35b', '35', 402, 'refund', 'Routing number',                                               'Routing #',          'routing',  false, NULL, NULL, '9 digits'),
  (2025, '35c', '35', 403, 'refund', 'Account type: Checking / Savings',                             'Acct Type',          'enum',     false, NULL, NULL, NULL),
  (2025, '35d', '35', 404, 'refund', 'Account number',                                               'Account #',          'account',  false, NULL, NULL, NULL),
  (2025, '36',  NULL, 405, 'refund', 'Amount of line 34 you want applied to your 2026 estimated tax', 'Apply to Est',    'currency', false, NULL, NULL, NULL),

  -- Amount You Owe
  (2025, '37',  NULL, 500, 'amount_owed', 'Subtract line 33 from line 24. This is the amount you owe.', 'Amount Owed',    'currency', true,  '{"kind":"subtract_floor_zero","operands":["24","33"]}', NULL, 'Computed'),
  (2025, '38',  NULL, 501, 'amount_owed', 'Estimated tax penalty (see instructions)',                'Est Tax Penalty',    'currency', false, NULL, NULL, 'Attach Form 2210 if required')
ON CONFLICT (tax_year, line_code) DO UPDATE SET
  parent_code   = EXCLUDED.parent_code,
  ordinal       = EXCLUDED.ordinal,
  section       = EXCLUDED.section,
  label         = EXCLUDED.label,
  short_label   = EXCLUDED.short_label,
  data_type     = EXCLUDED.data_type,
  is_computed   = EXCLUDED.is_computed,
  computation   = EXCLUDED.computation,
  schedule_ref  = EXCLUDED.schedule_ref,
  notes         = EXCLUDED.notes;

-- Enum options for 35c
UPDATE form_1040_lines
   SET enum_options = '["checking","savings"]'::jsonb
 WHERE tax_year = 2025 AND line_code = '35c';

-- Dependents section rows (special structure)
INSERT INTO form_1040_lines
  (tax_year, line_code, parent_code, ordinal, section, label, short_label, data_type, is_computed, notes)
VALUES
  (2025, 'dep_name',   'dependents', 50, 'dependents', 'Dependent name (first, last)',          'Name',   'text',    false, 'Up to 4 on 1040; more on continuation sheet'),
  (2025, 'dep_ssn',    'dependents', 51, 'dependents', 'Dependent SSN',                         'SSN',    'ssn',     false, NULL),
  (2025, 'dep_rel',    'dependents', 52, 'dependents', 'Relationship to you',                   'Rel',    'text',    false, NULL),
  (2025, 'dep_ctc',    'dependents', 53, 'dependents', 'Child tax credit checkbox',             'CTC',    'boolean', false, 'Check if qualifying child'),
  (2025, 'dep_odc',    'dependents', 54, 'dependents', 'Credit for other dependents checkbox',  'ODC',    'boolean', false, 'Check if qualifying for ODC but not CTC')
ON CONFLICT (tax_year, line_code) DO UPDATE SET
  label       = EXCLUDED.label,
  short_label = EXCLUDED.short_label,
  data_type   = EXCLUDED.data_type,
  notes       = EXCLUDED.notes;
