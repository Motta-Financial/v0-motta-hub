-- 401: give TY2024 its own 1040 layout and mappings, inherited from TY2025 and
-- labelled as inherited — so a 2024 return stops rendering as a 2025 form.
--
-- ═══ THE BUG ═════════════════════════════════════════════════════════
--
-- form_1040_lines / form_1040_proconnect_map / form_1040_constants /
-- proconnect_field_catalog contain TY2025 ONLY. The viewer hardcodes 2025
-- (app/api/forms/1040/[returnId]/route.ts, app/tax/returns/[returnId]/1040/
-- page.tsx, components/tax/form-1040-viewer.tsx all default taxYear = 2025).
--
-- So a TY2024 return was rendered against the TY2025 form and its header read
-- "Tax Year 2025". Measured on prod: a 2024 return resolves 38 of 51 mapped
-- lines, against 49 of 51 for 2025 — so values were both thinner AND presented
-- under the wrong year, with nothing on screen saying so. 10 TY2024 IND returns
-- and 1 TY2023 are affected.
--
-- ═══ WHAT THIS DOES, AND WHAT IT REFUSES TO DO ═══════════════════════
--
-- Every row here is INSERT ... SELECT from the TY2025 rows. No line inventory,
-- label or line number is transcribed by hand, because authoring an IRS form
-- layout from memory is exactly how you get a plausible, wrong 1040. Two
-- deltas are applied, and only two, because they are the two that are
-- unambiguous from the data already in the table:
--
--   13b  "Additional deductions from Schedule 1-A, line 38" — Schedule 1-A is
--        an OBBBA creation that exists for TY2025 and not for TY2024, and the
--        row says so in its own schedule_ref. Marked not_applicable, the same
--        way 12b ("2021 only") and 30 ("Reserved") already are.
--   14   TY2025 computes sum(12c, 13, 13b). With 13b gone the TY2024
--        computation is sum(12c, 13).
--
-- Everything else is inherited AS IS and is NOT claimed to be verified. In
-- particular `6d` (MFS-lived-apart) was added for the TY2025 Social Security
-- worksheet and I have NOT confirmed it belongs on the 2024 face. It is
-- inherited rather than silently dropped, and it is called out below so a
-- human checks it rather than discovering it on a client return.
--
-- CONSTANTS ARE DELIBERATELY NOT SEEDED. Standard deductions, brackets, EIC,
-- CTC and the SALT cap all differ for 2024, they come from Rev. Proc. 2023-34
-- and the 2024 instructions, and inventing them would produce a wrong tax on a
-- real client return. The existing gates already fail safe when a constant is
-- absent: lib/tax/intake/store.ts reads a missing `tax_brackets_verified` as
-- false and refuses to compute line 16, and constNum() in
-- lib/forms/form-1040-estimates.ts returns null so estimated lines simply do
-- not render. So for TY2024 the viewer shows what ProConnect actually
-- exported — which is real data — and reports computed lines as unavailable
-- instead of guessing. That is the correct behaviour until someone seeds 2024
-- constants against the IRS sources with citations, the way scripts/372 and
-- 377 did for 2025.
--
-- `layout_verified` is a new gate in the same spirit, seeded FALSE. While it
-- is false the 1040 viewer shows a banner saying the TY2024 layout is
-- inherited from TY2025 and its line numbers are unconfirmed. Set it true only
-- after checking the 2024 line inventory against the IRS 2024 Form 1040.
--
-- EDITABLE IS FORCED FALSE for every TY2024 mapping. scripts/387 derives
-- `editable` and skips its catalog gate when proconnect_field_catalog has no
-- rows for that (tax_year, return_type) — which is the case for 2024 — so
-- re-running it would mark these cells EDITABLE on the grounds that the
-- catalog is missing. That is backwards: no catalog plus an inherited,
-- unverified mapping is the weakest possible basis for authorising a live
-- write to a filed client return. Writes to TY2024 stay closed until there is
-- a 2024 catalog and confirmed mappings.
--
-- CONFIDENCE is downgraded to 'inferred'. These mappings were confirmed
-- against TY2025 returns, not 2024 ones. 38 of 51 do resolve on real 2024
-- returns, which is why inheriting is worth doing — but resolving is not the
-- same as being correct, and 'confirmed' should mean someone checked a filed
-- 2024 PDF.
--
-- Idempotent: deletes TY2024/1040 rows it owns, then re-inserts.

begin;

-- ── Guard: refuse to run if the TY2025 source is not what we expect ──
do $$
declare n_lines int; n_map int;
begin
  select count(*) into n_lines from form_1040_lines where tax_year = 2025 and form = '1040';
  select count(*) into n_map   from form_1040_proconnect_map
    where tax_year = 2025 and form = '1040' and return_type = 'IND';
  if n_lines = 0 or n_map = 0 then
    raise exception '401: TY2025 source rows missing (lines=%, map=%) — nothing to inherit from', n_lines, n_map;
  end if;
  raise notice '401: inheriting % lines and % mappings from TY2025', n_lines, n_map;
end $$;

-- ── (A) lines ────────────────────────────────────────────────────────
-- FK from the map points at lines, so clear the map first.
delete from form_1040_proconnect_map where tax_year = 2024 and form = '1040';
delete from form_1040_lines           where tax_year = 2024 and form = '1040';

insert into form_1040_lines (
  tax_year, form, line_code, parent_code, ordinal, section, label, short_label,
  data_type, enum_options, is_computed, computation, schedule_ref,
  worksheet_ref, attaches_form, is_refund_path, not_applicable, notes
)
select
  2024, l.form, l.line_code, l.parent_code, l.ordinal, l.section, l.label,
  l.short_label, l.data_type, l.enum_options, l.is_computed,
  -- Line 14 loses 13b along with Schedule 1-A.
  case when l.line_code = '14'
       then '{"kind": "sum", "operands": ["12c", "13"]}'::jsonb
       else l.computation end,
  l.schedule_ref, l.worksheet_ref, l.attaches_form, l.is_refund_path,
  -- Schedule 1-A does not exist for TY2024.
  case when l.line_code = '13b' then true else l.not_applicable end,
  case
    when l.line_code = '13b'
      then 'Not applicable for TY2024: Schedule 1-A was created by OBBBA for TY2025. '
           'Inherited from the TY2025 layout by scripts/401.'
    when l.line_code = '14'
      then 'TY2024 computation is 12c + 13; the 13b operand is TY2025-only. '
           'Inherited from the TY2025 layout by scripts/401.'
    when l.line_code = '6d'
      then 'UNVERIFIED for TY2024. Added for the TY2025 Social Security worksheet; '
           'whether it belongs on the 2024 face has not been checked. '
           'Inherited from the TY2025 layout by scripts/401.'
    else coalesce(l.notes || ' ', '') || 'Inherited from the TY2025 layout by scripts/401; line number and label not verified against the IRS 2024 Form 1040.'
  end
from form_1040_lines l
where l.tax_year = 2025 and l.form = '1040';

-- ── (B) mappings ─────────────────────────────────────────────────────
-- Skip lines that cannot hold a value for 2024 — nothing to map them to.
insert into form_1040_proconnect_map (
  tax_year, form, return_type, line_code, series_id, prefix_id, code_id,
  suffix_id, cell_field, cell_role, confidence, discovered_at, notes,
  condition, value_decode, editable, editable_basis
)
select
  2024, m.form, m.return_type, m.line_code, m.series_id, m.prefix_id,
  m.code_id, m.suffix_id, m.cell_field, m.cell_role,
  -- Confirmed against 2025 returns, not 2024 ones.
  case when m.confidence = 'confirmed' then 'inferred' else m.confidence end,
  m.discovered_at,
  coalesce(m.notes || ' ', '') ||
    'Inherited from the TY2025 mapping by scripts/401. ProConnect series/code '
    'numbering is largely stable year to year (38 of 51 mapped lines resolve '
    'on real TY2024 returns), but this pair has NOT been confirmed against a '
    'filed 2024 return.',
  m.condition, m.value_decode,
  -- See header: no 2024 catalog + inherited mapping = no writes.
  false,
  'not editable: TY2024 mapping inherited from TY2025 (scripts/401) with no '
  'proconnect_field_catalog loaded for 2024 — no validated field definition to '
  'pre-check a write against, and the mapping itself is unconfirmed for this year'
from form_1040_proconnect_map m
join form_1040_lines l2024
  on l2024.tax_year = 2024 and l2024.form = m.form and l2024.line_code = m.line_code
where m.tax_year = 2025 and m.form = '1040' and m.return_type = 'IND'
  and not l2024.not_applicable;

-- ── (C) the layout gate ──────────────────────────────────────────────
-- Same pattern as tax_brackets_verified / itemized_constants_verified: a
-- constant the UI reads, false until a human has checked.
insert into form_1040_constants (tax_year, key, value, notes)
values (
  2024, 'layout_verified', 'false'::jsonb,
  'GATE: false while the TY2024 line inventory is INHERITED from TY2025 '
  '(scripts/401) rather than checked against the IRS 2024 Form 1040. While '
  'false the 1040 viewer shows a banner telling the preparer the line numbers '
  'and labels are unconfirmed for this year. Set true only after verifying the '
  '2024 face — 6d in particular. Note this is about LAYOUT only: TY2024 '
  'constants (brackets, standard deduction, EIC, CTC, SALT) are deliberately '
  'NOT seeded, so tax_brackets_verified is absent and therefore false, and the '
  'Hub already refuses to compute line 16 for 2024.'
)
on conflict (tax_year, key) do update
  set value = excluded.value, notes = excluded.notes;

commit;

-- ── Verification ─────────────────────────────────────────────────────
-- 1. Row parity with 2025, minus the not-applicable lines.
select tax_year, count(*) filter (where not not_applicable) as usable_lines, count(*) as total
from form_1040_lines where form = '1040' group by tax_year order by tax_year;

select tax_year, count(*) as mappings, count(series_id) as with_series,
       sum(case when editable then 1 else 0 end) as editable
from form_1040_proconnect_map where form = '1040' and return_type = 'IND'
group by tax_year order by tax_year;

-- 2. 13b must be inert for 2024 and live for 2025.
select tax_year, line_code, not_applicable, computation::text
from form_1040_lines where form='1040' and line_code in ('13b','14') order by tax_year, line_code;

-- 3. No TY2024 mapping may be editable.
select count(*) as editable_ty2024_must_be_zero
from form_1040_proconnect_map where tax_year = 2024 and editable;

-- 4. The gates that keep the estimator quiet for 2024.
select key, value from form_1040_constants
where tax_year = 2024 and key in ('layout_verified','tax_brackets_verified');
