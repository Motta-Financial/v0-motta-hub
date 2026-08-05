-- 381: Fill missing Hub client addresses from ProConnect tax-return data.
--
-- Context: the Ignition Reporting API carries no client address at all
-- (see migration 380's geo-guard note), so the Sales Dashboard resolves a
-- proposal's state through the linked Hub contact/organization. After 380
-- linked 99.5% of proposals, an audit still found 822 of 1,058 active
-- proposals with no state — the CRM records themselves are missing
-- addresses. ProConnect is the authoritative source here (tax returns
-- require a filing address): its rows carry state/city and direct
-- hub_contact_id / hub_organization_id links, and can fill 606 of those
-- 822 gaps immediately.
--
-- Shape: a reusable function so the nightly ProConnect sync keeps
-- propagating addresses as new clients link up, called once here as the
-- historical backfill. Only fills NULL/blank targets — a state entered by
-- staff (or via the dashboard's inline state editor) is never overwritten.
-- Values are normalized to 2-letter codes and validated against the real
-- state list; anything unrecognized is skipped.

create or replace function public.propagate_proconnect_addresses()
returns table (contacts_updated integer, orgs_updated integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contacts integer := 0;
  v_orgs     integer := 0;
begin
  -- ── Contacts ─────────────────────────────────────────────────────────
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
  ),
  src as (
    -- Most recently synced ProConnect row per hub contact wins.
    select distinct on (pc.hub_contact_id)
      pc.hub_contact_id,
      case
        when length(trim(pc.state)) = 2 then upper(trim(pc.state))
        else (select nm.abbr from name_map nm where nm.full_name = lower(trim(pc.state)))
      end as st,
      nullif(trim(pc.city), '') as city
    from public.proconnect_clients pc
    where pc.hub_contact_id is not null
      and nullif(trim(pc.state), '') is not null
    order by pc.hub_contact_id, pc.synced_at desc nulls last
  )
  update public.contacts c
  set state      = src.st,
      city       = coalesce(nullif(trim(c.city), ''), src.city),
      updated_at = now()
  from src
  where c.id = src.hub_contact_id
    and src.st is not null
    and src.st in (select nm.abbr from name_map nm)
    and nullif(trim(c.state), '') is null
    and nullif(trim(c.mailing_state), '') is null;
  get diagnostics v_contacts = row_count;

  -- ── Organizations ────────────────────────────────────────────────────
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
  ),
  src as (
    select distinct on (pc.hub_organization_id)
      pc.hub_organization_id,
      case
        when length(trim(pc.state)) = 2 then upper(trim(pc.state))
        else (select nm.abbr from name_map nm where nm.full_name = lower(trim(pc.state)))
      end as st,
      nullif(trim(pc.city), '') as city
    from public.proconnect_clients pc
    where pc.hub_organization_id is not null
      and nullif(trim(pc.state), '') is not null
    order by pc.hub_organization_id, pc.synced_at desc nulls last
  )
  update public.organizations o
  set state      = src.st,
      city       = coalesce(nullif(trim(o.city), ''), src.city),
      updated_at = now()
  from src
  where o.id = src.hub_organization_id
    and src.st is not null
    and src.st in (select nm.abbr from name_map nm)
    and nullif(trim(o.state), '') is null;
  get diagnostics v_orgs = row_count;

  return query select v_contacts, v_orgs;
end
$$;

comment on function public.propagate_proconnect_addresses() is
  'Fills NULL contacts/organizations state+city from linked proconnect_clients rows (tax-return addresses). Never overwrites existing values. Called by the nightly proconnect-sync cron; safe to re-run.';

-- One-time historical backfill.
select * from public.propagate_proconnect_addresses();
