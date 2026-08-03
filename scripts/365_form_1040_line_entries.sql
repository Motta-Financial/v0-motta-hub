-- 365: direct 1040 line entry — persistence for values a preparer types
-- straight onto a Form 1040 line, as opposed to deriving them from a
-- source document.
--
-- ─── WHY THIS EXISTS ────────────────────────────────────────────────
-- The Hub already has a document-driven intake path:
--
--     tax_input_sets → tax_input_documents → tax_input_values
--         → lib/tax/intake/compute.ts  (1040 preview)
--         → lib/tax/intake/serialize.ts (ProConnect Import batches)
--
-- That path is correct for income that arrives on a form — a W-2 has a
-- box 1, and the right place to key it is on a W-2. But it cannot express
-- a line that has no source document behind it: a Schedule 1 adjustment
-- total, an estimated-tax payment, a prior-year overpayment applied
-- forward, or a figure a preparer is carrying over from last year's
-- return while the rest of the documents are still outstanding.
--
-- Those lines had nowhere to live. `/api/forms/1040/[returnId]` POST
-- accepts a `lines` map and composes an Import payload from it, but it is
-- stateless — nothing is persisted, and no UI calls it. This table is the
-- missing store.
--
-- ─── SCOPING ────────────────────────────────────────────────────────
-- Entries hang off `tax_input_sets`, not off a ProConnect return id.
-- Two reasons:
--
--   1. The intake set is the Hub-side container that already holds
--      tax_year, return_type, filing_status and the optional ProConnect
--      target. Scoping here means direct entry works for a client who has
--      no ProConnect return yet.
--   2. ProConnect Export is currently 403 on every call (see
--      docs/proconnect-api-coverage-status.md) so there are zero rows in
--      proconnect_return_snapshots. Keying off a return id would make this
--      feature depend on an integration that does not currently return
--      data.
--
-- ─── WHAT IS NOT STORED HERE ────────────────────────────────────────
-- Computed lines (1z, 9, 11, 12c, 14, 15, 18, 21, 22, 24, 25d, 32, 33,
-- 34, 37) are NOT persisted. They are derived on every read by
-- lib/tax/intake/direct-lines.ts from the form_1040_lines computation
-- DSL. Storing a derived value invites it to drift from its operands —
-- the one failure mode that is invisible on screen and wrong on a filed
-- return. The unique constraint does not prevent inserting a computed
-- line code; the API route refuses it, and evaluation ignores it.
--
-- Filing status is likewise NOT stored here. It lives on
-- tax_input_sets.filing_status, and the fs_* boolean lines are rendered
-- from it. Keeping one source of truth avoids the state where both
-- fs_single and fs_mfj read true.

create table if not exists public.form_1040_line_entries (
  id           bigint generated always as identity primary key,
  set_id       uuid not null references public.tax_input_sets(id) on delete cascade,
  line_code    text not null,
  tax_year     integer not null,
  return_type  text not null default 'IND',

  -- One column per storage class rather than a single text column, so the
  -- numeric lines stay numeric in the database. A currency line that has
  -- been visited and deliberately left blank is a NULL value_num with a
  -- row present — distinguishable from a line never touched, which has no
  -- row at all. The UI uses that distinction to show review progress.
  value_num    numeric,
  value_text   text,
  value_bool   boolean,

  entered_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint form_1040_line_entries_unique_line unique (set_id, line_code)
);

comment on table public.form_1040_line_entries is
  'Directly-entered Form 1040 line values, scoped to a tax_input_set. Computed lines are never stored here — see lib/tax/intake/direct-lines.ts.';

create index if not exists form_1040_line_entries_set_idx
  on public.form_1040_line_entries (set_id);

-- Touch updated_at on every write. The UI shows "saved HH:MM" from this,
-- and an autosave that silently no-ops is worse than one that errors.
create or replace function public.touch_form_1040_line_entries()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists form_1040_line_entries_touch on public.form_1040_line_entries;
create trigger form_1040_line_entries_touch
  before update on public.form_1040_line_entries
  for each row execute function public.touch_form_1040_line_entries();

-- ─── RLS ────────────────────────────────────────────────────────────
-- Same posture as migration 364: authenticated only, no anon grant. The
-- API route uses the service role and authorizes the caller itself, so
-- this policy is the backstop for direct PostgREST access, not the
-- primary gate.
alter table public.form_1040_line_entries enable row level security;

drop policy if exists "authenticated read form_1040_line_entries"
  on public.form_1040_line_entries;
create policy "authenticated read form_1040_line_entries"
  on public.form_1040_line_entries
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated write form_1040_line_entries"
  on public.form_1040_line_entries;
create policy "authenticated write form_1040_line_entries"
  on public.form_1040_line_entries
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.form_1040_line_entries from anon;
