-- 379: Close the remaining field-coverage gaps for the Karbon, Zoom and
-- Calendly integrations (companion to 377's Ignition import).
--
-- Method: each integration's API doc/spec was diffed against the live
-- table columns; only genuinely-missing fields that the APIs actually
-- deliver are added. Zoom/Calendly rows already stash the full API payload
-- in raw_data, so history is backfilled from there with no API calls.
-- Karbon has no raw-payload column — its new columns fill on the next sync
-- via lib/karbon/mappers/work-item.ts.
--
-- Calendly events + invitees needed nothing: every field in the stored
-- payloads is already materialised as a column.

-- ────────────────────────────────────────────────────────────────────────
-- 1. work_items ← Karbon WorkItem (OpenAPI spec). These five were
--    documented in scripts/011 but never landed on the live table.
-- ────────────────────────────────────────────────────────────────────────
alter table public.work_items
  add column if not exists assignee_email                 text,
  add column if not exists client_user_defined_identifier text,
  add column if not exists deadline_date                  date,
  add column if not exists todo_period                    text,
  add column if not exists work_schedule_key              text;

comment on column public.work_items.assignee_email is 'Karbon: AssigneeEmailAddress';
comment on column public.work_items.client_user_defined_identifier is
  'Karbon: ClientUserDefinedIdentifier — the CLIENT''s user-assigned id as carried on the work item (cross-system join key)';
comment on column public.work_items.deadline_date is 'Karbon: DeadlineDate — hard deadline, distinct from DueDate';
comment on column public.work_items.todo_period is 'Karbon: ToDoPeriod';
comment on column public.work_items.work_schedule_key is 'Karbon: WorkScheduleKey — recurring work schedule this item was generated from';

-- ────────────────────────────────────────────────────────────────────────
-- 2. zoom_meetings ← Zoom Meetings API. created_at / pmi / account_id
--    arrive in the payloads but were dropped by the mappers.
-- ────────────────────────────────────────────────────────────────────────
alter table public.zoom_meetings
  add column if not exists zoom_created_at timestamptz,
  add column if not exists pmi             text,
  add column if not exists zoom_account_id text;

update public.zoom_meetings set
  zoom_created_at = coalesce(zoom_created_at, nullif(raw_data->>'created_at','')::timestamptz),
  pmi             = coalesce(pmi, nullif(raw_data->>'pmi','')),
  zoom_account_id = coalesce(zoom_account_id, raw_data->>'account_id')
where raw_data is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 3. calendly_event_types ← Calendly Event Type object. The API returns
--    all of these today (verified against stored raw_data on all 52 rows).
-- ────────────────────────────────────────────────────────────────────────
alter table public.calendly_event_types
  add column if not exists admin_managed    boolean,
  add column if not exists custom_questions jsonb,
  add column if not exists deleted_at       timestamptz,
  add column if not exists duration_options jsonb,
  add column if not exists internal_note    text,
  add column if not exists is_paid          boolean,
  add column if not exists locale           text,
  add column if not exists locations        jsonb,
  add column if not exists position         integer,
  add column if not exists profile_type     text,
  add column if not exists profile_name     text;

update public.calendly_event_types set
  admin_managed    = coalesce(admin_managed, (raw_data->>'admin_managed')::boolean),
  custom_questions = coalesce(custom_questions,
                       case when jsonb_typeof(raw_data->'custom_questions') = 'array'
                            then raw_data->'custom_questions' end),
  deleted_at       = coalesce(deleted_at, nullif(raw_data->>'deleted_at','')::timestamptz),
  duration_options = coalesce(duration_options,
                       case when jsonb_typeof(raw_data->'duration_options') = 'array'
                            then raw_data->'duration_options' end),
  internal_note    = coalesce(internal_note, raw_data->>'internal_note'),
  is_paid          = coalesce(is_paid, (raw_data->>'is_paid')::boolean),
  locale           = coalesce(locale, raw_data->>'locale'),
  locations        = coalesce(locations,
                       case when jsonb_typeof(raw_data->'locations') = 'array'
                            then raw_data->'locations' end),
  position         = coalesce(position,
                       case when raw_data->>'position' ~ '^-?\d+$'
                            then (raw_data->>'position')::integer end),
  profile_type     = coalesce(profile_type, raw_data->'profile'->>'type'),
  profile_name     = coalesce(profile_name, raw_data->'profile'->>'name')
where raw_data is not null;
