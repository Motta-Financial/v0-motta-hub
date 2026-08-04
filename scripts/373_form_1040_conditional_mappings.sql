-- 373: per-value conditional mappings in form_1040_proconnect_map.
--
-- ─── WHY ─────────────────────────────────────────────────────────────
-- Two mapping families cannot be expressed as a bare cell tuple:
--
--   (1) 1099-R routing. s14 is the repeating 1099-R screen (p1/p2/… are
--       payer instances; c3 = gross, c4 = taxable). Whether an instance
--       feeds 4a/4b (IRA) or 5a/5b (pension) depends on that instance's
--       IRA/SEP/SIMPLE checkbox: s14/c2, catalog-confirmed
--       "(7) IRA/SEP/SIMPLE" (val '1' when checked, cell ABSENT when
--       not — verified on sentinel return de74b2b2-…: p1 carries c2='1',
--       p2 has no c2 cell). The scripts/368 mappings hard-coded p1=IRA /
--       p2=pension, which misroutes any client whose first 1099-R is a
--       pension.
--
--   (2) Filing status. ONE coded cell s1/p0/c1000100036/x1000
--       (catalog-confirmed "Filing Status", Client Information screen;
--       1=Single 2=MFJ 3=MFS 4=HOH 5=QSS) fans out to five boolean
--       lines fs_single/fs_mfj/fs_mfs/fs_hoh/fs_qss. Their rows have
--       sat unmapped since scripts/370 pending exactly this mechanism.
--       lib/forms/form-1040-estimates.ts reads the same cell directly
--       (FS_CELL) and is unaffected.
--
-- ─── THE MECHANISM (lib/forms/form-1040.ts) ──────────────────────────
-- New column `condition jsonb`, two shapes distinguished by `cell`:
--
--   * {"cell": {"codeId": "c2"}, "equals": "1"} — INSTANCE GATE: the
--     mapping only reads cells whose sibling cell (same series + prefix,
--     cell.codeId, suffix defaulting to x1000) matches. "notEquals"
--     matches when the sibling is absent or different, so an unchecked
--     checkbox (= absent cell) passes notEquals. Composes with the
--     scripts/367 prefix_id '*' aggregation: gate each instance first,
--     then sum the survivors — multiple IRAs sum into 4a, multiple
--     pensions into 5a.
--
--   * {"equals": "4"} (no "cell") — VALUE PREDICATE: the line renders
--     the boolean result of comparing the mapped cell's own value, so
--     five boolean lines can share one coded cell.
--
-- composeImportEntries never emits condition artifacts: gate-conditioned
-- mappings are render-only (the sibling state on a write target is
-- unverifiable), and value predicates resolve to writing condition.equals
-- when the line is true (skipped when false/empty).

begin;

alter table form_1040_proconnect_map
  add column if not exists condition jsonb;

comment on column form_1040_proconnect_map.condition is
  'Per-value conditional (scripts/373). {"cell":{"codeId":"cN"},"equals"/"notEquals":"X"} '
  '= instance gate evaluated against a sibling cell on the same series/prefix '
  '(absent sibling compares as null, so notEquals passes for unchecked '
  'checkboxes); {"equals":"X"} without "cell" = value predicate — the line '
  'renders boolean (mapped cell value == X). Interpreted by '
  'lib/forms/form-1040.ts on both render and compose sides.';

-- ── (1) 1099-R: route by the per-instance IRA/SEP/SIMPLE checkbox ─────
update form_1040_proconnect_map
   set prefix_id = '*',
       condition = '{"cell": {"codeId": "c2"}, "equals": "1"}'::jsonb,
       notes = '1099-R ' || case when line_code = '4a' then 'gross' else 'taxable' end
               || ' (s14/' || code_id || '), IRA instances only: gated on the '
               'per-instance IRA/SEP/SIMPLE checkbox s14/c2 (catalog "(7) '
               'IRA/SEP/SIMPLE"; val 1 when checked). prefix ''*'' sums every '
               'instance that passes the gate. Replaces the scripts/368 '
               'hard-coded p1 tuple (wrong when the first 1099-R is a pension).'
 where tax_year = 2025 and return_type = 'IND'
   and line_code in ('4a', '4b')
   and series_id = 's14';

update form_1040_proconnect_map
   set prefix_id = '*',
       condition = '{"cell": {"codeId": "c2"}, "notEquals": "1"}'::jsonb,
       notes = '1099-R ' || case when line_code = '5a' then 'gross' else 'taxable' end
               || ' (s14/' || code_id || '), pension (non-IRA) instances only: '
               'gated on s14/c2 notEquals 1 — the checkbox cell is ABSENT when '
               'unchecked, and notEquals matches absent. prefix ''*'' sums every '
               'instance that passes the gate. Replaces the scripts/368 '
               'hard-coded p2 tuple.'
 where tax_year = 2025 and return_type = 'IND'
   and line_code in ('5a', '5b')
   and series_id = 's14';

-- ── (2) Filing status: five boolean lines over one coded cell ─────────
-- Codes 2 (MFJ) and 4 (HOH) were observed on the sentinel return
-- (confirmed); 1/3/5 follow Intuit's documented decode but have not been
-- observed on a real export yet (inferred).
update form_1040_proconnect_map m
   set series_id = 's1',
       prefix_id = 'p0',
       code_id    = 'c1000100036',
       suffix_id  = 'x1000',
       cell_field = 'val',
       condition  = jsonb_build_object('equals', v.code),
       confidence = v.confidence,
       discovered_at = coalesce(m.discovered_at, now()),
       notes = 'Filing status coded cell s1/p0/c1000100036/x1000 (catalog '
               '"Filing Status", Client Information screen): 1=Single 2=MFJ '
               '3=MFS 4=HOH 5=QSS. Value-predicate condition — line renders '
               'true when the cell equals ' || v.code || '. Discovered '
               '2026-07-30 on sentinel de74b2b2; mapped via scripts/373 '
               'conditional mechanism. form-1040-estimates.ts reads the same '
               'cell directly (FS_CELL).'
  from (values
          ('fs_single', '1', 'inferred'),
          ('fs_mfj',    '2', 'confirmed'),
          ('fs_mfs',    '3', 'inferred'),
          ('fs_hoh',    '4', 'confirmed'),
          ('fs_qss',    '5', 'inferred')
       ) as v(line_code, code, confidence)
 where m.tax_year = 2025 and m.return_type = 'IND'
   and m.line_code = v.line_code;

-- Expose the condition on the coverage view (appended column — safe for
-- CREATE OR REPLACE).
create or replace view form_1040_lines_with_map as
select
  l.id,
  l.tax_year,
  l.line_code,
  l.parent_code,
  l.ordinal,
  l.section,
  l.label,
  l.short_label,
  l.data_type,
  l.enum_options,
  l.is_computed,
  l.computation,
  l.schedule_ref,
  l.worksheet_ref,
  l.attaches_form,
  l.notes,
  m.return_type,
  m.series_id,
  m.prefix_id,
  m.code_id,
  m.suffix_id,
  m.cell_field,
  m.confidence,
  m.discovered_at,
  m.condition
from form_1040_lines l
left join form_1040_proconnect_map m
  on m.tax_year = l.tax_year
 and m.line_code = l.line_code;

commit;
