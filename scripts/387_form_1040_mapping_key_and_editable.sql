-- 387: form-agnostic mapping key + per-cell `editable` flag.
--
-- ═══ NUMBERING: 387 IS USED TWICE — deliberately left that way ════════
-- `scripts/387_intake_booking_nudge.sql` (PR #335) also claims 387 and
-- landed first. Both are applied to prod. Not renamed, because:
--   * the two touch disjoint tables (form_1040_* here, intake/booking
--     there), so relative order between them is meaningless; and
--   * scripts/386-run-schedule-1a-senior-deduction.mjs has a hard
--     PREFLIGHT that refuses to run unless "387" — this file — is applied,
--     and scripts/386_form_1040_ty2025_schedule_1a_senior_deduction.sql
--     cites 387 for the generated cell_key. Renumbering would break a
--     dependency that a parallel workstream already shipped.
-- If you are replaying migrations in order, run either 387 first; the
-- outcome is identical.
--
-- Two changes, one migration, because they touch the same table and there
-- is no reason to rewrite form_1040_proconnect_map twice.
--
-- ═══ (B) KEY ON (tax_year, form, line, cell) ═════════════════════════
--
-- WHY — two independent reasons:
--
--   1. The 1040 changes every year. Line numbers and box layout shift
--      between tax years, so the map has to be versioned config the UI
--      renders from, not a layout baked into code. The table was already
--      tax_year-scoped; what it was missing is `form`.
--
--   2. API scope today is 1040-only, but the 1040-series schedules are an
--      ongoing goal. The good news, on inspection: this schema was never
--      1040-SHAPED. There are no `line_1a` columns — it has always been
--      row-per-line with the line code as data. So going form-agnostic is
--      one column, not a rewrite, and adding Schedule D later is a data
--      load exactly as intended.
--
-- WHAT CHANGES — the old key was (tax_year, line_code, return_type): one
-- row per line, therefore ONE cell per line. That is the real limit. A
-- line can legitimately need several cells:
--
--     * line 8 "other income" is the total of a ProConnect detail grid
--       (s200M/c11) whose rows are enumerated by SUFFIX — x1000, x1001,
--       … — each row carrying its own amount in `val` and its source
--       label in `desc`. Reading only x1000 sees one row of several.
--     * any future drill-down ("expand line 8, show me where it came
--       from") is N cells against one line by construction.
--
-- So the key becomes literally (tax_year, form, line_code, cell) with
-- `cell` materialized as the generated `cell_key` column. `return_type`
-- stays in the key and is NOT the same axis as `form`: return_type is the
-- ProConnect MODULE (IND/COR/PAR/…), form is the artifact within it
-- (1040, Schedule 1, Schedule D). A 1040 and a Schedule D are both IND.
--
-- `cell_role` distinguishes several cells on one line without joining the
-- catalog. It reuses the taxonomy already established by
-- scripts/360 form_1040_line_inputs.role, plus 'detail':
--   primary        the cell whose value IS the line (the default)
--   detail         one row of an expansion grid behind a primary total
--   override       an [Override] field that displaces a computation
--   discriminator  routes a value to one line vs another (s14/c2)
--   control        changes which branch computes
--
-- ═══ (C) `editable` PER MAPPED CELL ══════════════════════════════════
--
-- WHY — the tax team only ever adds or edits RAW ENTRY data; ProConnect's
-- software does all the totaling. So the fields that matter for editing
-- are the individual input boxes, never the computed sums, and a UI that
-- offers a pencil on a total is offering a mistake.
--
-- This is a DATA rule, not a UI convention, for a reason beyond taste: it
-- matches what the API can actually do. Export returns only raw input
-- cells — never calculated values — so writing to a "calculated" cell is
-- meaningless in the first place. The flag just makes that legible.
--
-- DERIVATION (recomputed by the UPDATE below; never hand-set):
--   editable = false when ANY of:
--     * no mapping at all (series_id/code_id NULL) — nothing to write to
--     * prefix_id = '*'   — an aggregate across every instance of a
--       repeating screen. There is no single cell holding a W-2 wages
--       TOTAL; you edit one W-2. composeImportEntries already refuses.
--     * condition->'cell' present — instance-gated. Whether the write
--       target satisfies the sibling condition is unverifiable from here.
--       composeImportEntries already refuses.
--     * cell_role in ('detail','discriminator','control')
--     * the line is is_computed or not_applicable
--     * the (series, code) is absent from proconnect_field_catalog —
--       we have no validated field definition, no constraints to
--       pre-check against, and Import to an unknown code is a live write
--       to a real client return. This is what catches the M-series
--       detail-grid mappings (lines 1b, 1d, 6a, 6c, 8).
--   editable = true otherwise: a catalog-backed input cell at a concrete
--   prefix.
--
-- Note the result agrees with what composeImportEntries already refuses,
-- plus the catalog gate. That is the point — the same rule, expressed
-- once as data instead of scattered across render and compose.
--
-- This does NOT replace the post-e-file lock (tracked separately). Raw
-- inputs are exactly what must not change on an already-filed return;
-- `editable` says "this cell is writable in principle", not "writable
-- right now".
--
-- Idempotent — safe to re-run. Re-running also RE-DERIVES `editable`,
-- which is the intended way to refresh it after new mappings land.

begin;

-- ── (B1) form_1040_lines gains `form` ────────────────────────────────
alter table form_1040_lines
  add column if not exists form text not null default '1040';

comment on column form_1040_lines.form is
  'The IRS artifact this line appears on: 1040 | Schedule 1 | Schedule D | … '
  'Distinct from the ProConnect module (see proconnect_map.return_type) — a '
  '1040 and a Schedule D are both IND. Every line seeded before scripts/387 '
  'is on the 1040 face, hence the default.';

-- The FK on the map targets lines'' unique key, so it has to go first.
alter table form_1040_proconnect_map
  drop constraint if exists form_1040_pcmap_fk_line;

alter table form_1040_lines
  drop constraint if exists form_1040_lines_unique;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'form_1040_lines_uniq_form'
  ) then
    alter table form_1040_lines
      add constraint form_1040_lines_uniq_form unique (tax_year, form, line_code);
  end if;
end $$;

-- ── (B2) form_1040_proconnect_map: form + cell_role + cell_key ───────
alter table form_1040_proconnect_map
  add column if not exists form text not null default '1040';

alter table form_1040_proconnect_map
  add column if not exists cell_role text not null default 'primary';

alter table form_1040_proconnect_map
  drop constraint if exists form_1040_pcmap_cell_role_chk;
alter table form_1040_proconnect_map
  add constraint form_1040_pcmap_cell_role_chk
  check (cell_role in ('primary', 'detail', 'override', 'discriminator', 'control'));

-- `cell` as a single comparable value. Generated + STORED so it can carry
-- the primary key and serve as a PostgREST on_conflict target. Unmapped
-- rows all collapse to '///', so a line may hold at most one placeholder.
alter table form_1040_proconnect_map
  add column if not exists cell_key text
  generated always as (
    coalesce(series_id, '') || '/' || coalesce(prefix_id, '') || '/' ||
    coalesce(code_id, '')   || '/' || coalesce(suffix_id, '')
  ) stored;

comment on column form_1040_proconnect_map.cell_key is
  'The (series, prefix, code, suffix) tuple as one value — the "cell" half of '
  'the (tax_year, form, line, cell) key. Generated; never write it directly. '
  '''///'' means the line has a row but no discovered mapping yet.';

comment on column form_1040_proconnect_map.cell_role is
  'What this cell contributes to the line: primary (its value IS the line) | '
  'detail (one row of an expansion grid behind a primary total) | override | '
  'discriminator | control. Mirrors form_1040_line_inputs.role (scripts/360). '
  'Feeds the `editable` derivation.';

-- ── (B3) repoint the key ─────────────────────────────────────────────
alter table form_1040_proconnect_map
  drop constraint if exists form_1040_proconnect_map_pkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'form_1040_proconnect_map_pkey'
  ) then
    alter table form_1040_proconnect_map
      add constraint form_1040_proconnect_map_pkey
      primary key (tax_year, return_type, form, line_code, cell_key);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'form_1040_pcmap_fk_line'
  ) then
    alter table form_1040_proconnect_map
      add constraint form_1040_pcmap_fk_line
      foreign key (tax_year, form, line_code)
      references form_1040_lines (tax_year, form, line_code)
      on delete cascade;
  end if;
end $$;

-- Renderer/composer load by (tax_year, return_type, form).
create index if not exists form_1040_pcmap_form_idx
  on form_1040_proconnect_map (tax_year, return_type, form);

-- ── (C) the editable flag ────────────────────────────────────────────
alter table form_1040_proconnect_map
  add column if not exists editable boolean not null default false;

alter table form_1040_proconnect_map
  add column if not exists editable_basis text;

comment on column form_1040_proconnect_map.editable is
  'True when this cell is a raw ProConnect INPUT the tax team may write. '
  'DERIVED — recomputed by scripts/387; never hand-set. False for aggregates, '
  'instance-gated mappings, detail/discriminator/control roles, computed or '
  'N/A lines, and any cell with no proconnect_field_catalog definition. '
  'Says "writable in principle", NOT "writable right now" — the post-e-file '
  'lock is a separate gate.';

comment on column form_1040_proconnect_map.editable_basis is
  'Why `editable` holds its current value. Audit trail for the derivation, '
  'in the same spirit as `confidence` / `discovered_at`.';

-- The catalog is partner-confidential and loaded out-of-band
-- (scripts/358-load-proconnect-catalog.mjs), so it may be empty in a given
-- environment. Applying the catalog gate against an empty catalog would
-- silently mark everything non-editable. Fail LOUD instead of fail-quiet:
-- gate only where the catalog is actually populated for that
-- (tax_year, return_type), and record that in editable_basis.
with catalog_loaded as (
  select tax_year, return_type, count(*) > 0 as loaded
  from proconnect_field_catalog
  where agency = 'Federal'
  group by tax_year, return_type
)
update form_1040_proconnect_map m
   set editable = d.ok,
       editable_basis = d.basis
  from (
    select
      m2.tax_year, m2.return_type, m2.form, m2.line_code, m2.cell_key,
      (
        m2.series_id is not null and m2.code_id is not null
        and coalesce(m2.prefix_id, 'p0') <> '*'
        and m2.condition -> 'cell' is null
        and m2.cell_role in ('primary', 'override')
        and not coalesce(l.is_computed, false)
        and not coalesce(l.not_applicable, false)
        and (not coalesce(cl.loaded, false) or c.code_id is not null)
      ) as ok,
      case
        when m2.series_id is null or m2.code_id is null
          then 'not editable: line has no discovered mapping'
        when coalesce(m2.prefix_id, 'p0') = '*'
          then 'not editable: aggregate over every instance of a repeating screen — '
               'no single cell holds the total; edit the individual instance'
        when m2.condition -> 'cell' is not null
          then 'not editable: instance-gated mapping — the sibling condition on the '
               'write target cannot be verified, so a write could misroute'
        when m2.cell_role not in ('primary', 'override')
          then 'not editable: cell_role=' || m2.cell_role || ' is not a value-bearing input'
        when coalesce(l.is_computed, false)
          then 'not editable: ProConnect computes this line from the underlying entries'
        when coalesce(l.not_applicable, false)
          then 'not editable: line cannot hold a value this tax year'
        when coalesce(cl.loaded, false) and c.code_id is null
          then 'not editable: no proconnect_field_catalog definition for '
               || m2.series_id || '/' || m2.code_id || ' (M-series detail grid or '
               'undiscovered code) — no constraints to pre-validate a write against'
        when not coalesce(cl.loaded, false)
          then 'editable: raw input cell at a concrete prefix (catalog NOT loaded in '
               'this environment — catalog gate skipped, re-run scripts/387 after load)'
        else 'editable: catalog-backed raw input cell at a concrete prefix'
      end as basis
    from form_1040_proconnect_map m2
    left join form_1040_lines l
      on l.tax_year = m2.tax_year and l.form = m2.form and l.line_code = m2.line_code
    left join catalog_loaded cl
      on cl.tax_year = m2.tax_year and cl.return_type = m2.return_type
    left join proconnect_field_catalog c
      on c.tax_year = m2.tax_year and c.return_type = m2.return_type
     and c.agency = 'Federal'
     and c.series_id = m2.series_id and c.code_id = m2.code_id
  ) d
 where d.tax_year = m.tax_year and d.return_type = m.return_type
   and d.form = m.form and d.line_code = m.line_code and d.cell_key = m.cell_key;

-- ── Coverage view: expose form / cell_role / cell_key / editable ─────
-- DROP first, not CREATE OR REPLACE: replace can only append columns at
-- the end, and this revision inserts `form` after tax_year and
-- cell_role/cell_key alongside the other cell columns.
drop view if exists form_1040_lines_with_map;
create view form_1040_lines_with_map as
select
  l.id,
  l.tax_year,
  l.form,
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
  m.cell_role,
  m.cell_key,
  m.confidence,
  m.discovered_at,
  m.condition,
  m.value_decode,
  m.editable,
  m.editable_basis
from form_1040_lines l
left join form_1040_proconnect_map m
  on m.tax_year = l.tax_year
 and m.form = l.form
 and m.line_code = l.line_code;

commit;
