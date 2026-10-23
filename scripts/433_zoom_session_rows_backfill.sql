-- 433: Zoom — one zoom_meetings row per SESSION, part 2 of 2.
--
-- Apply right AFTER the per-session code is deployed (see 432 for the
-- design and the ordering). Until then the live code upserts
-- onConflict zoom_meeting_id, which needs the per-number unique key this
-- file drops.
--
-- What it does, in order:
--   1. Drops the per-NUMBER unique key on zoom_meetings and the per-number
--      todo dedup index on tasks (432 added the per-session ones).
--   2. Adopts a scheduled placeholder: when a number has exactly one real
--      session and one zoom_meetings row whose uuid is the SCHEDULED uuid
--      (never seen in recordings, transcripts or participants), that row IS
--      the session — re-key it rather than adding a duplicate. The scheduled
--      uuid is kept in scheduled_uuid (Zoom's lists keep returning it, and a
--      sync must not insert a twin), and its todos' deep links are rewritten.
--   3. Creates a row for every other recorded/transcribed session, copying
--      series-level fields (host, connection, join url, passcode) from the
--      number's existing row. Never copies raw_data: it carries the other
--      session's AI-summary note id.
--   4. Moves participant rows and AI-summary rows onto their own session
--      (both already carry the session uuid).
--   5. Re-links clients PER SESSION from evidence that session holds:
--        a. its own participants (contacts already resolved by email), and
--        b. the Calendly booking that started within 30 min of THAT session
--           (each booking goes to its single closest session). A legacy
--           bridge pointing at a booking more than 30 min away is cleared.
--      Title/topic is not used: a PMI's topic names its host, and a
--      recurring meeting's topic is the same for every session.
--   6. Flags (needs_review, never deletes) the client links that predate
--      this migration on a shared number and that neither of the above
--      corroborates for the session they sit on. Manual tags are flagged
--      too: they were made against the per-number row, so which session the
--      tagger meant is unknown.
--   7. Stamps alfred_triage_at on new rows older than 60 days so the
--      account sweep doesn't model-triage hundreds of historical PMI calls
--      that have no participant list (the S2S app has no past-meeting
--      scope). Recent sessions go through the normal per-session sweep.
--
-- NOT done here (deliberately):
--   • Client NOTES are not touched. The re-summarize trigger is disabled
--     while this runs, so linking a session's client does not file new notes
--     either. Re-summarizing and moving mis-filed notes is a separate,
--     reviewed step; the final report counts the transcripts it would cover.
--   • Debriefs stay on the row they were written against.
--
-- Idempotent: every insert is guarded by NOT EXISTS / ON CONFLICT and every
-- update by its own predicate. Run:
--   psql "$POSTGRES_URL_NON_POOLING" -f scripts/433_zoom_session_rows_backfill.sql
-- Then check: npx tsx scripts/434-zoom-session-links-check.ts

begin;

-- ── 1. Per-number keys go away ───────────────────────────────────────────
alter table public.zoom_meetings
  drop constraint if exists zoom_meetings_zoom_meeting_id_key;
create index if not exists zoom_meetings_zoom_meeting_id_idx
  on public.zoom_meetings (zoom_meeting_id);

drop index if exists public.tasks_unique_zoom_meeting_per_assignee;
create index if not exists tasks_zoom_meeting_id_idx
  on public.tasks (zoom_meeting_id) where zoom_meeting_id is not null;

-- Linking a client must not file notes during the backfill (see header).
alter table public.zoom_meeting_clients disable trigger trg_requeue_transcript_summary;

-- Links that existed before this migration (step 6 reviews only these).
create temp table _433_prior_links on commit drop as
  select id from public.zoom_meeting_clients;

-- ── Every known session ──────────────────────────────────────────────────
create temp table _433_sessions on commit drop as
  select r.zoom_meeting_id as n, r.zoom_uuid as u, r.start_time, r.duration, r.topic,
         r.host_email, r.zoom_host_id, r.team_member_id, r.zoom_connection_id,
         r.meeting_type, r.timezone, r.zoom_account_id, r.raw_data
  from public.zoom_recordings r
  where r.zoom_uuid is not null and r.zoom_meeting_id is not null
  union all
  select distinct on (t.zoom_meeting_uuid)
         t.zoom_meeting_id, t.zoom_meeting_uuid, null::timestamptz, null::integer, null::text,
         null::text, null::text, t.team_member_id, t.zoom_connection_id,
         null::integer, null::text, null::text, null::jsonb
  from public.zoom_transcripts t
  where t.zoom_meeting_uuid is not null and t.zoom_meeting_id is not null
    and not exists (select 1 from public.zoom_recordings r where r.zoom_uuid = t.zoom_meeting_uuid)
  order by 2;

-- ── 2. Adopt scheduled placeholders ──────────────────────────────────────
with one_session as (
  select n, min(u) as u from _433_sessions group by n having count(*) = 1
),
placeholder as (
  select zm.id, s.u
  from public.zoom_meetings zm
  join one_session s on s.n = zm.zoom_meeting_id
  where (select count(*) from public.zoom_meetings z where z.zoom_meeting_id = zm.zoom_meeting_id) = 1
    and zm.zoom_uuid is distinct from s.u
    and not exists (select 1 from _433_sessions x where x.u = zm.zoom_uuid)
    and not exists (select 1 from public.zoom_meeting_participants p where p.zoom_meeting_uuid = zm.zoom_uuid)
    and not exists (select 1 from public.zoom_meetings z where z.zoom_uuid = s.u)
),
retask as (
  update public.tasks t
  set zoom_meeting_uuid = p.u,
      source_url = replace(t.source_url, 'uuid=' || replace(replace(replace(zm.zoom_uuid, '+', '%2B'), '/', '%2F'), '=', '%3D'),
                                         'uuid=' || replace(replace(replace(p.u, '+', '%2B'), '/', '%2F'), '=', '%3D'))
  from placeholder p join public.zoom_meetings zm on zm.id = p.id
  where t.zoom_meeting_uuid = zm.zoom_uuid
)
update public.zoom_meetings zm
set scheduled_uuid = coalesce(zm.scheduled_uuid, zm.zoom_uuid), zoom_uuid = p.u, updated_at = now()
from placeholder p
where zm.id = p.id;

-- ── 2b. Retire #407's blanket status ─────────────────────────────────────
-- 'skipped_shared_number' meant "a shared number, so no client is safe".
-- Per-session links replace that; as 'skipped_no_client' these transcripts
-- re-queue (432's trigger) once THEIR session gets a confident client.
-- Status only — nothing is summarized or filed here.
update public.zoom_transcripts
set summary_status = 'skipped_no_client'
where summary_status = 'skipped_shared_number';

-- ── 3. A row for every other session ─────────────────────────────────────
insert into public.zoom_meetings (
  zoom_meeting_id, zoom_uuid, zoom_host_id, topic, meeting_type, status,
  start_time, duration, timezone, agenda, join_url, password, host_email,
  zoom_connection_id, team_member_id, pmi, zoom_account_id, zoom_created_at,
  host_name, dept, raw_data, synced_at, created_at, updated_at, alfred_triage_at
)
select
  s.n, s.u,
  coalesce(s.zoom_host_id, tpl.zoom_host_id),
  coalesce(s.topic, tpl.topic, '(untitled meeting)'),
  coalesce(s.meeting_type, tpl.meeting_type),
  'ended',
  s.start_time, s.duration,
  coalesce(s.timezone, tpl.timezone),
  tpl.agenda, tpl.join_url, tpl.password,
  coalesce(s.host_email, tpl.host_email),
  coalesce(s.zoom_connection_id, tpl.zoom_connection_id),
  coalesce(s.team_member_id, tpl.team_member_id),
  tpl.pmi,
  coalesce(s.zoom_account_id, tpl.zoom_account_id),
  tpl.zoom_created_at, tpl.host_name, tpl.dept,
  coalesce(s.raw_data, '{}'::jsonb),
  now(), now(), now(),
  case when s.start_time < now() - interval '60 days' then now() end
from _433_sessions s
left join lateral (
  select * from public.zoom_meetings z
  where z.zoom_meeting_id = s.n
  order by z.start_time desc nulls last, z.id
  limit 1
) tpl on true
where not exists (select 1 from public.zoom_meetings z where z.zoom_uuid = s.u)
on conflict (zoom_uuid) do nothing;

-- Numbers that now hold more than one row: the only place steps 5–6 act.
create temp table _433_shared on commit drop as
  select zoom_meeting_id as n from public.zoom_meetings
  group by zoom_meeting_id having count(*) > 1;

-- ── 4. Participants + AI summaries onto their own session ────────────────
update public.zoom_meeting_participants p
set zoom_meeting_id = zm.id, updated_at = now()
from public.zoom_meetings zm
where zm.zoom_uuid = p.zoom_meeting_uuid
  and p.zoom_meeting_id is distinct from zm.id;

update public.zoom_meeting_summaries s
set zoom_meeting_id = zm.id
from public.zoom_meetings zm
where zm.zoom_uuid = s.zoom_meeting_uuid
  and s.zoom_meeting_id is distinct from zm.id;

-- ── 5a. Client links from each session's own participants ────────────────
insert into public.zoom_meeting_clients (zoom_meeting_id, contact_id, link_source, match_method, confidence, needs_review)
select distinct on (zm.id, p.contact_id)
  zm.id, p.contact_id, 'auto', coalesce(p.match_method, 'participant'), 1.0, false
from public.zoom_meeting_participants p
join public.zoom_meetings zm on zm.id = p.zoom_meeting_id and zm.zoom_uuid = p.zoom_meeting_uuid
where p.contact_id is not null
  and zm.zoom_meeting_id in (select n from _433_shared)
  and not exists (
    select 1 from public.zoom_meeting_clients c
    where c.zoom_meeting_id = zm.id and c.contact_id = p.contact_id
  )
order by zm.id, p.contact_id, p.join_time nulls last;

-- ── 5b. Calendly booking at THAT session's start ─────────────────────────
-- Clear legacy bridges on shared numbers that point at a booking more than
-- 30 min from the session (they were matched on the number alone).
update public.zoom_meetings zm
set calendly_event_id = null, calendly_bridge_at = null
from public.calendly_events ce
where ce.id = zm.calendly_event_id
  and zm.zoom_meeting_id in (select n from _433_shared)
  and (zm.start_time is null
       or abs(extract(epoch from (ce.start_time - zm.start_time))) > 30 * 60);

create temp table _433_bridge on commit drop as
  with cand as (
    select zm.id as zoom_row, ce.id as cal_id,
           abs(extract(epoch from (ce.start_time - zm.start_time))) as gap_s
    from public.zoom_meetings zm
    join public.calendly_events ce
      on ce.join_url ~ ('/j/' || zm.zoom_meeting_id::text || '([^0-9]|$)')
     and ce.start_time between zm.start_time - interval '30 minutes'
                           and zm.start_time + interval '30 minutes'
    where zm.zoom_meeting_id in (select n from _433_shared)
      and zm.calendly_event_id is null
      and zm.start_time is not null
      and coalesce(ce.status, '') !~* 'cancel'
      and ce.canceled_at is null
      and not exists (select 1 from public.zoom_meetings z2 where z2.calendly_event_id = ce.id)
  ),
  -- each booking → its closest session, then each session → its closest booking
  per_booking as (
    select distinct on (cal_id) * from cand order by cal_id, gap_s, zoom_row
  )
  select distinct on (zoom_row) zoom_row, cal_id
  from per_booking order by zoom_row, gap_s, cal_id;

update public.zoom_meetings zm
set calendly_event_id = b.cal_id, calendly_bridge_at = now()
from _433_bridge b
where zm.id = b.zoom_row;

-- Copy the booking's client + work-item tags, exactly as
-- lib/zoom/bridge-to-calendly.ts copyTags() does.
insert into public.zoom_meeting_clients
  (zoom_meeting_id, contact_id, organization_id, link_source, match_method, confidence, alfred_reason, needs_review)
select b.zoom_row, ec.contact_id, ec.organization_id, 'calendly_bridge',
       coalesce(ec.match_method, ec.link_source, 'calendly_bridge'),
       ec.confidence, ec.alfred_reason, coalesce(ec.needs_review, false)
from _433_bridge b
join public.calendly_event_clients ec on ec.calendly_event_id = b.cal_id
where (ec.contact_id is not null or ec.organization_id is not null)
  and not exists (
    select 1 from public.zoom_meeting_clients c
    where c.zoom_meeting_id = b.zoom_row
      and (c.contact_id = ec.contact_id or c.organization_id = ec.organization_id)
  );

insert into public.zoom_meeting_work_items
  (zoom_meeting_id, work_item_id, link_source, match_method, confidence, alfred_reason, needs_review)
select b.zoom_row, ew.work_item_id, 'calendly_bridge', coalesce(ew.link_source, 'calendly_bridge'),
       ew.confidence, ew.alfred_reason, coalesce(ew.needs_review, false)
from _433_bridge b
join public.calendly_event_work_items ew on ew.calendly_event_id = b.cal_id
where ew.work_item_id is not null
  and not exists (
    select 1 from public.zoom_meeting_work_items w
    where w.zoom_meeting_id = b.zoom_row and w.work_item_id = ew.work_item_id
  );

-- ── 6. Flag legacy links the session itself doesn't corroborate ──────────
update public.zoom_meeting_clients c
set needs_review = true,
    alfred_reason = concat_ws(' · ', nullif(c.alfred_reason, ''),
      'shared meeting number: linked before per-session linking (433) and not corroborated by this session''s participants or booking')
from public.zoom_meetings zm
where zm.id = c.zoom_meeting_id
  and c.id in (select id from _433_prior_links)
  and zm.zoom_meeting_id in (select n from _433_shared)
  and c.needs_review is distinct from true
  and not exists (
    select 1 from public.zoom_meeting_participants p
    where p.zoom_meeting_id = zm.id and p.zoom_meeting_uuid = zm.zoom_uuid
      and c.contact_id is not null and p.contact_id = c.contact_id
  )
  and not exists (
    select 1 from public.calendly_event_clients ec
    where zm.calendly_event_id is not null and ec.calendly_event_id = zm.calendly_event_id
      and (ec.contact_id = c.contact_id or ec.organization_id = c.organization_id)
  );

alter table public.zoom_meeting_clients enable trigger trg_requeue_transcript_summary;

-- ── Report ───────────────────────────────────────────────────────────────
select 'shared numbers' as metric, count(*)::text as value from _433_shared
union all select 'session rows on shared numbers',
  (select count(*) from public.zoom_meetings where zoom_meeting_id in (select n from _433_shared))::text
union all select 'session links from own participants',
  (select count(*) from public.zoom_meeting_clients c join public.zoom_meetings zm on zm.id = c.zoom_meeting_id
   where zm.zoom_meeting_id in (select n from _433_shared) and c.link_source = 'auto'
     and c.id not in (select id from _433_prior_links))::text
union all select 'sessions bridged to a booking at their start', (select count(*) from _433_bridge)::text
union all select 'legacy links flagged needs_review',
  (select count(*) from public.zoom_meeting_clients c
   where c.id in (select id from _433_prior_links) and c.alfred_reason like '%(433)%')::text
union all select 'transcripts a re-summarize step would cover (skipped_no_client, session now client-linked)',
  (select count(*) from public.zoom_transcripts zt
   join public.zoom_meetings zm on zm.zoom_uuid = zt.zoom_meeting_uuid
   where zm.zoom_meeting_id in (select n from _433_shared)
     and zt.summary_status = 'skipped_no_client' and zt.text_content is not null
     and exists (select 1 from public.zoom_meeting_clients c
                 where c.zoom_meeting_id = zm.id and c.contact_id is not null
                   and c.needs_review is distinct from true))::text;

commit;
