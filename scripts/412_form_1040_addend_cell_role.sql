-- 412: a new `addend` cell_role — several named sibling cells summing to one line.
--
-- ═══ THE BUG THIS EXISTS TO FIX ══════════════════════════════════════
--
-- Line 26 ("estimated tax payments and amount applied from the prior year")
-- has been reading Q1 ONLY since it was mapped. ProConnect keeps the four
-- quarterly payments in four distinct codes on one estimated-payments screen,
-- and scripts/368 mapped the first of them, with a note saying so:
--
--   "2025 estimated tax, Q1 amount paid. Q2-Q4 cells not yet labeled —
--    line 26 currently reflects Q1 input only."
--
-- scripts/369 then found the other three codes and deliberately did NOT map
-- them, because at the time the map held ONE row per line and there was no
-- mechanism to sum several cells:
--
--   "Line 26 stays mapped to Q1 only — the map schema holds ONE cell per
--    line and the '*' mechanism aggregates prefixes, not codes. Summing
--    c2+c4+c6+c8 needs a multi-cell mechanism first."
--
-- scripts/387 removed the one-row-per-line limit (the key became
-- (tax_year, return_type, form, line_code, cell_key)), but it added multi-cell
-- KEYS, not multi-cell SUMMATION. The renderer's scalar loop ASSIGNS
-- `data[lineCode]` rather than accumulating, so simply mapping the other
-- three quarters as `primary` would have made line 26 resolve to whichever
-- cell the iteration reached last — a silently order-dependent number on a
-- tax return, which is worse than reading Q1.
--
-- ═══ WHAT IT COSTS TODAY, MEASURED ═══════════════════════════════════
--
-- Five returns in the book have more than one quarter populated. Line 26
-- currently shows, against what it should show:
--
--   Martin, Daren    TY2025    34,954  of  139,816   (short 104,862)
--   Kirk, Jaime      TY2025     2,500  of   80,000   (short  77,500)
--   Lopez, Robert    TY2025     6,100  of   21,100   (short  15,000)
--   Coleman, Matt    TY2025      —     of   15,750   (Q1 empty: reads blank)
--   Mourad, Amira    TY2024      —     of   16,400   (Q1 empty: reads blank)
--
-- Line 26 feeds total payments, which feeds refund-or-owe. Understating
-- payments makes a return look like it owes money it has already paid, and
-- the two returns whose Q1 is empty render the line blank while real money
-- sits in Q2-Q4.
--
-- ═══ THE MECHANISM ═══════════════════════════════════════════════════
--
-- `addend`: one of several named sibling cells whose SUM is the line.
-- Numeric lines only — summing text is meaningless, and silently rendering
-- the first of several text cells is the same class of bug.
--
-- NOT the same as an aggregate ('*') mapping, and the difference is the
-- whole point:
--
--   aggregate  ONE code across EVERY instance of a repeating screen
--              (three W-2s, one wages total)
--   addend     DIFFERENT codes at the SAME prefix
--              (four quarters on one estimated-payments screen)
--
-- A line carrying addends is populated only when at least one addend is
-- present, so a return with no estimated payments reads null rather than a
-- misleading 0.
--
-- ═══ WRITES ══════════════════════════════════════════════════════════
--
-- Addend cells derive editable = FALSE, for the same reason '*' aggregates
-- do: the LINE is a total with no single cell behind it, so there is nowhere
-- to write a corrected total. Each quarter is individually writable through
-- the raw-cell browser, which addresses cells directly and never consults
-- these mappings. This REMOVES no capability — line 26 was never editable,
-- because scripts/387 already derives false for it.
--
-- This migration is schema + derivation only. It maps no cells: the
-- series/code tuples are partner-confidential and are applied out-of-band
-- per the discipline in scripts/360.
--
-- Idempotent.

begin;

-- ── (1) Admit the new role ──────────────────────────────────────────────
alter table form_1040_proconnect_map
  drop constraint if exists form_1040_pcmap_cell_role_chk;

alter table form_1040_proconnect_map
  add constraint form_1040_pcmap_cell_role_chk
  check (cell_role in ('primary', 'detail', 'addend', 'override', 'discriminator', 'control'));

comment on column form_1040_proconnect_map.cell_role is
  'What this cell contributes to its line. primary = the cell whose value IS '
  'the line. detail = one row of an expansion grid behind a total (drill-down '
  'only, never a line value). addend = one of several named sibling cells '
  'whose SUM is the line, numeric lines only (e.g. the four quarterly '
  'estimated-tax payments totalling line 26) — distinct from a "*" aggregate, '
  'which sums one code across instances of a repeating screen. override = an '
  '[Override] field displacing a computation. discriminator = routes a value '
  'to one line vs another. control = changes which branch computes.';

-- ── (2) Addends are not editable ────────────────────────────────────────
-- scripts/387 derives editable from cell_role in ('primary','override').
-- `addend` is deliberately absent from that set, so the derivation already
-- yields false — this UPDATE only makes the RECORDED REASON specific, rather
-- than the generic "cell_role=addend is not a value-bearing input", which
-- would be misleading: an addend IS value-bearing, it just isn't the whole
-- line.
update form_1040_proconnect_map
   set editable = false,
       editable_basis = 'not editable: one addend of a multi-cell line total; '
                        'there is no single cell holding the total to write to. '
                        'Edit the individual cell in the raw-cell browser.'
 where cell_role = 'addend';

-- ── (3) Report ──────────────────────────────────────────────────────────
select cell_role, count(*) as mappings, count(*) filter (where editable) as editable
  from form_1040_proconnect_map
 group by cell_role
 order by cell_role;

commit;
