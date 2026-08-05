-- 383: Fill missing Hub client states from client-provided lead sources —
-- Jotform intake submissions and Calendly booking questions.
--
-- Both intake forms and Calendly meeting bookings require the client to
-- provide their name, email, phone and state:
--   · jotform_intake_submissions.submitter_state / business_state, with
--     contact_id / organization_id links set by the intake triage flow.
--   · calendly_invitees.questions_answers "Tax Filing State", with
--     contact_id set by the invitee→contact matcher.
--
-- Answers are free-text ("CO", "Colorado", "N/A"), so everything is
-- normalized through normalize_us_state() and invalid values are skipped.
-- Fill-only, like propagate_proconnect_addresses(): a state already on
-- the CRM record (from ProConnect, Karbon, or a manual edit) is never
-- overwritten. Runs once here as a backfill and on every Calendly sync
-- (every 30 min) for new bookings/submissions.

-- ── Shared normalizer: free text → validated 2-letter code (or NULL) ────
create or replace function public.normalize_us_state(raw text)
returns text
language sql
immutable
as $$
  with name_map(full_name, abbr) as (
    values
      ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),
      ('california','CA'),('colorado','CO'),('connecticut','CT'),('delaware','DE'),
      ('district of columbia','DC'),('florida','FL'),('georgia','GA'),('hawaii','HI'),
      ('idaho','ID'),('illinois','IL'),('indiana','IN'),('iowa','IA'),
      ('kansas','KS'),('kentucky','KY'),('louisiana','LA'),('maine','ME'),
      ('maryland','MD'),('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),
      ('mississippi','MS'),('missouri','MO'),('montana','MT'),('nebraska','NE'),
      ('nevada','NV'),('new hampshire','NH'),('new jersey','NJ'),('new mexico','NM'),
      ('new york','NY'),('north carolina','NC'),('north dakota','ND'),('ohio','OH'),
      ('oklahoma','OK'),('oregon','OR'),('pennsylvania','PA'),('rhode island','RI'),
      ('south carolina','SC'),('south dakota','SD'),('tennessee','TN'),('texas','TX'),
      ('utah','UT'),('vermont','VT'),('virginia','VA'),('washington','WA'),
      ('west virginia','WV'),('wisconsin','WI'),('wyoming','WY')
  )
  select case
    when raw is null or trim(raw) = '' then null
    when upper(trim(raw)) in (select abbr from name_map) then upper(trim(raw))
    else (select abbr from name_map where full_name = lower(trim(raw)))
  end
$$;

comment on function public.normalize_us_state(text) is
  'Free-text state ("CO", "Colorado", "n/a") → validated 2-letter code or NULL. Shared by the lead-source state propagation.';

-- ── Propagation function ────────────────────────────────────────────────
create or replace function public.propagate_lead_state_answers()
returns table (contacts_from_intake integer, orgs_from_intake integer, contacts_from_calendly integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake_contacts integer := 0;
  v_intake_orgs     integer := 0;
  v_cal_contacts    integer := 0;
begin
  -- 1. Intake → contacts. Latest submission per contact wins; the
  --    personal state is preferred, business state is the fallback.
  --    City/zip ride along when the contact has none.
  with src as (
    select distinct on (s.contact_id)
      s.contact_id,
      public.normalize_us_state(coalesce(nullif(trim(s.submitter_state), ''), s.business_state)) as st,
      nullif(trim(s.submitter_city), '') as city,
      nullif(trim(s.submitter_zip), '')  as zip
    from public.jotform_intake_submissions s
    where s.contact_id is not null
      and public.normalize_us_state(coalesce(nullif(trim(s.submitter_state), ''), s.business_state)) is not null
    order by s.contact_id, s.jotform_created_at desc nulls last
  )
  update public.contacts c
  set state      = src.st,
      city       = coalesce(nullif(trim(c.city), ''), src.city),
      zip_code   = coalesce(nullif(trim(c.zip_code), ''), src.zip),
      updated_at = now()
  from src
  where c.id = src.contact_id
    and nullif(trim(c.state), '') is null
    and nullif(trim(c.mailing_state), '') is null;
  get diagnostics v_intake_contacts = row_count;

  -- 2. Intake → organizations. Business state preferred.
  with src as (
    select distinct on (s.organization_id)
      s.organization_id,
      public.normalize_us_state(coalesce(nullif(trim(s.business_state), ''), s.submitter_state)) as st
    from public.jotform_intake_submissions s
    where s.organization_id is not null
      and public.normalize_us_state(coalesce(nullif(trim(s.business_state), ''), s.submitter_state)) is not null
    order by s.organization_id, s.jotform_created_at desc nulls last
  )
  update public.organizations o
  set state      = src.st,
      updated_at = now()
  from src
  where o.id = src.organization_id
    and nullif(trim(o.state), '') is null;
  get diagnostics v_intake_orgs = row_count;

  -- 3. Calendly "Tax Filing State" answers → contacts. Latest booking
  --    per matched contact wins.
  with src as (
    select distinct on (ci.contact_id)
      ci.contact_id,
      public.normalize_us_state(qa->>'answer') as st
    from public.calendly_invitees ci
    cross join lateral jsonb_array_elements(ci.questions_answers) qa
    where ci.contact_id is not null
      and qa->>'question' = 'Tax Filing State'
      and public.normalize_us_state(qa->>'answer') is not null
    order by ci.contact_id, ci.calendly_created_at desc nulls last
  )
  update public.contacts c
  set state      = src.st,
      updated_at = now()
  from src
  where c.id = src.contact_id
    and nullif(trim(c.state), '') is null
    and nullif(trim(c.mailing_state), '') is null;
  get diagnostics v_cal_contacts = row_count;

  return query select v_intake_contacts, v_intake_orgs, v_cal_contacts;
end
$$;

comment on function public.propagate_lead_state_answers() is
  'Fills NULL contacts/organizations state from Jotform intake submissions and Calendly "Tax Filing State" answers (client-provided). Normalized + validated; never overwrites. Called after each Calendly sync; safe to re-run.';

-- One-time historical backfill.
select * from public.propagate_lead_state_answers();
