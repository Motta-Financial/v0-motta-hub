-- 384: Keep Hub contacts current with what clients provide on intake
-- forms and Calendly bookings — and queue CONFLICTS for human review.
--
-- Clients hand us four fields on both lead surfaces: name, email, phone,
-- and state. Migration 383 started fill-only state propagation; this one
-- completes the loop:
--   · MISSING Hub fields (no email / phone / state on the contact) are
--     filled automatically from the latest submission or booking.
--   · CONFLICTING fields (client provided something different from what
--     the Hub record says) are never auto-applied — they land in
--     contact_update_suggestions as pending rows that staff accept or
--     dismiss from /admin/contact-updates.
--
-- The generator runs after every Calendly sync (30-min cadence) and is
-- idempotent: a unique index keeps re-runs from duplicating suggestions,
-- and a dismissed value is never re-suggested.

-- ── Review queue table ───────────────────────────────────────────────────
create table if not exists public.contact_update_suggestions (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid not null references public.contacts(id) on delete cascade,
  field              text not null check (field in ('name','email','phone','state')),
  current_value      text,
  suggested_value    text not null,
  source             text not null check (source in ('intake_form','calendly')),
  -- Points back at the originating jotform_intake_submissions.id or
  -- calendly_invitees.id so reviewers can open the source record.
  source_ref         text,
  source_captured_at timestamptz,
  status             text not null default 'pending'
                     check (status in ('pending','accepted','dismissed')),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        text
);

-- One suggestion per (contact, field, source, value) — across ALL
-- statuses, so a dismissed value never comes back on the next sync tick.
create unique index if not exists contact_update_suggestions_uniq
  on public.contact_update_suggestions (contact_id, field, source, lower(suggested_value));
create index if not exists contact_update_suggestions_pending
  on public.contact_update_suggestions (created_at desc) where status = 'pending';

alter table public.contact_update_suggestions enable row level security;
drop policy if exists contact_update_suggestions_staff on public.contact_update_suggestions;
create policy contact_update_suggestions_staff on public.contact_update_suggestions
  for all
  using ((select auth.role()) in ('authenticated', 'service_role'))
  with check ((select auth.role()) in ('authenticated', 'service_role'));

-- ── Generator ────────────────────────────────────────────────────────────
create or replace function public.sync_lead_contact_updates()
returns table (
  states_filled_contacts integer,
  states_filled_orgs     integer,
  states_filled_calendly integer,
  emails_filled          integer,
  phones_filled          integer,
  suggestions_created    integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state_ic integer := 0;
  v_state_io integer := 0;
  v_state_cc integer := 0;
  v_emails   integer := 0;
  v_phones   integer := 0;
  v_suggs    integer := 0;
  n          integer;
begin
  -- 1. State fills (migration 383's function, unchanged semantics).
  select t.contacts_from_intake, t.orgs_from_intake, t.contacts_from_calendly
    into v_state_ic, v_state_io, v_state_cc
  from public.propagate_lead_state_answers() t;

  -- Latest lead-provided values per contact, both sources merged.
  -- Intake wins ties (it is the fuller, more deliberate form).
  create temp table _lead_latest on commit drop as
  select distinct on (contact_id)
    contact_id, src, src_ref, captured_at,
    nullif(trim(full_name), '')                          as lead_name,
    nullif(lower(trim(email)), '')                       as lead_email,
    nullif(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '') as lead_phone_digits,
    nullif(trim(phone), '')                              as lead_phone_raw,
    public.normalize_us_state(state_raw)                 as lead_state
  from (
    select s.contact_id, 'intake_form'::text as src, s.id::text as src_ref,
           s.jotform_created_at as captured_at,
           s.submitter_full_name as full_name, s.submitter_email as email,
           s.submitter_phone as phone,
           coalesce(nullif(trim(s.submitter_state), ''), s.business_state) as state_raw
    from public.jotform_intake_submissions s
    where s.contact_id is not null
    union all
    select ci.contact_id, 'calendly', ci.id::text, ci.calendly_created_at,
           ci.name, ci.email, ci.text_reminder_number,
           (select qa->>'answer' from jsonb_array_elements(ci.questions_answers) qa
            where qa->>'question' = 'Tax Filing State' limit 1)
    from public.calendly_invitees ci
    where ci.contact_id is not null
  ) u
  order by contact_id, captured_at desc nulls last;

  -- 2. Fill missing emails (contact has none anywhere).
  update public.contacts c
  set primary_email = l.lead_email,
      updated_at    = now()
  from _lead_latest l
  where c.id = l.contact_id
    and l.lead_email like '%@%'
    and nullif(trim(c.primary_email), '') is null;
  get diagnostics v_emails = row_count;

  -- 3. Fill missing phones (≥10 digits provided, contact has none).
  update public.contacts c
  set phone_primary = l.lead_phone_raw,
      updated_at    = now()
  from _lead_latest l
  where c.id = l.contact_id
    and length(l.lead_phone_digits) >= 10
    and nullif(regexp_replace(coalesce(c.phone_primary,''), '\D', '', 'g'), '') is null;
  get diagnostics v_phones = row_count;

  -- 4. Conflicts → review queue. Values compared loosely (case-folded
  --    emails/names, last-10-digit phones, normalized states) so pure
  --    formatting differences never page a human.
  insert into public.contact_update_suggestions
    (contact_id, field, current_value, suggested_value, source, source_ref, source_captured_at)
  select * from (
    -- email
    select l.contact_id, 'email'::text, c.primary_email, trim(l.lead_email),
           l.src, l.src_ref, l.captured_at
    from _lead_latest l join public.contacts c on c.id = l.contact_id
    where l.lead_email like '%@%'
      and nullif(trim(c.primary_email), '') is not null
      and lower(trim(c.primary_email)) <> l.lead_email
      and lower(trim(coalesce(c.secondary_email, ''))) <> l.lead_email
    union all
    -- phone
    select l.contact_id, 'phone', c.phone_primary, l.lead_phone_raw,
           l.src, l.src_ref, l.captured_at
    from _lead_latest l join public.contacts c on c.id = l.contact_id
    where length(l.lead_phone_digits) >= 10
      and nullif(regexp_replace(coalesce(c.phone_primary,''), '\D', '', 'g'), '') is not null
      and right(regexp_replace(c.phone_primary, '\D', '', 'g'), 10) <> right(l.lead_phone_digits, 10)
    union all
    -- state
    select l.contact_id, 'state', coalesce(nullif(trim(c.state),''), c.mailing_state), l.lead_state,
           l.src, l.src_ref, l.captured_at
    from _lead_latest l join public.contacts c on c.id = l.contact_id
    where l.lead_state is not null
      and public.normalize_us_state(coalesce(nullif(trim(c.state),''), c.mailing_state)) is not null
      and public.normalize_us_state(coalesce(nullif(trim(c.state),''), c.mailing_state)) <> l.lead_state
    union all
    -- name
    select l.contact_id, 'name', c.full_name, l.lead_name,
           l.src, l.src_ref, l.captured_at
    from _lead_latest l join public.contacts c on c.id = l.contact_id
    where l.lead_name is not null
      and nullif(trim(c.full_name), '') is not null
      and lower(trim(c.full_name)) <> lower(l.lead_name)
  ) s (contact_id, field, current_value, suggested_value, source, source_ref, source_captured_at)
  on conflict (contact_id, field, source, lower(suggested_value)) do nothing;
  get diagnostics n = row_count;
  v_suggs := n;

  drop table if exists _lead_latest;

  return query select v_state_ic, v_state_io, v_state_cc, v_emails, v_phones, v_suggs;
end
$$;

comment on function public.sync_lead_contact_updates() is
  'Applies client-provided intake/Calendly data to Hub contacts: fills missing email/phone/state, queues conflicting name/email/phone/state values into contact_update_suggestions for staff review. Runs after each Calendly sync; idempotent.';

-- One-time historical run.
select * from public.sync_lead_contact_updates();
