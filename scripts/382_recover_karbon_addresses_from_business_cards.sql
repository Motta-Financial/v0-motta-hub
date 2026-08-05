-- 382: Recover Karbon addresses stranded in stored business_cards JSON.
--
-- The organization mapper read `PostalAddresses[]` / `Type` /
-- `StateProvince` — fields Karbon never sends. Real payloads use
-- `Addresses[]` / `Label` / `StateProvinceCounty` (the contact mapper had
-- it right). Result: every org sync stored the full business card JSON
-- but wrote NULL address columns — an audit found 71 organizations with a
-- usable state sitting unread in business_cards. The mapper fix ships in
-- the same commit; this migration recovers the historical rows without
-- waiting for each org to be re-synced.
--
-- Selection mirrors the fixed mapper: primary card first, Physical-label
-- address preferred, but only entries that actually carry content (Karbon
-- often returns an empty Physical entry next to a populated Legal one).
-- Raw values are written (same as the sync would) — read paths normalize.
-- Fill-only: rows that already have a state are untouched.

-- ── Organizations ────────────────────────────────────────────────────────
update public.organizations o
set state      = src.st,
    city       = coalesce(nullif(trim(o.city), ''), src.city),
    zip_code   = coalesce(nullif(trim(o.zip_code), ''), src.zip),
    updated_at = now()
from (
  select distinct on (o2.id)
    o2.id,
    nullif(trim(addr->>'StateProvinceCounty'), '') as st,
    nullif(trim(addr->>'City'), '')                as city,
    nullif(trim(addr->>'ZipCode'), '')             as zip
  from public.organizations o2
  cross join lateral jsonb_array_elements(o2.business_cards) card
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(card->'Addresses') = 'array' then card->'Addresses'
         when card->'Addresses' is not null then jsonb_build_array(card->'Addresses')
         else '[]'::jsonb end
  ) addr
  where o2.business_cards is not null
    and nullif(trim(o2.state), '') is null
    and nullif(trim(addr->>'StateProvinceCounty'), '') is not null
  order by o2.id,
           coalesce((card->>'IsPrimaryCard')::boolean, false) desc,
           (addr->>'Label' = 'Physical') desc
) src
where o.id = src.id;

-- ── Contacts ─────────────────────────────────────────────────────────────
-- The contact mapper parsed the right fields, but its blind "Physical or
-- first" pick could land on an empty Physical entry while a populated
-- non-mailing address sat beside it. Recover those the same way.
update public.contacts c
set state      = src.st,
    city       = coalesce(nullif(trim(c.city), ''), src.city),
    zip_code   = coalesce(nullif(trim(c.zip_code), ''), src.zip),
    updated_at = now()
from (
  select distinct on (c2.id)
    c2.id,
    nullif(trim(addr->>'StateProvinceCounty'), '') as st,
    nullif(trim(addr->>'City'), '')                as city,
    nullif(trim(addr->>'ZipCode'), '')             as zip
  from public.contacts c2
  cross join lateral jsonb_array_elements(c2.business_cards) card
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(card->'Addresses') = 'array' then card->'Addresses'
         when card->'Addresses' is not null then jsonb_build_array(card->'Addresses')
         else '[]'::jsonb end
  ) addr
  where c2.business_cards is not null
    and nullif(trim(c2.state), '') is null
    and nullif(trim(c2.mailing_state), '') is null
    and coalesce(addr->>'Label', '') <> 'Mailing'
    and nullif(trim(addr->>'StateProvinceCounty'), '') is not null
  order by c2.id,
           coalesce((card->>'IsPrimaryCard')::boolean, false) desc,
           (addr->>'Label' = 'Physical') desc
) src
where c.id = src.id;
