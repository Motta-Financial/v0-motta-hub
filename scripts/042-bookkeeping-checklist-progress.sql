-- 042: Bookkeeping Checklist Progress
--
-- Persists per-work-item progress on the 10-step Bookkeeping Checklist
-- (Phase 1 P24 preparer steps 1-5, Phase 2 reviewer steps 6-10) that was
-- previously tracked in the FY2026 project-plan Excel workbook.
--
-- Steps 1-10 are static templates rendered in the UI; only the per-step
-- progress state is stored here. Rows are created lazily via UPSERT when
-- a user toggles a checkbox.

create table if not exists public.bookkeeping_checklist_progress (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  step_number integer not null check (step_number between 1 and 10),
  is_complete boolean not null default false,
  completed_at timestamptz,
  completed_by_id uuid references public.team_members(id) on delete set null,
  completed_by_name text,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (work_item_id, step_number)
);

create index if not exists idx_bk_checklist_work_item
  on public.bookkeeping_checklist_progress(work_item_id);

create index if not exists idx_bk_checklist_complete
  on public.bookkeeping_checklist_progress(work_item_id, is_complete);

-- Mirror the "allow all authenticated" pattern used by the rest of this app.
alter table public.bookkeeping_checklist_progress enable row level security;

drop policy if exists "Allow all on bookkeeping_checklist_progress"
  on public.bookkeeping_checklist_progress;

create policy "Allow all on bookkeeping_checklist_progress"
  on public.bookkeeping_checklist_progress
  for all
  using (true)
  with check (true);
