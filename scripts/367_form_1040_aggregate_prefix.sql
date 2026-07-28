-- 367: aggregate ("*") prefix for repeated-form mappings in
--      form_1040_proconnect_map.
--
-- ─── WHY ─────────────────────────────────────────────────────────────
-- On repeating input screens the prefix is the instance number: series
-- s11 is the W-2 screen and p1/p2/p3 are the first/second/third W-2.
-- The 1a and 25a mappings pointed at s11/p1/…, which reads only the
-- FIRST W-2 — a three-W-2 return understated wages and withholding.
--
-- ─── THE MECHANISM ───────────────────────────────────────────────────
-- prefix_id = '*' means "every prefix instance of this series/code".
-- lib/forms/form-1040.ts interprets it on both sides:
--   * renderForm1040 sums the mapped cell_field across all prefixes for
--     currency/integer lines (non-numeric lines fall back to the lowest
--     instance).
--   * composeImportEntries excludes '*' mappings entirely — a
--     cross-instance total has no single writable cell, and '*' is not a
--     real ProConnect prefix, so it must never reach the Import API.
--     buildEntry refuses them independently as a second guard.
-- No schema change: prefix_id is already text and the tuple stays
-- self-describing.
--
-- Verified against real snapshot data (2026-07-29):
--   return 2475868e-adc2-4b9c-875c-ef4a3143a179: W-2s at p1/p2/p3,
--     1a = 94987+164+4181 = 99332, 25a = 15294+122+553 = 15969
--   return 41d910c6-5b35-44e1-b01b-ea68cf928fe0: three W-2s,
--     1a = 41323+41959+127142 = 210424, 25a = 3693+3807+10151 = 17651
--
-- Idempotent: safe to re-run; only touches the two W-2-sourced lines and
-- only while they still point at a single concrete instance.

begin;

update form_1040_proconnect_map
set prefix_id = '*',
    notes = 'Aggregate mapping: s11 is the repeating W-2 screen and the '
            'prefix is the instance number (p1 = first W-2). prefix_id '
            '''*'' tells renderForm1040 to SUM this cell across every '
            'instance; composeImportEntries never writes it (a total has '
            'no single cell, and ''*'' is not a real prefix). Verified '
            'against multi-W-2 exports 2026-07-29.'
where tax_year = 2025
  and return_type = 'IND'
  and line_code in ('1a', '25a')
  and series_id = 's11'
  and prefix_id ~ '^p\d+$';

commit;
