-- 391: Make master_client_mapping faithful to the links the Hub actually holds.
--
-- Two independent defects were losing links in the master mapping. Both are in
-- the view, so both are fixed by redefining it — no data migration required.
--
-- DEFECT 1 — ProConnect/Ignition were read only from client_mapping.
--   Nothing in the app ever writes client_mapping when a ProConnect client is
--   linked: the trg_proconnect_auto_link_hub trigger, POST /api/tax/client-links
--   and POST /api/tax/client-links/auto-link all write ONLY the native columns
--   proconnect_clients.hub_contact_id / hub_organization_id. The same is true of
--   the Ignition path (lib/ignition/sync.ts and RPC apply_ignition_client_match
--   never reference client_mapping). client_mapping was only ever populated by
--   one-off scripts, so coverage decayed after each manual run.
--   Measured: 206 native ProConnect pairs were absent from client_mapping, which
--   hid 113 ProConnect-linked clients from the mapping entirely.
--
-- DEFECT 2 — `max(<id>) ... GROUP BY internal_client_id` silently dropped links.
--   The previous definition justified max() with "a column that is guaranteed to
--   have at most one non-null value per group". That guarantee does not hold: a
--   client legitimately holds several ProConnect records (spouse + entity
--   returns) and several Ignition records. Measured: 361 clients have >1
--   ProConnect mapping row and 174 have >1 Ignition row, so 392 ProConnect and
--   277 Ignition links (669 total) never appeared in the view, and the
--   ignition_* detail columns came from an arbitrary lexicographic winner.
--
-- Reading natively also removes a whole class of future drift: the view can no
-- longer disagree with the tables the application writes.
--
-- BACKWARD COMPATIBILITY: every pre-existing column keeps its name and scalar
-- type, so the four route handlers that read this view and lib/alfred/allowed-tables.ts
-- continue to work unchanged. The scalar *_client_id columns now carry a
-- DETERMINISTIC pick (previously an arbitrary max()); the full sets are added
-- alongside as *_client_ids arrays with counts, so callers that need every link
-- have a way to get it without breaking those that do not.
--
-- Idempotent: create or replace, so dependent grants are preserved.
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/391_fix_master_client_mapping_view.sql

create or replace view public.master_client_mapping as
with
  -- ── ProConnect, read natively ──────────────────────────────────────────
  -- ORGANIZATION WINS when both hub columns are set (the firm's canonical
  -- rule, per scripts/378). Today 0 rows have both, so coalesce is a no-op
  -- guard against a future writer setting both.
  pc_links as (
    select
      coalesce(p.hub_organization_id, p.hub_contact_id) as internal_client_id,
      p.proconnect_client_id,
      p.created_at
    from public.proconnect_clients p
    where coalesce(p.hub_organization_id, p.hub_contact_id) is not null
      and p.proconnect_client_id is not null
  ),
  pc as (
    select
      internal_client_id,
      -- Deterministic scalar pick: earliest-created link, tie-broken by id.
      (array_agg(proconnect_client_id order by created_at, proconnect_client_id))[1]
        as proconnect_client_id,
      array_agg(distinct proconnect_client_id)      as proconnect_client_ids,
      count(distinct proconnect_client_id)::int     as proconnect_link_count
    from pc_links
    group by internal_client_id
  ),
  -- ── Ignition, read natively (ORGANIZATION WINS) ────────────────────────
  ig_links as (
    select
      coalesce(i.organization_id, i.contact_id) as internal_client_id,
      i.ignition_client_id,
      i.created_at
    from public.ignition_clients i
    where coalesce(i.organization_id, i.contact_id) is not null
      and i.ignition_client_id is not null
  ),
  ig_agg as (
    select
      internal_client_id,
      (array_agg(ignition_client_id order by created_at, ignition_client_id))[1]
        as ignition_client_id,
      array_agg(distinct ignition_client_id)    as ignition_client_ids,
      count(distinct ignition_client_id)::int   as ignition_link_count
    from ig_links
    group by internal_client_id
  )
-- ── People (contacts) ───────────────────────────────────────────────────
select
  ct.id                                     as internal_client_id,
  'PERSON'::text                            as client_type,
  coalesce(
    nullif(trim(ct.full_name), ''),
    nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), ''),
    '(unnamed)'
  )                                         as display_name,
  ct.primary_email                          as primary_email,
  ct.karbon_contact_key                     as karbon_client_id,
  ig_agg.ignition_client_id                 as ignition_client_id,
  pc.proconnect_client_id                   as proconnect_client_id,
  ct.karbon_url                             as karbon_url,
  array_remove(array[
    case when ct.karbon_contact_key        is not null then 'KARBON'     end,
    case when ig_agg.ignition_client_id    is not null then 'IGNITION'   end,
    case when pc.proconnect_client_id      is not null then 'PROCONNECT' end
  ], null)                                  as linked_systems,
  (
    (case when ct.karbon_contact_key     is not null then 1 else 0 end) +
    (case when ig_agg.ignition_client_id is not null then 1 else 0 end) +
    (case when pc.proconnect_client_id   is not null then 1 else 0 end)
  )                                         as link_count,
  ct.created_at                             as created_at,
  ct.updated_at                             as updated_at,
  ig.state                                  as ignition_state,
  ig.external_client_id                     as ignition_external_client_id,
  ig.xero_contact_id                        as xero_contact_id,
  ig.qbo_customer_id                        as qbo_customer_id,
  ig.manager_name                           as ignition_manager_name,
  ig.manager_email                          as ignition_manager_email,
  ig.partner_name                           as ignition_partner_name,
  ig.partner_email                          as ignition_partner_email,
  ig.tags                                   as ignition_tags,
  ig.group_name                             as ignition_group_name,
  ig.ignition_url                           as ignition_url,
  ct.user_defined_identifier                as karbon_user_defined_identifier,
  -- New: the complete link sets, so nothing is hidden by the scalar pick.
  coalesce(pc.proconnect_client_ids, '{}')     as proconnect_client_ids,
  coalesce(pc.proconnect_link_count, 0)        as proconnect_link_count,
  coalesce(ig_agg.ignition_client_ids, '{}')   as ignition_client_ids,
  coalesce(ig_agg.ignition_link_count, 0)      as ignition_link_count
from public.contacts ct
left join pc     on pc.internal_client_id     = ct.id
left join ig_agg on ig_agg.internal_client_id = ct.id
left join public.ignition_clients ig
  on ig.ignition_client_id = ig_agg.ignition_client_id

union all

-- ── Organizations ───────────────────────────────────────────────────────
select
  o.id                                      as internal_client_id,
  'ORGANIZATION'::text                      as client_type,
  coalesce(nullif(trim(o.name), ''), '(unnamed)')
                                            as display_name,
  o.primary_email                           as primary_email,
  o.karbon_organization_key                 as karbon_client_id,
  ig_agg.ignition_client_id                 as ignition_client_id,
  pc.proconnect_client_id                   as proconnect_client_id,
  o.karbon_url                              as karbon_url,
  array_remove(array[
    case when o.karbon_organization_key  is not null then 'KARBON'     end,
    case when ig_agg.ignition_client_id  is not null then 'IGNITION'   end,
    case when pc.proconnect_client_id    is not null then 'PROCONNECT' end
  ], null)                                  as linked_systems,
  (
    (case when o.karbon_organization_key is not null then 1 else 0 end) +
    (case when ig_agg.ignition_client_id is not null then 1 else 0 end) +
    (case when pc.proconnect_client_id   is not null then 1 else 0 end)
  )                                         as link_count,
  o.created_at                              as created_at,
  o.updated_at                              as updated_at,
  ig.state                                  as ignition_state,
  ig.external_client_id                     as ignition_external_client_id,
  ig.xero_contact_id                        as xero_contact_id,
  ig.qbo_customer_id                        as qbo_customer_id,
  ig.manager_name                           as ignition_manager_name,
  ig.manager_email                          as ignition_manager_email,
  ig.partner_name                           as ignition_partner_name,
  ig.partner_email                          as ignition_partner_email,
  ig.tags                                   as ignition_tags,
  ig.group_name                             as ignition_group_name,
  ig.ignition_url                           as ignition_url,
  o.user_defined_identifier                 as karbon_user_defined_identifier,
  coalesce(pc.proconnect_client_ids, '{}')     as proconnect_client_ids,
  coalesce(pc.proconnect_link_count, 0)        as proconnect_link_count,
  coalesce(ig_agg.ignition_client_ids, '{}')   as ignition_client_ids,
  coalesce(ig_agg.ignition_link_count, 0)      as ignition_link_count
from public.organizations o
left join pc     on pc.internal_client_id     = o.id
left join ig_agg on ig_agg.internal_client_id = o.id
left join public.ignition_clients ig
  on ig.ignition_client_id = ig_agg.ignition_client_id;

comment on view public.master_client_mapping is
  'One row per Motta Hub client (contacts + organizations, anchored on the uuid). '
  'Karbon, Ignition and ProConnect identifiers are all read NATIVELY off the '
  'columns the application writes (contacts.karbon_contact_key / '
  'organizations.karbon_organization_key, ignition_clients.contact_id|organization_id, '
  'proconnect_clients.hub_contact_id|hub_organization_id) rather than from '
  'client_mapping, which no live write path maintains. ORGANIZATION WINS when an '
  'external record links to both a person and their company. The scalar '
  '*_client_id columns are a deterministic earliest-created pick; *_client_ids '
  'arrays and *_link_count expose every link, because clients legitimately hold '
  'several ProConnect (spouse/entity returns) and Ignition records. '
  'See scripts/391_fix_master_client_mapping_view.sql.';
