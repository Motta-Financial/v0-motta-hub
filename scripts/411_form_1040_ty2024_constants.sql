-- 411: TY2024 Form 1040 constants, seeded from IRS primary sources.
--
-- Companion to scripts/401, which gave TY2024 its line layout and mappings by
-- inheritance from TY2025 but deliberately seeded NO constants — because
-- inheriting a 2025 bracket or standard deduction produces a wrong tax on a
-- real client return. This file closes that half. Affects 10 TY2024 IND
-- returns.
--
-- ═══ SOURCES ═════════════════════════════════════════════════════════
-- Every figure below was read out of the IRS source named in its own `notes`,
-- not carried over from the TY2025 rows. The sources, in full:
--
--   Rev. Proc. 2023-34 (IRB 2023-48) — the annual inflation adjustments:
--     §3.01  tax rate tables, all four filing statuses
--     §3.03  maximum capital gains rate (0% / 15% breakpoints)
--     §3.05  refundable portion of the child tax credit
--     §3.06  earned income credit table, and the §32(i) investment cap
--     §3.13  educator expenses
--     §3.15  standard deduction, including §63(f) aged/blind
--     §3.30  student loan interest phase-out
--   Notice 2024-08 — 2024 standard mileage rates (medical 21¢, charitable 14¢)
--   Rev. Proc. 2023-23 §2.01 — 2024 HSA contribution limits
--
-- Statutory amounts that are NOT inflation-indexed (§86 Social Security
-- thresholds, §1411 NIIT, §3101(b)(2) Additional Medicare, §1211(b) capital
-- loss, §24 CTC as amended by TCJA, §170(i) charitable mileage) carry their
-- Code cite instead of a Rev. Proc. cite, because for those "unchanged from
-- 2025" is the substantive answer rather than a copy.
--
-- ═══ WHAT IS DELIBERATELY ABSENT — 19 KEYS ═══════════════════════════
--
-- These exist for TY2025 and MUST NOT exist for TY2024. Absent, not zeroed:
-- a zero reads as "the law says nothing here", which is false and computes.
--
--   Schedule 1-A family (14 keys) — the whole schedule is an OBBBA (P.L.
--   119-21) creation effective for tax years beginning after 2024. There is
--   no tips, overtime, vehicle-loan-interest or senior deduction on a 2024
--   return:
--     tips_deduction_cap, tips_overtime_phaseout_per_1000,
--     tips_overtime_phaseout_start, tips_overtime_phaseout_start_mfj,
--     overtime_deduction_cap, overtime_deduction_cap_mfj,
--     qpvli_deduction_cap, qpvli_phaseout_per_1000, qpvli_phaseout_start,
--     qpvli_phaseout_start_mfj, senior_deduction_max,
--     senior_deduction_phaseout_rate, senior_deduction_phaseout_start,
--     senior_deduction_phaseout_start_mfj
--
--   SALT phase-down family (5 keys) — NOT on the original brief, and easy to
--   miss because `salt_cap` itself very much exists for 2024. The CAP is
--   $10,000 under IRC §164(b)(6) as enacted by the TCJA; the $40,000 cap AND
--   its 30%-of-excess phase-down are both OBBBA §70120, TY2025-forward. If
--   these were inherited, a 2024 return with MAGI over $500k would have its
--   SALT deduction phased down under a rule that did not exist:
--     salt_phaseout_start, salt_phaseout_start_mfs, salt_phaseout_rate,
--     salt_phaseout_floor, salt_phaseout_floor_mfs
--
--   Verified safe against both consumers before omitting them:
--     lib/forms/form-1040-estimates.ts defaults the phase-out START to
--     Infinity when absent, so `magi <= start` always holds and the full cap
--     is returned.
--     lib/tax/intake/store.ts defaults an absent numeric to 0, so the
--     phase-out RATE is 0 and `cap - (magi - start) * 0` is the full cap.
--   Both paths therefore apply a flat $10,000 cap with no phase-down, which
--   is the 2024 law. Neither throws on the missing keys.
--
-- ═══ GATES STAY CLOSED ═══════════════════════════════════════════════
--
-- `tax_brackets_verified` and `itemized_constants_verified` are seeded FALSE,
-- exactly as TY2025's were (scripts/360, scripts/362). Seeding a figure and
-- asserting it is correct are two different acts, and only the first one is
-- happening here. While these are false the Hub keeps reporting lines 12 and
-- 16 as unavailable — the same behaviour as before this migration, and the
-- correct one. Flipping them is a human's signature on a second read of the
-- sources above, not a side effect of loading data.
--
-- `layout_verified` (scripts/401) is NOT touched here. It gates the line
-- inventory, which this migration says nothing about.
--
-- Idempotent: upserts on (tax_year, key), and deletes the 19 keys above if a
-- previous run or a copy-from-2025 ever introduced them.

begin;

-- ── Guard: refuse to run if TY2025 is not the shape we are contrasting ──
do $$
declare n2025 int;
begin
  select count(*) into n2025 from form_1040_constants where tax_year = 2025;
  if n2025 < 60 then
    raise exception 'Expected >= 60 TY2025 constants as the contrast set, found %', n2025;
  end if;
end $$;

insert into form_1040_constants (tax_year, key, value, notes) values

-- ══ GATES ═══════════════════════════════════════════════════════════════
(2024, 'tax_brackets_verified', 'false'::jsonb,
 'GATE: set true ONLY after re-reading the four bracket tables below against '
 'Rev. Proc. 2023-34 §3.01. While false the Hub refuses to compute Form 1040 '
 'line 16 and reports it unavailable. Seeded false by scripts/411, which '
 'transcribed the tables but does not certify them.'),
(2024, 'itemized_constants_verified', 'false'::jsonb,
 'GATE: set true ONLY after checking every Schedule A constant below against '
 'the 2024 Schedule A instructions. While false the Hub refuses to compute '
 'Form 1040 line 12 when a Schedule A is present. The SALT cap is the figure '
 'to check hardest: $10,000 flat for 2024, with NO phase-down — the $40,000 '
 'cap and its phase-down are OBBBA §70120 and start in TY2025.'),

-- ══ STANDARD DEDUCTION — Rev. Proc. 2023-34 §3.15(1) ════════════════════
(2024, 'std_deduction_single', '14600'::jsonb,
 'Standard deduction: Unmarried individuals other than surviving spouses and '
 'heads of households (§1(j)(2)(C)). Rev. Proc. 2023-34 §3.15(1).'),
(2024, 'std_deduction_mfj', '29200'::jsonb,
 'Standard deduction: Married filing jointly and surviving spouses '
 '(§1(j)(2)(A)). Rev. Proc. 2023-34 §3.15(1).'),
(2024, 'std_deduction_hoh', '21900'::jsonb,
 'Standard deduction: Head of household (§1(j)(2)(B)). Rev. Proc. 2023-34 '
 '§3.15(1).'),
(2024, 'std_deduction_mfs', '14600'::jsonb,
 'Standard deduction: Married filing separately (§1(j)(2)(D)). Rev. Proc. '
 '2023-34 §3.15(1).'),

-- ══ §63(f) AGED / BLIND — Rev. Proc. 2023-34 §3.15(3) ══════════════════
-- Per BOX, not per person: aged and blind count separately, and on a joint
-- return both spouses count. See lib/forms/form-1040-estimates.ts.
(2024, 'additional_std_65_blind_mfj', '1550'::jsonb,
 'Additional standard deduction per 65+/blind box: MFJ, MFS, QSS. §63(f); '
 'Rev. Proc. 2023-34 §3.15(3) — "$1,550".'),
(2024, 'additional_std_65_blind_single', '1950'::jsonb,
 'Additional standard deduction per 65+/blind box: Single or HOH. §63(f); '
 'Rev. Proc. 2023-34 §3.15(3) — increased to "$1,950 if the individual is '
 'also unmarried and not a surviving spouse".'),
(2024, 'age_65_cutoff_birthdate', '"1960-01-02"'::jsonb,
 'Born BEFORE this date = age 65+ for TY2024. A taxpayer is treated as 65 on '
 'the day before their 65th birthday, so turning 65 on 1 Jan 2025 qualifies '
 'for 2024. Exactly one year earlier than the TY2025 cutoff.'),

-- ══ RATE TABLES — Rev. Proc. 2023-34 §3.01 ══════════════════════════════
-- [rate, upper bound of that bracket]; null upper bound = top bracket.
-- Bracket EDGES only; the "$X plus Y% of the excess" base amounts are not
-- stored because the engine accumulates them.
(2024, 'tax_brackets_single',
 '[[0.10,11600],[0.12,47150],[0.22,100525],[0.24,191950],[0.32,243725],[0.35,609350],[0.37,null]]'::jsonb,
 'TY2024 Single brackets. Rev. Proc. 2023-34 §3.01 TABLE 3 (§1(j)(2)(C)).'),
(2024, 'tax_brackets_mfj',
 '[[0.10,23200],[0.12,94300],[0.22,201050],[0.24,383900],[0.32,487450],[0.35,731200],[0.37,null]]'::jsonb,
 'TY2024 MFJ/QSS brackets. Rev. Proc. 2023-34 §3.01 TABLE 1 (§1(j)(2)(A)).'),
(2024, 'tax_brackets_hoh',
 '[[0.10,16550],[0.12,63100],[0.22,100500],[0.24,191950],[0.32,243700],[0.35,609350],[0.37,null]]'::jsonb,
 'TY2024 HOH brackets. Rev. Proc. 2023-34 §3.01 TABLE 2 (§1(j)(2)(B)). NOTE '
 'the 22% and 32% edges (100,500 / 243,700) differ from Single by a few '
 'hundred dollars — they are not a typo.'),
(2024, 'tax_brackets_mfs',
 '[[0.10,11600],[0.12,47150],[0.22,100525],[0.24,191950],[0.32,243725],[0.35,365600],[0.37,null]]'::jsonb,
 'TY2024 MFS brackets. Rev. Proc. 2023-34 §3.01 TABLE 4 (§1(j)(2)(D)). '
 'Identical to Single except the 35% ceiling, which is half the MFJ figure '
 '(365,600 vs 731,200).'),

-- ══ PREFERENTIAL RATES — Rev. Proc. 2023-34 §3.03 ══════════════════════
(2024, 'qdcg_zero_top_single', '47025'::jsonb,
 'TY2024 LTCG/QD 0% bracket top: Single ("All Other Individuals" in the '
 'Rev. Proc. table). Rev. Proc. 2023-34 §3.03.'),
(2024, 'qdcg_zero_top_mfj', '94050'::jsonb,
 'TY2024 LTCG/QD 0% top: MFJ/QSS. Rev. Proc. 2023-34 §3.03.'),
(2024, 'qdcg_zero_top_mfs', '47025'::jsonb,
 'TY2024 LTCG/QD 0% top: MFS. Rev. Proc. 2023-34 §3.03.'),
(2024, 'qdcg_zero_top_hoh', '63000'::jsonb,
 'TY2024 LTCG/QD 0% top: HOH. Rev. Proc. 2023-34 §3.03.'),
(2024, 'qdcg_fifteen_top_single', '518900'::jsonb,
 'TY2024 LTCG/QD 15% bracket top: Single. Rev. Proc. 2023-34 §3.03.'),
(2024, 'qdcg_fifteen_top_mfj', '583750'::jsonb,
 'TY2024 LTCG/QD 15% top: MFJ/QSS. Rev. Proc. 2023-34 §3.03.'),
(2024, 'qdcg_fifteen_top_mfs', '291850'::jsonb,
 'TY2024 LTCG/QD 15% top: MFS. Rev. Proc. 2023-34 §3.03.'),
(2024, 'qdcg_fifteen_top_hoh', '551350'::jsonb,
 'TY2024 LTCG/QD 15% top: HOH. Rev. Proc. 2023-34 §3.03.'),
(2024, 'qdcg_worksheet_implemented', 'false'::jsonb,
 'The Qualified Dividends and Capital Gain Tax Worksheet is not implemented '
 'in the Hub preview. When qualified dividends or net capital gain are '
 'present, line 16 is reported unavailable rather than taxed at ordinary '
 'rates. Same posture as TY2025; the breakpoints above exist so the reason '
 'is discoverable in the table a preparer would look in.'),

-- ══ CHILD TAX CREDIT ═══════════════════════════════════════════════════
-- Pre-OBBBA. The $2,000 credit and the 400k/200k phase-out starts are TCJA
-- §24(h), fixed by statute and NOT inflation-indexed, so no Rev. Proc. cite.
(2024, 'dependent_credit_ctc', '2000'::jsonb,
 'Child Tax Credit per qualifying child. §24(h)(2) as enacted by the TCJA — '
 '$2,000 through TY2025. OBBBA §70104 raised it to $2,200 effective TY2025, '
 'which is why the TY2025 row differs.'),
(2024, 'ctc_refundable_limit', '1700'::jsonb,
 'Maximum refundable portion (additional CTC) per qualifying child. '
 '§24(d)(1)(A); Rev. Proc. 2023-34 §3.05 — "$1,700".'),
(2024, 'dependent_credit_odc', '500'::jsonb,
 'Credit for Other Dependents per qualifying dependent. §24(h)(4). Fixed by '
 'statute, not indexed.'),
(2024, 'earned_income_threshold_ctc', '2500'::jsonb,
 'Earned income threshold above which the refundable CTC is computed. '
 '§24(d)(1)(B)(i). Fixed by statute, not indexed.'),
(2024, 'mfj_ctc_phaseout_start', '400000'::jsonb,
 'CTC phase-out begins at this modified AGI for MFJ. §24(h)(3). Not indexed.'),
(2024, 'other_ctc_phaseout_start', '200000'::jsonb,
 'CTC phase-out begins at this modified AGI for all other statuses. '
 '§24(h)(3). Not indexed.'),

-- ══ EARNED INCOME CREDIT — Rev. Proc. 2023-34 §3.06 ════════════════════
-- Arrays are ordered [0 children, 1, 2, 3-or-more], matching the TY2025 row
-- and lib/forms/form-1040-estimates.ts. NOTE the Rev. Proc. prints its table
-- in the order One / Two / Three-or-More / None — the arrays below are
-- re-ordered to put None first.
(2024, 'eic_params',
 '{"rate":[0.0765,0.34,0.40,0.45],'
 '"earnedAmount":[8260,12390,17400,17400],'
 '"maxCredit":[632,4213,6960,7830],'
 '"phaseoutRate":[0.0765,0.1598,0.2106,0.2106],'
 '"phaseoutStart":[10330,22720,22720,22720],'
 '"phaseoutStartMfj":[17250,29640,29640,29640],'
 '"investmentIncomeLimit":11600}'::jsonb,
 'TY2024 EIC parameters. Credit/phase-out RATES are statutory (§32(b)(1) '
 'table) and unchanged. earnedAmount, maxCredit, phaseoutStart and '
 'phaseoutStartMfj are Rev. Proc. 2023-34 §3.06(1); investmentIncomeLimit is '
 '§32(i) per Rev. Proc. 2023-34 §3.06(2) — "$11,600". The Rev. Proc. also '
 'prints completed-phaseout amounts (18,591 / 49,084 / 55,768 / 59,899 and '
 'MFJ 25,511 / 56,004 / 62,688 / 66,819); they are derivable from the figures '
 'stored here and are not duplicated.'),

-- ══ SOCIAL SECURITY TAXABILITY — §86(c). NOT indexed. ══════════════════
(2024, 'ss_base_single', '25000'::jsonb,
 'SS taxability base threshold: Single/HOH/QSS. §86(c)(1)(A). Fixed in 1983 '
 'and never indexed — identical to TY2025 by law, not by inheritance.'),
(2024, 'ss_base_mfj', '32000'::jsonb,
 'SS taxability base threshold: MFJ. §86(c)(1)(B). Not indexed.'),
(2024, 'ss_adj_single', '34000'::jsonb,
 'SS taxability adjusted base threshold: Single/HOH/QSS. §86(c)(2)(A). Not '
 'indexed.'),
(2024, 'ss_adj_mfj', '44000'::jsonb,
 'SS taxability adjusted base threshold: MFJ. §86(c)(2)(B). Not indexed.'),

-- ══ NIIT — §1411(b). NOT indexed. ══════════════════════════════════════
(2024, 'niit_threshold_single', '200000'::jsonb,
 'Net Investment Income Tax MAGI threshold: Single/HOH. §1411(b)(3). Fixed '
 'by statute, not indexed.'),
(2024, 'niit_threshold_mfj', '250000'::jsonb,
 'NIIT MAGI threshold: MFJ/QSS. §1411(b)(1). Not indexed.'),
(2024, 'niit_threshold_mfs', '125000'::jsonb,
 'NIIT MAGI threshold: MFS. §1411(b)(2). Not indexed.'),

-- ══ ADDITIONAL MEDICARE TAX — §3101(b)(2). NOT indexed. ════════════════
(2024, 'addl_medicare_threshold_single', '200000'::jsonb,
 'Additional Medicare Tax wage threshold: Single/HOH/QSS. §3101(b)(2)(C). '
 'Not indexed.'),
(2024, 'addl_medicare_threshold_mfj', '250000'::jsonb,
 'Additional Medicare Tax wage threshold: MFJ. §3101(b)(2)(A). Not indexed.'),
(2024, 'addl_medicare_threshold_mfs', '125000'::jsonb,
 'Additional Medicare Tax wage threshold: MFS. §3101(b)(2)(B). Not indexed.'),

-- ══ CAPITAL LOSS — §1211(b). NOT indexed. ══════════════════════════════
(2024, 'capital_loss_limit', '3000'::jsonb,
 'IRC §1211(b)(1) net capital loss deduction cap. Excess carries forward. '
 'Fixed by statute since 1978, not indexed.'),
(2024, 'capital_loss_limit_mfs', '1500'::jsonb,
 'IRC §1211(b) cap, married filing separately. Not indexed.'),

-- ══ ADJUSTMENTS TO INCOME ══════════════════════════════════════════════
(2024, 'student_loan_interest_max', '2500'::jsonb,
 'Student loan interest deduction cap. §221(b)(1). Fixed by statute, not '
 'indexed; only the MAGI phase-out range moves.'),
(2024, 'student_loan_phaseout_single', '[80000, 95000]'::jsonb,
 'Student loan interest MAGI phase-out range, Single/HOH/QSS. §221(b)(2)(B); '
 'Rev. Proc. 2023-34 §3.30 — begins over $80,000, complete at $95,000.'),
(2024, 'student_loan_phaseout_mfj', '[165000, 195000]'::jsonb,
 'Student loan interest MAGI phase-out range, MFJ. §221(b)(2)(B); Rev. Proc. '
 '2023-34 §3.30 — begins over $165,000, complete at $195,000.'),
(2024, 'educator_expense_cap', '300'::jsonb,
 'Educator expenses deduction cap per eligible educator. §62(a)(2)(D); '
 'Rev. Proc. 2023-34 §3.13 — "$300".'),
(2024, 'educator_expense_cap_mfj', '600'::jsonb,
 'Educator cap when BOTH spouses are eligible educators (MFJ). Twice the '
 'per-educator §62(a)(2)(D) cap; each spouse is still limited to $300.'),

-- ══ SCHEDULE A ═════════════════════════════════════════════════════════
(2024, 'medical_agi_floor_pct', '0.075'::jsonb,
 'IRC §213(a): medical expenses deductible only above this fraction of AGI. '
 '7.5% is permanent (Consolidated Appropriations Act, 2021 §101).'),
(2024, 'medical_mileage_rate', '0.21'::jsonb,
 'Standard mileage rate for medical care under §213. Notice 2024-08 §3 — '
 '"21 cents per mile". Coincidentally equal to the 2025 rate; both were read '
 'from their own year''s notice.'),
(2024, 'charitable_mileage_rate', '0.14'::jsonb,
 'IRC §170(i): statutory charitable mileage rate. Fixed by statute, not '
 'indexed, so unchanged since 1998. Notice 2024-08 §3 restates it.'),
(2024, 'salt_cap', '10000'::jsonb,
 'IRC §164(b)(6) as enacted by the TCJA: state and local tax deduction cap, '
 '$10,000 for TY2018-TY2024, all statuses except MFS. FLAT — there is no '
 'phase-down for 2024. The $40,000 cap and the 30%-of-excess phase-down are '
 'both OBBBA §70120 and apply from TY2025, which is why the five '
 'salt_phaseout_* keys exist for 2025 and are deliberately absent here.'),
(2024, 'salt_cap_mfs', '5000'::jsonb,
 'SALT cap, married filing separately — half the general cap. '
 '§164(b)(6)(B).'),

-- ══ MISC ═══════════════════════════════════════════════════════════════
(2024, 'hsa_contribution_cap', '8300'::jsonb,
 'HSA family-coverage contribution cap for calendar 2024. §223(b)(2)(B); '
 'Rev. Proc. 2023-23 §2.01(1). Used only as an absurdity ceiling on an '
 'entered figure, never to compute a deduction. (Self-only is $4,150.)'),
(2024, 'epc_amount', '3'::jsonb,
 'Presidential Election Campaign Fund designation. §6096(a). $3 since 1994.')

on conflict (tax_year, key) do update
  set value = excluded.value,
      notes = excluded.notes;

-- ── Remove any TY2025-only key that should not exist for 2024 ──────────
-- Defensive: if a future "copy 2025 to 2024" ever runs, this migration is
-- the thing that un-does it. Listing them explicitly also documents the set.
delete from form_1040_constants
 where tax_year = 2024
   and key in (
     -- Schedule 1-A (OBBBA, TY2025-forward)
     'tips_deduction_cap', 'tips_overtime_phaseout_per_1000',
     'tips_overtime_phaseout_start', 'tips_overtime_phaseout_start_mfj',
     'overtime_deduction_cap', 'overtime_deduction_cap_mfj',
     'qpvli_deduction_cap', 'qpvli_phaseout_per_1000',
     'qpvli_phaseout_start', 'qpvli_phaseout_start_mfj',
     'senior_deduction_max', 'senior_deduction_phaseout_rate',
     'senior_deduction_phaseout_start', 'senior_deduction_phaseout_start_mfj',
     -- SALT phase-down (OBBBA §70120, TY2025-forward)
     'salt_phaseout_start', 'salt_phaseout_start_mfs', 'salt_phaseout_rate',
     'salt_phaseout_floor', 'salt_phaseout_floor_mfs'
   );

-- ── Report ────────────────────────────────────────────────────────────
select key, value::text as value, left(notes, 60) as notes
  from form_1040_constants
 where tax_year = 2024
 order by key;

commit;
