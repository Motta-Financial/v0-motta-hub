-- 389: render EVERY dependent, not just the first.
--
-- ─── WHY ─────────────────────────────────────────────────────────────
-- dep_name / dep_ssn / dep_rel / dep_ctc were pinned to s2/**p1** — the
-- FIRST dependent on the repeating Dependents screen. Live data uses
-- p1/p2/p3, so on a return with two or three dependents the Hub showed
-- one and silently dropped the rest. Measured on the book when this was
-- written: 15 returns carry dependents, 8 of them more than one, and
-- 11 dependent rows were being discarded with nothing to indicate it.
--
-- This is the same failure mode as the missing spouse (scripts/379):
-- a reviewer sees a plausible-looking value and has no way to know the
-- page is incomplete. It is worse here, because a dropped dependent is
-- also a dropped credit.
--
-- ─── THE MECHANISM ───────────────────────────────────────────────────
-- prefix_id '*' (AGGREGATE_PREFIX, scripts/367) already means "this cell
-- at ANY prefix instance". Until now the renderer summed those instances
-- for currency/integer lines and kept only the lowest-numbered instance
-- for anything else. Every '*' mapping in the table was currency, so the
-- non-numeric branch was dead code.
--
-- lib/forms/form-1040.ts now collects EVERY occurrence of a non-numeric
-- aggregate into `instances[]`, ordered by prefix. `value` still mirrors
-- instances[0], so scalar consumers (composer, estimator, computed-line
-- operands) are untouched — the change is purely additive.
--
-- ─── WHAT THIS COSTS ─────────────────────────────────────────────────
-- Nothing in the write path. scripts/387 derives editable=false for '*'
-- aggregates (there is no single cell to write a cross-instance value
-- to), so these five lines flip to read-only in the 1040 viewer. That
-- removes no capability: dependent fields are edited on the raw-cell
-- browser (/tax/returns/[returnId] → FieldEditSheet), which addresses
-- cells by their own series/prefix/code/suffix and never consults these
-- mappings. Editing dependent 1 while dependents 2 and 3 were invisible
-- was the more dangerous arrangement.
--
-- Re-run the derivation after applying this:
--   node --env-file=.env.local scripts/387-run-mapping-key-and-editable.mjs --apply
--
-- ─── dep_name WAS ONLY EVER THE FIRST NAME ───────────────────────────
-- It is labelled "Dependent name (first, last)" but maps to
-- c1000200008, which the catalog calls "First Name". The last name is a
-- separate code, c1000200009, populated on all 15 dependent-bearing
-- returns and never mapped. So the label promised a full name and the
-- data delivered half of one. Split into dep_name + dep_last.
-- ---------------------------------------------------------------------

begin;

-- ── Dependent last name: new line + mapping ───────────────────────────
insert into form_1040_lines
  (tax_year, form, line_code, parent_code, ordinal, section, label, short_label, data_type, is_computed, notes)
values
  (2025, '1040', 'dep_last', 'dependents', 505, 'dependents', 'Dependent last name', 'Last', 'text', false,
   'Catalog "Last Name" (s2/c1000200009). Split from dep_name, which maps to c1000200008 = FIRST name only.')
on conflict (tax_year, form, line_code) do update set
  parent_code = excluded.parent_code,
  ordinal     = excluded.ordinal,
  section     = excluded.section,
  label       = excluded.label,
  short_label = excluded.short_label,
  data_type   = excluded.data_type,
  notes       = excluded.notes;

-- dep_name is the FIRST name; say so rather than promising both.
update form_1040_lines
   set label = 'Dependent first name',
       short_label = 'First',
       notes = 'Catalog "First Name" (s2/c1000200008). The last name is dep_last (c1000200009).'
 where tax_year = 2025 and form = '1040' and line_code = 'dep_name';

-- ── Every dependent field reads ALL instances ─────────────────────────
-- cell_key is GENERATED from (series, prefix, code, suffix), so updating
-- prefix_id re-derives it; supply the parts, never the key.
update form_1040_proconnect_map
   set prefix_id = '*',
       notes = coalesce(notes || ' ', '')
               || 'prefix ''*'' (scripts/389): reads every dependent instance '
               || '(s2 p1/p2/p3 = first/second/third dependent), not just p1. '
               || 'Render-only by construction — a cross-instance value has no '
               || 'single cell to write back to; edit dependents on the raw-cell browser.'
 where tax_year = 2025
   and return_type = 'IND'
   and form = '1040'
   and line_code in ('dep_name', 'dep_ssn', 'dep_rel', 'dep_ctc')
   and series_id = 's2';

insert into form_1040_proconnect_map
  (tax_year, form, line_code, return_type, series_id, prefix_id, code_id, suffix_id, cell_field, cell_role, confidence, notes)
values
  (2025, '1040', 'dep_last', 'IND', 's2', '*', 'c1000200009', 'x1000', 'desc', 'primary', 'confirmed',
   'Catalog "Last Name", Dependents screen. Populated on all 15 dependent-bearing returns in the book. '
   'prefix ''*'' reads every dependent instance.')
on conflict (tax_year, return_type, form, line_code, cell_key) do update set
  cell_field = excluded.cell_field,
  cell_role  = excluded.cell_role,
  confidence = excluded.confidence,
  notes      = excluded.notes;

-- ── Audit trail must name WHICH dependent was revealed ────────────────
-- dep_ssn is sensitive and now has one value per dependent. A reveal log
-- that records only the line code cannot answer "whose SSN was shown",
-- which is the question the log exists for.
alter table sensitive_field_access_log
  add column if not exists instance_prefix text;

comment on column sensitive_field_access_log.instance_prefix is
  'ProConnect prefix of the occurrence revealed on a repeating line '
  '(e.g. ''p2'' = second dependent for dep_ssn). NULL for scalar lines. '
  'Added scripts/389.';

commit;
