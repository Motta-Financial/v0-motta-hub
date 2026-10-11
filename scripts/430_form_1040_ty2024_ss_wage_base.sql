-- 430: TY2024 Social Security wage base.
--
-- Line 31 (Schedule 3 line 11, excess social security withheld) caps each
-- person's OASDI withholding at rate x wage base, so it reads
-- `se_ss_wage_base` and stays blank without it. scripts/411 seeded no SE keys
-- for 2024, which is why line 31 is unavailable on TY2024 returns.
--
-- Only this one key is added. The Schedule C self-employment stage needs ALL
-- of se_net_earnings_pct / se_ss_rate / se_medicare_rate / se_ss_wage_base /
-- se_minimum_net_earnings / se_deduction_pct and fails closed when any is
-- missing, so seeding the wage base alone does not switch SE tax on for 2024.
--
-- Source: SSA, "2024 Social Security Changes" fact sheet (release
-- 2023-10-12): maximum taxable earnings $168,600. Employee max = 6.2% x
-- 168,600 = 10,453.20.

begin;

insert into form_1040_constants (tax_year, key, value, notes) values
(2024, 'se_ss_wage_base', '168600'::jsonb,
 '2024 Social Security wage base (SSA 2024 fact sheet, release 2023-10-12). Read by line 31 excess social security; the SE tax stage also needs the other se_* keys, which are deliberately absent for 2024.')
on conflict (tax_year, key) do update
  set value = excluded.value,
      notes = excluded.notes;

select tax_year, key, value::text from form_1040_constants
 where key = 'se_ss_wage_base' order by tax_year;

commit;
