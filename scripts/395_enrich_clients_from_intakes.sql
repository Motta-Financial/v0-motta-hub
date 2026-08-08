-- 395: Fill genuinely-empty contact/organization fields from the client's own
-- latest intake submission.
--
-- FILL-ONLY-IF-EMPTY. Every SET is guarded so it writes only where the Hub
-- value is NULL or blank. Intake answers are client-self-reported, so they must
-- never overwrite a firm-verified value.
--
-- Measured enrichable surface (160 linked contacts, 26 linked organizations):
--   contacts: address_line1 126, address_line2 43, zip_code 90, city 9,
--             state 3, phone_primary 3, referred_by 140, employer 67
--
-- FOUR TRAPS THIS SCRIPT AVOIDS — each one measured, not hypothetical:
--
--  1. submitter_address / business_address are JSONB, not text. Keys are
--     addr_line1, addr_line2, city, state, postal, country, addr_search.
--     Treating them as text fails outright (btrim(jsonb) does not exist).
--
--  2. STATE CONVENTION MISMATCH. contacts.state uses 2-letter codes (563 rows
--     len=2 vs 11 len>2), but the intake form collects full state names (190
--     rows len>2 vs 2 len=2). Writing the raw value would inject 'Colorado'
--     into a column of 'CO' and silently break state-based grouping. The value
--     is normalised through a name->code map and skipped when unmappable.
--
--  3. GARBAGE IN addr_line1. 2 rows hold a value with no letters at all (one is
--     the bare ZIP '80516' — the client mistyped the form). Requiring at least
--     one letter excludes them.
--
--  4. referral_source IS NOT A CHANNEL. It holds a referrer's personal name
--     ('Ross Blount', 'Josh Dutton', 'Dean Doe'), so it maps to referred_by.
--     Mapping it to contacts.source — which is an acquisition-channel field —
--     would have polluted 140 rows with people's names.
--
-- ALSO DELIBERATELY NOT DONE: business_tax_classification and entity_types have
-- no correct target. organizations.entity_type is a Karbon relationship-segment
-- field ('Client', 'Client | Prospect', 'Partner (Vendor / Supplier)',
-- 'Motta | Internal'), NOT a tax classification; writing tax data there would
-- corrupt client segmentation on 105 rows. That needs a schema decision.
--
-- CAVEAT: these are Karbon-synced columns. If a Karbon pull treats Karbon as
-- authoritative, these values may be overwritten on the next sync. Filling an
-- empty field is still a net gain, but the write-back authority question should
-- be settled — see docs/client-mapping-and-profile-audit-2026-08-08.md.
--
-- Idempotent: the IS NULL / blank guards mean a second run changes nothing, and
-- a human's later edit is never clobbered.
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/395_enrich_clients_from_intakes.sql

-- Verified before running: 126 address_line1, 89 zip_code and 3 state fills on
-- contacts, with 0 unmappable state values.

begin;

-- ── Contacts ────────────────────────────────────────────────────────────
with sm(name, code) as (values
  ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),('california','CA'),
  ('colorado','CO'),('connecticut','CT'),('delaware','DE'),('district of columbia','DC'),
  ('florida','FL'),('georgia','GA'),('hawaii','HI'),('idaho','ID'),('illinois','IL'),
  ('indiana','IN'),('iowa','IA'),('kansas','KS'),('kentucky','KY'),('louisiana','LA'),
  ('maine','ME'),('maryland','MD'),('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),
  ('mississippi','MS'),('missouri','MO'),('montana','MT'),('nebraska','NE'),('nevada','NV'),
  ('new hampshire','NH'),('new jersey','NJ'),('new mexico','NM'),('new york','NY'),
  ('north carolina','NC'),('north dakota','ND'),('ohio','OH'),('oklahoma','OK'),('oregon','OR'),
  ('pennsylvania','PA'),('rhode island','RI'),('south carolina','SC'),('south dakota','SD'),
  ('tennessee','TN'),('texas','TX'),('utah','UT'),('vermont','VT'),('virginia','VA'),
  ('washington','WA'),('west virginia','WV'),('wisconsin','WI'),('wyoming','WY'),
  ('puerto rico','PR')
),
latest as (
  select distinct on (contact_id)
    contact_id,
    -- require at least one letter, so a mistyped bare ZIP is not written
    case when submitter_address->>'addr_line1' ~ '[A-Za-z]'
         then nullif(trim(submitter_address->>'addr_line1'), '') end                    as a1,
    nullif(trim(submitter_address->>'addr_line2'), '')                                  as a2,
    -- strip Jotform's '(County)' style suffix
    nullif(trim(regexp_replace(
      coalesce(nullif(trim(submitter_address->>'city'), ''), nullif(trim(submitter_city), '')),
      '\s*\([^)]*\)\s*$', '')), '')                                                     as city,
    coalesce(nullif(trim(submitter_address->>'state'), ''), nullif(trim(submitter_state), '')) as state_raw,
    -- 5-digit ZIP only (tolerates ZIP+4 by taking the leading 5)
    substring(coalesce(nullif(trim(submitter_address->>'postal'), ''), nullif(trim(submitter_zip), ''))
              from '^(\d{5})')                                                          as zip,
    nullif(trim(submitter_phone), '')                                                   as phone,
    nullif(trim(business_name), '')                                                     as biz,
    nullif(trim(referral_source), '')                                                   as refsrc
  from public.jotform_intake_submissions
  where contact_id is not null
  order by contact_id, jotform_created_at desc nulls last
),
resolved as (
  select l.*,
    case
      when length(l.state_raw) = 2 then upper(l.state_raw)
      else (select m.code from sm m where m.name = lower(l.state_raw))
    end as state_code
  from latest l
)
update public.contacts c
set address_line1 = coalesce(nullif(trim(c.address_line1), ''), r.a1),
    address_line2 = coalesce(nullif(trim(c.address_line2), ''), r.a2),
    city          = coalesce(nullif(trim(c.city), ''),          r.city),
    state         = coalesce(nullif(trim(c.state), ''),         r.state_code),
    zip_code      = coalesce(nullif(trim(c.zip_code), ''),      r.zip),
    phone_primary = coalesce(nullif(trim(c.phone_primary), ''), r.phone),
    referred_by   = coalesce(nullif(trim(c.referred_by), ''),   r.refsrc),
    employer      = coalesce(nullif(trim(c.employer), ''),      r.biz)
from resolved r
where c.id = r.contact_id
  -- only touch rows that actually change
  and (
    (nullif(trim(c.address_line1), '') is null and r.a1         is not null) or
    (nullif(trim(c.address_line2), '') is null and r.a2         is not null) or
    (nullif(trim(c.city), '')          is null and r.city       is not null) or
    (nullif(trim(c.state), '')         is null and r.state_code is not null) or
    (nullif(trim(c.zip_code), '')      is null and r.zip        is not null) or
    (nullif(trim(c.phone_primary), '') is null and r.phone      is not null) or
    (nullif(trim(c.referred_by), '')   is null and r.refsrc     is not null) or
    (nullif(trim(c.employer), '')      is null and r.biz        is not null)
  );

-- ── Organizations ───────────────────────────────────────────────────────
-- sm is re-declared: a WITH clause is scoped to its own statement.
with sm(name, code) as (values
  ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),('california','CA'),
  ('colorado','CO'),('connecticut','CT'),('delaware','DE'),('district of columbia','DC'),
  ('florida','FL'),('georgia','GA'),('hawaii','HI'),('idaho','ID'),('illinois','IL'),
  ('indiana','IN'),('iowa','IA'),('kansas','KS'),('kentucky','KY'),('louisiana','LA'),
  ('maine','ME'),('maryland','MD'),('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),
  ('mississippi','MS'),('missouri','MO'),('montana','MT'),('nebraska','NE'),('nevada','NV'),
  ('new hampshire','NH'),('new jersey','NJ'),('new mexico','NM'),('new york','NY'),
  ('north carolina','NC'),('north dakota','ND'),('ohio','OH'),('oklahoma','OK'),('oregon','OR'),
  ('pennsylvania','PA'),('rhode island','RI'),('south carolina','SC'),('south dakota','SD'),
  ('tennessee','TN'),('texas','TX'),('utah','UT'),('vermont','VT'),('virginia','VA'),
  ('washington','WA'),('west virginia','WV'),('wisconsin','WI'),('wyoming','WY'),
  ('puerto rico','PR')
),
latest as (
  select distinct on (organization_id)
    organization_id,
    case when coalesce(business_address->>'addr_line1', business_street_address) ~ '[A-Za-z]'
         then nullif(trim(coalesce(business_address->>'addr_line1', business_street_address)), '') end as a1,
    nullif(trim(business_address->>'addr_line2'), '')                                    as a2,
    nullif(trim(regexp_replace(business_address->>'city', '\s*\([^)]*\)\s*$', '')), '')  as city,
    coalesce(nullif(trim(business_address->>'state'), ''), nullif(trim(business_state), '')) as state_raw,
    substring(nullif(trim(business_address->>'postal'), '') from '^(\d{5})')             as zip,
    nullif(trim(business_phone), '')                                                     as phone,
    nullif(trim(referral_source), '')                                                    as refsrc
  from public.jotform_intake_submissions
  where organization_id is not null
  order by organization_id, jotform_created_at desc nulls last
),
resolved as (
  select l.*,
    case
      when length(l.state_raw) = 2 then upper(l.state_raw)
      else (select m.code from sm m where m.name = lower(l.state_raw))
    end as state_code
  from latest l
)
update public.organizations o
set address_line1 = coalesce(nullif(trim(o.address_line1), ''), r.a1),
    address_line2 = coalesce(nullif(trim(o.address_line2), ''), r.a2),
    city          = coalesce(nullif(trim(o.city), ''),          r.city),
    state         = coalesce(nullif(trim(o.state), ''),         r.state_code),
    zip_code      = coalesce(nullif(trim(o.zip_code), ''),      r.zip),
    phone         = coalesce(nullif(trim(o.phone), ''),         r.phone),
    referred_by   = coalesce(nullif(trim(o.referred_by), ''),   r.refsrc)
from resolved r
where o.id = r.organization_id
  and (
    (nullif(trim(o.address_line1), '') is null and r.a1         is not null) or
    (nullif(trim(o.address_line2), '') is null and r.a2         is not null) or
    (nullif(trim(o.city), '')          is null and r.city       is not null) or
    (nullif(trim(o.state), '')         is null and r.state_code is not null) or
    (nullif(trim(o.zip_code), '')      is null and r.zip        is not null) or
    (nullif(trim(o.phone), '')         is null and r.phone      is not null) or
    (nullif(trim(o.referred_by), '')   is null and r.refsrc     is not null)
  );

commit;

-- Re-run script 393 afterwards so client_profile_summaries picks up the newly
-- filled phone/city/state (they feed profile_completeness and attention_reasons).
