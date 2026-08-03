-- 363: seed form_1040_proconnect_map for TY2025.
--
-- ─── WHAT THIS TABLE MEANS ──────────────────────────────────────────
-- form_1040_proconnect_map answers ONE question per line: "which single
-- ProConnect cell holds this line's value?" It is the Export-side view.
-- form_1040_line_inputs (migration 360) answers the opposite, Import-side
-- question: "which fields FEED this line?" — and most lines are fed by
-- many, or by none.
--
-- Migration 140 set the rule for this table plainly: NULL until discovered
-- from a real export — never guessed. Export is still 403-blocked pending
-- Intuit provisioning, so nothing here is `confirmed`. What this migration
-- does instead is populate the table completely, so that every line is
-- either mapped-with-a-stated-basis or visibly unmapped-with-a-reason. A
-- half-populated table reads as "we haven't looked yet"; this one reads as
-- "we looked, and here is exactly what is known."
--
-- ─── NO INTUIT DATA IS EMBEDDED HERE ────────────────────────────────
-- Motta-Financial/v0-motta-hub is PUBLIC and the IVCS/FRF catalog is
-- partner-confidential under the Open API partner agreement. This file
-- contains no catalog rows, descriptions, or literal address tuples — it
-- DERIVES the mapping from form_1040_line_inputs, whose rows were applied
-- out-of-band (same discipline as scripts/358 and 360). Running it against
-- a database that has those rows reproduces the seed exactly; running it
-- against one that does not produces an all-unknown table, which is the
-- correct answer in that case.
--
-- ─── THE DERIVATION RULE ────────────────────────────────────────────
-- A line gets an address only when ALL of the following hold:
--   1. Exactly one contributing field carries the line's own value —
--      i.e. one `override` row, or (absent any override) exactly one
--      `input` row.
--   2. That field's code is not shared with another line. The 1099-R
--      codes fail this: 4a and 5a are BOTH s14/c3, separated only by the
--      s14/c2 IRA/SEP/SIMPLE discriminator. Writing "line 4a lives at
--      s14/c3" would be true half the time, which is worse than unmapped.
--   3. The source row is itself high-confidence. A medium-confidence
--      input is not a basis for asserting where a line's value lives.
--
-- Everything else stays NULL with a reason. Confidence is 'inferred'
-- throughout — derived from Intuit's own field descriptions, but assigning
-- a code to an IRS line number is an interpretive step and none of it has
-- been checked against a real Export.
--
-- Idempotent: safe to re-run. Re-running never downgrades a row a human
-- has since marked `confirmed`.

begin;

-- ── 1. A row for every TY2025 line, unmapped by default ─────────────
insert into form_1040_proconnect_map
  (tax_year, line_code, return_type, cell_field, confidence, notes)
select
  l.tax_year,
  l.line_code,
  'IND',
  'val',
  'unknown',
  'No single ProConnect cell holds this line. See form_1040_line_inputs '
  'for what feeds it.'
from form_1040_lines l
where l.tax_year = 2025
on conflict (tax_year, line_code, return_type) do nothing;

-- ── 2. Explain the unmapped lines, by category ──────────────────────
-- Pure arithmetic over other lines: ProConnect computes these, and so do
-- we (form_1040_lines.computation, evaluated by lib/forms/form-1040.ts).
update form_1040_proconnect_map m
set notes = 'Computed from other lines. ProConnect derives it; so does '
            'lib/forms/form-1040.ts from form_1040_lines.computation. '
            'There is no cell to read or write.'
from form_1040_line_inputs li
where m.tax_year = 2025 and m.return_type = 'IND'
  and li.tax_year = 2025 and li.line_code = m.line_code
  and li.source_kind = 'line_arithmetic'
  and m.confidence = 'unknown';

-- Tax-table and worksheet lookups: no input field exists at all.
update form_1040_proconnect_map m
set notes = 'Derived by a tax table or IRS worksheet, not entered. No '
            'ProConnect input field exists for it.'
from form_1040_line_inputs li
where m.tax_year = 2025 and m.return_type = 'IND'
  and li.tax_year = 2025 and li.line_code = m.line_code
  and li.source_kind = 'table_lookup'
  and m.confidence = 'unknown';

-- Multi-code rollups: the line sums an entire screen.
update form_1040_proconnect_map m
set notes = 'Rolls up from a schedule with many contributing codes. No '
            'single cell carries the total; see form_1040_line_inputs.'
where m.tax_year = 2025 and m.return_type = 'IND'
  and m.confidence = 'unknown'
  and exists (
    select 1 from form_1040_line_inputs li
    where li.tax_year = 2025 and li.line_code = m.line_code
      and li.series_id is not null and li.code_id is null
  );

-- Discriminator-routed lines. This is the important one to state out
-- loud: the same codes serve two different 1040 lines, and only a
-- checkbox decides which. Mapping either line to those codes would be
-- correct only for the half of returns that match.
update form_1040_proconnect_map m
set notes = 'Shares its ProConnect codes with another 1040 line; a '
            'discriminator field decides which line the amount lands on. '
            'Deliberately unmapped — an address that is right half the '
            'time is worse than none. See form_1040_line_inputs for the '
            'discriminator.'
where m.tax_year = 2025 and m.return_type = 'IND'
  and m.confidence = 'unknown'
  and exists (
    select 1
    from form_1040_line_inputs li
    join (
      select series_id, code_id
      from form_1040_line_inputs
      where tax_year = 2025 and code_id is not null
      group by 1, 2
      having count(distinct line_code) > 1
    ) sh on sh.series_id = li.series_id and sh.code_id = li.code_id
    where li.tax_year = 2025 and li.line_code = m.line_code
  );

-- ── 3. Map the lines that satisfy the derivation rule ───────────────
with shared_codes as (
  -- Codes that serve more than one line — rule 2.
  select series_id, code_id
  from form_1040_line_inputs
  where tax_year = 2025 and code_id is not null
  group by 1, 2
  having count(distinct line_code) > 1
),
candidates as (
  select
    li.line_code,
    li.agency,
    li.series_id,
    li.code_id,
    li.role,
    count(*) filter (where li.role = 'override')
      over (partition by li.line_code) as override_count,
    count(*) filter (where li.role in ('input', 'override'))
      over (partition by li.line_code) as valued_count
  from form_1040_line_inputs li
  where li.tax_year = 2025
    and li.code_id is not null
    and li.confidence = 'high'                       -- rule 3
    and not exists (                                 -- rule 2
      select 1 from shared_codes s
      where s.series_id = li.series_id and s.code_id = li.code_id
    )
),
resolved as (
  select line_code, agency, series_id, code_id
  from candidates
  where (role = 'override' and override_count = 1)   -- rule 1
     or (role = 'input' and override_count = 0 and valued_count = 1)
    -- EXCLUSION: line 13 resolves to the Schedule C "qualified business
    -- income (loss) [Override]". That override sets QBI for ONE business,
    -- not the §199A DEDUCTION that line 13 reports — they are different
    -- quantities and the deduction is computed from QBI, wages, and
    -- taxable income. The derivation rule cannot see that distinction, so
    -- it is excluded by hand.
    and line_code <> '13'
)
update form_1040_proconnect_map m
set series_id  = r.series_id,
    -- Prefix is instance-scoped and the catalog carries none. p0 is the
    -- first instance; for the lines mapped here (social security,
    -- itemized deductions, EIC) there is only ever one.
    prefix_id  = 'p0',
    code_id    = r.code_id,
    suffix_id  = 'x1000',
    cell_field = 'val',
    confidence = 'inferred',
    notes      = 'Derived from Intuit''s own field description via '
                 'form_1040_line_inputs (migration 360): exactly one '
                 'high-confidence field carries this line''s value and its '
                 'code is not shared with another line. NOT verified '
                 'against a real Export — Export is 403-blocked pending '
                 'Intuit provisioning. Verify before this drives a write.'
from resolved r
where m.tax_year = 2025
  and m.return_type = 'IND'
  and m.line_code = r.line_code
  -- Never overwrite a mapping a human has confirmed from a real Export.
  and m.confidence <> 'confirmed';

commit;
