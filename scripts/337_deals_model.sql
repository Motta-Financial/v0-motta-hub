-- ============================================================================
-- Migration 337: Deals model
-- ----------------------------------------------------------------------------
-- A Deal = ONE sales opportunity per prospect/client (NOT per meeting).
-- A prospect enters the Hub via an intake form, a Calendly event, or the
-- in-person prospect form. At that point a contact (and optionally an org)
-- is created. The Deal sits ABOVE meetings: a single Deal groups every
-- meeting tied to that opportunity (intro Zoom call, follow-up phone call,
-- in-person sit-down, etc).
--
--   deals (1) ──< meetings.deal_id          (many meetings per deal)
--   deals (1) ──< debriefs.deal_id          (debrief lives on the deal)
--   deals (1) ──< deal_work_items           (tagged Karbon work items)
--
-- This migration is idempotent: safe to run multiple times. The backfill
-- creates one Deal per distinct contact that already has meetings or
-- debriefs, then attaches that history.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. deals table
-- ----------------------------------------------------------------------------
create table if not exists public.deals (
  id                uuid primary key default gen_random_uuid(),
  -- Canonical Hub identity. A deal is anchored to the master contact
  -- (contacts.id) and optionally the organization for business clients.
  contact_id        uuid references public.contacts(id) on delete set null,
  organization_id   uuid references public.organizations(id) on delete set null,

  title             text not null,
  -- Pipeline stage of the opportunity.
  --   new            -> just entered the Hub, no meeting yet
  --   meeting_scheduled -> a meeting is booked
  --   met            -> at least one meeting has occurred
  --   debriefed      -> a debrief has been completed
  --   won / lost     -> closed outcomes
  stage             text not null default 'new'
                       check (stage in ('new','meeting_scheduled','met','debriefed','won','lost')),
  status            text not null default 'open'
                       check (status in ('open','closed')),

  -- How the prospect first reached the firm.
  --   intake_form | calendly | prospect_form | manual | unknown
  source            text not null default 'unknown',

  -- Ownership / assignment (team member responsible for the deal).
  owner_team_member_id uuid references public.team_members(id) on delete set null,

  -- Optional fee/value tracking for the opportunity.
  estimated_value   numeric,

  notes             text,

  -- Lifecycle timestamps.
  first_contact_at  timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.deals is
  'A sales opportunity per prospect/client. Groups many meetings + a debrief. Created when a prospect enters the Hub (intake form, Calendly, or prospect form).';

create index if not exists deals_contact_id_idx       on public.deals(contact_id);
create index if not exists deals_organization_id_idx  on public.deals(organization_id);
create index if not exists deals_stage_idx            on public.deals(stage);
create index if not exists deals_status_idx           on public.deals(status);
create index if not exists deals_owner_idx            on public.deals(owner_team_member_id);

-- Only one OPEN deal per contact at a time (the active opportunity).
-- Closed deals can pile up in history, so the uniqueness is partial.
create unique index if not exists deals_one_open_per_contact
  on public.deals(contact_id)
  where status = 'open' and contact_id is not null;

-- ----------------------------------------------------------------------------
-- 2. Link meetings + debriefs to a deal
-- ----------------------------------------------------------------------------
alter table public.meetings
  add column if not exists deal_id uuid references public.deals(id) on delete set null;
create index if not exists meetings_deal_id_idx on public.meetings(deal_id);

alter table public.debriefs
  add column if not exists deal_id uuid references public.deals(id) on delete set null;
create index if not exists debriefs_deal_id_idx on public.debriefs(deal_id);

-- ----------------------------------------------------------------------------
-- 3. deal_work_items: tag client Karbon work item(s) to the deal
-- ----------------------------------------------------------------------------
-- The user tags one or more of the client's work items to the deal, then
-- performs the debrief on the deal. Mirrors the link_source convention used
-- by calendly_event_* / zoom_meeting_* tag tables.
create table if not exists public.deal_work_items (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals(id) on delete cascade,
  work_item_id  uuid not null references public.work_items(id) on delete cascade,
  -- 'manual' (user tagged) | 'auto' (inherited from a linked meeting) | 'alfred'
  link_source   text not null default 'manual'
                  check (link_source in ('manual','auto','alfred')),
  created_by_team_member_id uuid references public.team_members(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (deal_id, work_item_id)
);

comment on table public.deal_work_items is
  'Karbon work items tagged to a deal. The debrief is performed on the deal against these work items (replaces debriefing directly on a single Karbon work item).';

create index if not exists deal_work_items_deal_idx on public.deal_work_items(deal_id);
create index if not exists deal_work_items_wi_idx   on public.deal_work_items(work_item_id);

-- ----------------------------------------------------------------------------
-- 4. updated_at trigger for deals
-- ----------------------------------------------------------------------------
create or replace function public.set_deals_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_deals_updated_at on public.deals;
create trigger trg_deals_updated_at
  before update on public.deals
  for each row execute function public.set_deals_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Backfill meetings.contact_id from the Calendly / Zoom client tags
-- ----------------------------------------------------------------------------
-- The hub-meetings sync historically did not copy resolved client links into
-- meetings.contact_id, so most rows are null. Pull the highest-confidence
-- contact from the tag tables so the deal backfill below can group them.

-- 5a. From Calendly: meetings.calendly_event_id::uuid = cec.calendly_event_id
update public.meetings m
set contact_id = src.contact_id,
    organization_id = coalesce(m.organization_id, src.organization_id)
from (
  select distinct on (cec.calendly_event_id)
         cec.calendly_event_id, cec.contact_id, cec.organization_id
  from public.calendly_event_clients cec
  where cec.contact_id is not null
  order by cec.calendly_event_id, cec.confidence desc nulls last, cec.created_at asc
) src
where m.contact_id is null
  and m.calendly_event_id is not null
  and m.calendly_event_id ~ '^[0-9a-f-]{36}$'
  and m.calendly_event_id::uuid = src.calendly_event_id;

-- 5b. From Zoom: zoom_meetings.meeting_id = meetings.id, then
--     zoom_meeting_clients.zoom_meeting_id = zoom_meetings.id
update public.meetings m
set contact_id = src.contact_id,
    organization_id = coalesce(m.organization_id, src.organization_id)
from (
  select distinct on (zm.meeting_id)
         zm.meeting_id, zmc.contact_id, zmc.organization_id
  from public.zoom_meetings zm
  join public.zoom_meeting_clients zmc on zmc.zoom_meeting_id = zm.id
  where zm.meeting_id is not null
    and zmc.contact_id is not null
  order by zm.meeting_id, zmc.confidence desc nulls last, zmc.created_at asc
) src
where m.contact_id is null
  and m.id = src.meeting_id;

-- ----------------------------------------------------------------------------
-- 6. Backfill Deals: one OPEN deal per distinct contact with history
-- ----------------------------------------------------------------------------
-- Insert a deal for every contact that appears in meetings or debriefs but
-- does not yet have an open deal.
insert into public.deals (contact_id, organization_id, title, stage, status, source, first_contact_at)
select
  ranked.contact_id,
  ranked.organization_id,
  coalesce(nullif(trim(ct.full_name), ''),
           nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), ''),
           ct.primary_email,
           'Deal') as title,
  -- Infer stage from history.
  case
    when ranked.has_debrief then 'debriefed'
    when ranked.has_meeting then 'met'
    else 'new'
  end as stage,
  'open' as status,
  'unknown' as source,
  ranked.first_at
from (
  select
    s.contact_id,
    (array_agg(s.organization_id) filter (where s.organization_id is not null))[1] as organization_id,
    bool_or(s.kind = 'debrief') as has_debrief,
    bool_or(s.kind = 'meeting') as has_meeting,
    min(s.at) as first_at
  from (
    select contact_id, organization_id, 'meeting' as kind, scheduled_start as at
      from public.meetings where contact_id is not null
    union all
    select contact_id, organization_id, 'debrief' as kind, created_at as at
      from public.debriefs where contact_id is not null
  ) s
  group by s.contact_id
) ranked
join public.contacts ct on ct.id = ranked.contact_id
where not exists (
  select 1 from public.deals d
  where d.contact_id = ranked.contact_id and d.status = 'open'
);

-- ----------------------------------------------------------------------------
-- 7. Attach existing meetings + debriefs to the backfilled deals
-- ----------------------------------------------------------------------------
update public.meetings m
set deal_id = d.id
from public.deals d
where m.deal_id is null
  and m.contact_id is not null
  and d.contact_id = m.contact_id
  and d.status = 'open';

update public.debriefs db
set deal_id = d.id
from public.deals d
where db.deal_id is null
  and db.contact_id is not null
  and d.contact_id = db.contact_id
  and d.status = 'open';

-- 7b. Seed deal_work_items from debriefs that already reference a work item.
insert into public.deal_work_items (deal_id, work_item_id, link_source)
select distinct db.deal_id, db.work_item_id, 'auto'
from public.debriefs db
where db.deal_id is not null
  and db.work_item_id is not null
on conflict (deal_id, work_item_id) do nothing;

-- ----------------------------------------------------------------------------
-- 8. deals_enriched view
-- ----------------------------------------------------------------------------
-- One row per deal with contact/org display names, aggregate meeting +
-- debrief counts, and the most recent / next meeting timestamps. All /deals
-- pages should read from this view (mirrors the proconnect_*_enriched pattern).
create or replace view public.deals_enriched as
select
  d.*,
  coalesce(nullif(trim(ct.full_name), ''),
           nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), ''),
           ct.primary_email) as contact_name,
  ct.primary_email as contact_email,
  org.name as organization_name,
  tm.full_name as owner_name,
  mstats.meeting_count,
  mstats.recorded_meeting_count,
  mstats.last_meeting_at,
  mstats.next_meeting_at,
  dstats.debrief_count,
  dstats.last_debrief_at,
  wstats.work_item_count
from public.deals d
left join public.contacts ct on ct.id = d.contact_id
left join public.organizations org on org.id = d.organization_id
left join public.team_members tm on tm.id = d.owner_team_member_id
left join lateral (
  select
    count(*) as meeting_count,
    count(*) filter (where m.zoom_meeting_id is not null) as recorded_meeting_count,
    max(m.scheduled_start) filter (where m.scheduled_start <= now()) as last_meeting_at,
    min(m.scheduled_start) filter (where m.scheduled_start > now()) as next_meeting_at
  from public.meetings m
  where m.deal_id = d.id
) mstats on true
left join lateral (
  select count(*) as debrief_count, max(db.created_at) as last_debrief_at
  from public.debriefs db
  where db.deal_id = d.id
) dstats on true
left join lateral (
  select count(*) as work_item_count
  from public.deal_work_items dwi
  where dwi.deal_id = d.id
) wstats on true;

comment on view public.deals_enriched is
  'Read model for /deals pages: deal + contact/org/owner names + meeting/debrief/work-item aggregates.';
