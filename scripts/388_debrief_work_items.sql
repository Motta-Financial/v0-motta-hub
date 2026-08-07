-- 388 — Debriefs ↔ Karbon work items, many-to-many
--
-- The debrief form has always let a teammate select SEVERAL related work
-- items, but only the first one ever became a real link:
--
--     work_item_id: relatedWorkItems.length > 0
--       ? toUuidOrNull(relatedWorkItems[0].id) : null
--
-- The rest were buried in the `action_items` JSONB blob — no FK, not
-- queryable, invisible to every join. So "which debriefs touched this
-- work item?" silently under-reported, and a meeting covering three
-- engagements looked like it covered one.
--
-- `debriefs.work_item_id` is deliberately LEFT IN PLACE and keeps being
-- written with the first selection. Plenty of existing code and views
-- read it (debriefs_full, the Karbon note builder, client dashboards),
-- and breaking those to normalize a list is not a trade worth making.
-- Treat it as the "primary work item" and this table as the full set.

create table if not exists public.debrief_work_items (
  id            uuid primary key default gen_random_uuid(),
  debrief_id    uuid not null references public.debriefs(id) on delete cascade,
  work_item_id  uuid not null references public.work_items(id) on delete cascade,
  -- 'selected'      — teammate picked an existing work item on the form
  -- 'created'       — the form created this work item in Karbon on submit
  -- 'backfill'      — reconstructed from the legacy JSONB blob
  link_source   text not null default 'selected'
                  check (link_source in ('selected','created','backfill')),
  created_at    timestamptz not null default now(),
  unique (debrief_id, work_item_id)
);

comment on table public.debrief_work_items is
  'Every Karbon work item a debrief relates to. debriefs.work_item_id remains the primary/first one for backward compatibility.';

create index if not exists idx_debrief_work_items_debrief
  on public.debrief_work_items (debrief_id);
create index if not exists idx_debrief_work_items_work_item
  on public.debrief_work_items (work_item_id);

-- Backfill from the JSONB blob so history isn't lost. `action_items` is an
-- object whose `related_work_items` key holds the array the form sent.
-- Guarded by a work_items existence check because the blob stores whatever
-- the form had in memory, including rows since deleted.
insert into public.debrief_work_items (debrief_id, work_item_id, link_source)
select distinct
  d.id,
  (wi->>'id')::uuid,
  'backfill'
from public.debriefs d
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(d.action_items->'related_work_items') = 'array'
      then d.action_items->'related_work_items'
    else '[]'::jsonb
  end
) as wi
where d.deleted_at is null
  and wi->>'id' is not null
  -- Only well-formed uuids; the blob is unvalidated user-shaped data.
  and wi->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (select 1 from public.work_items w where w.id = (wi->>'id')::uuid)
on conflict (debrief_id, work_item_id) do nothing;

-- Second backfill pass: the `related_work_items` blob only exists on 83 of
-- 915 debriefs (it was added to the form payload later), but 543 carry a
-- resolvable `work_item_id`. Without this pass the new table would cover
-- 73 debriefs and look emptier than the column it replaces — worse than
-- not having it. The FK is authoritative, so seed from it too.
insert into public.debrief_work_items (debrief_id, work_item_id, link_source)
select d.id, d.work_item_id, 'backfill'
from public.debriefs d
where d.deleted_at is null
  and d.work_item_id is not null
  and exists (select 1 from public.work_items w where w.id = d.work_item_id)
on conflict (debrief_id, work_item_id) do nothing;

-- The debrief now mirrors its work items onto the deal, so the
-- opportunity shows every engagement the meeting touched without anyone
-- re-tagging by hand on the Deal page. `link_source` was constrained to
-- manual/auto/alfred; 'debrief' is worth its own value rather than being
-- folded into 'auto', because "this reached the deal because someone
-- debriefed a meeting about it" is real provenance a reviewer will want.
alter table public.deal_work_items
  drop constraint if exists deal_work_items_link_source_check;
alter table public.deal_work_items
  add constraint deal_work_items_link_source_check
  check (link_source in ('manual','auto','alfred','debrief'));
