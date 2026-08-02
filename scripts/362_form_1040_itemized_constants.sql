-- 362: TY2025 constants required by the 1099-INT / 1099-DIV / 1099-R /
-- Schedule A intake slices.
--
-- Everything here follows the same fail-closed convention established by
-- `tax_brackets_verified` in migration 360: the figures are seeded from
-- published guidance, but a GATE key starts false and the compute engine
-- refuses to produce the dependent lines until a human has checked them.
-- A wrong SALT cap silently changes whether a real client itemizes.
--
-- Idempotent: safe to re-run.

insert into form_1040_constants (tax_year, key, value, notes) values

-- ── Gate ────────────────────────────────────────────────────────────────
(2025, 'itemized_constants_verified', 'false'::jsonb,
 'GATE: set true ONLY after checking every itemized-deduction constant below '
 'against the final IRS Schedule A instructions for TY2025 and P.L. 119-21 '
 '(OBBBA) §70120. While false, the Hub refuses to compute Form 1040 line 12 '
 'whenever a Schedule A is present, and reports it as unavailable rather '
 'than displaying a plausible but unverified deduction. The SALT cap in '
 'particular changed for 2025 and its phase-down is easy to get wrong.'),

-- ── Medical (Schedule A lines 1-4) ──────────────────────────────────────
(2025, 'medical_agi_floor_pct', '0.075'::jsonb,
 'IRC §213(a): medical expenses deductible only to the extent they exceed '
 'this fraction of AGI. 7.5% is permanent (Consolidated Appropriations Act, '
 '2021 §101).'),

-- ── State and local taxes (Schedule A line 5e) ──────────────────────────
(2025, 'salt_cap', '40000'::jsonb,
 'IRC §164(b)(6) as amended by OBBBA §70120: SALT deduction cap for TY2025 '
 'for all statuses except MFS. Was $10,000 through TY2024.'),
(2025, 'salt_cap_mfs', '20000'::jsonb,
 'SALT cap, married filing separately (half the general cap).'),
(2025, 'salt_phaseout_start', '500000'::jsonb,
 'MAGI at which the SALT cap begins to phase down.'),
(2025, 'salt_phaseout_start_mfs', '250000'::jsonb,
 'MAGI at which the SALT cap begins to phase down, MFS.'),
(2025, 'salt_phaseout_rate', '0.30'::jsonb,
 'The cap is reduced by this fraction of MAGI above the phase-out start.'),
(2025, 'salt_phaseout_floor', '10000'::jsonb,
 'The phase-down never reduces the cap below this amount.'),
(2025, 'salt_phaseout_floor_mfs', '5000'::jsonb,
 'Phase-down floor, married filing separately.'),

-- ── Charitable (Schedule A lines 11-14) ─────────────────────────────────
(2025, 'charitable_mileage_rate', '0.14'::jsonb,
 'IRC §170(i): statutory charitable mileage rate. Fixed by statute, not '
 'indexed, so unchanged since 1998.'),

-- ── Preferential rates ──────────────────────────────────────────────────
-- Deliberately NOT seeded as thresholds. Qualified dividends and net
-- capital gain require the Qualified Dividends and Capital Gain Tax
-- Worksheet, which this engine does not implement; it reports line 16 as
-- unavailable instead. This key exists so the reason is discoverable in
-- the same table a preparer would look in.
(2025, 'qdcg_worksheet_implemented', 'false'::jsonb,
 'The Qualified Dividends and Capital Gain Tax Worksheet is not implemented '
 'in the Hub preview. When qualified dividends or net capital gain are '
 'present, Form 1040 line 16 is reported as unavailable rather than taxed at '
 'ordinary rates, which would overstate the tax. ProConnect computes it.')

on conflict (tax_year, key) do update
  set value = excluded.value,
      notes = excluded.notes
  -- Never re-arm a gate a human has already cleared.
  where form_1040_constants.key not in
        ('itemized_constants_verified', 'qdcg_worksheet_implemented');
