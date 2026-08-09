-- 393: Build client_profile_summaries for every Hub master client.
--
-- WHY THIS EXISTS
-- The cache held 1 row for 2,191 clients. The cause was not a missing cron —
-- computeClientProfile() was structurally unable to write an organization:
-- its organizations branch selected a `tags` column that does not exist, so
-- PostgREST rejected the select, `o` came back null, and the function returned
-- before its UPSERT. Every one of the 731 organizations failed that way, and
-- the one surviving row is a contact. lib/clients/profile.ts is fixed
-- separately; this script does the bulk build, which the per-client TS path
-- cannot reasonably do (it issues ~13 round trips per client — ~28,000 requests
-- against production for a full pass, versus one statement over ~14,700 rows).
--
-- CORRECTNESS FIXES BAKED IN (each measured against production)
--  1. ORG-WINS PRECEDENCE. computeClientProfile filters facts by contact_id for
--     contacts and organization_id for organizations, so a fact row carrying
--     BOTH FKs was counted on two profiles. Measured double-counting: 9
--     work_items, 2 debriefs, 55 ignition_proposals, 28 ignition_invoices, 81
--     ignition_clients — $109,759 of proposal value and $11,975 of invoice
--     value booked twice. Here every fact is attributed to
--     coalesce(organization_id, contact_id), i.e. the organization wins, which
--     is the firm's canonical rule (scripts/378).
--  2. LIFETIME REVENUE comes from ignition_invoices.payment_state, which is the
--     only column that reconciles. Three plausible sources were tried and
--     measured against the book before settling on it:
--       * amount_paid alone        -> $337,658  (72% understated)
--       * + the ignition_payments ledger -> $1,197,517 (still $17,422 short:
--         payments sit in 'uncollected'/'cancelled' states, and some paid
--         invoices have no payment row at all)
--       * payment_state            -> $1,218,909 firm-wide, RECONCILES
--     The 1,918 invoices with status='issued' and payment_state='paid'
--     ($886,401.00) carry amount_paid = 0 AND amount_outstanding = 0, which is
--     what defeats the first two approaches. Voided/archived/draft are excluded
--     (they held $5,150.50 of amount_paid that was previously counted).
--  3. INVOICES OUTSTANDING is billed minus collected, which follows from the
--     same rule: $103,336 firm-wide, $102,687 client-attributed. Neither raw
--     column works on its own — amount_outstanding is 0 on every 'issued' row
--     (so summing it erases $20,394 of genuinely unpaid 'issued'/'unpaid'
--     invoices), while the old total-minus-amount_paid form booked the whole
--     $886k of collected 'issued' billing as receivable ($985,118, an 8x
--     overstatement that fired a false "$X outstanding" reason on 322 clients).
--     Verification identity, firm-wide:
--       billed 1,322,244.59 = collected 1,218,908.89 + owed 103,335.70
--  4. KARBON INVOICE PAID TEST is an exact allow-list, not /paid/i — that
--     regex also matches 'Unpaid' and 'PartiallyPaid', both real Karbon
--     statuses. (No impact today: karbon_invoices holds 3 rows, all null
--     status, $0. It is a landmine for when that sync turns on.)
--  5. CANCELLED CALENDLY EVENTS are excluded from total_calendly_events. The
--     TS filtered them out of last/next_meeting_at but counted them in the
--     total, so the count and the timestamps disagreed. 9 of the pre-existing
--     53 links point at cancelled events.
--
-- KNOWN-EMPTY FIELDS, recorded honestly rather than faked
--  * client_owner_name / client_manager_name resolve for 2 of 2,191 clients.
--    work_items.client_owner_id is set on 0 of 3,866 rows and client_owner_name
--    on 37; contacts.client_owner_id and organizations.client_owner_key are
--    empty. There is nothing to derive these from — it is a source-data gap.
--  * open_action_items equals TOTAL action items, because none of the 160 items
--    on file carries a status/completed key. It cannot decrease until a writer
--    stamps completion.
--
-- Idempotent: ON CONFLICT (client_id, client_kind) DO UPDATE recomputes in
-- place from the same inputs. Touches no source table. search_name and
-- search_email are GENERATED ALWAYS STORED and are correctly omitted.
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/393_backfill_client_profile_summaries.sql

insert into public.client_profile_summaries (
  client_id, client_kind, display_name, client_type, primary_email, phone_primary,
  city, state, status, is_prospect,
  legacy_motta_client_id, karbon_contact_key, karbon_organization_key,
  ignition_client_id, proconnect_client_id, user_defined_identifier,
  client_owner_id, client_owner_name, client_manager_id, client_manager_name,
  total_work_items, open_work_items, completed_work_items, overdue_work_items,
  next_due_date, next_due_work_item_title, next_due_work_item_id, active_work_types,
  total_debriefs, last_debrief_date, last_debrief_type, last_debrief_notes,
  last_debrief_id, open_action_items,
  total_calendly_events, total_zoom_meetings, last_meeting_at, next_meeting_at,
  total_proposals, active_proposals, proposals_total_value, proposals_recurring_total,
  recurring_frequency,
  total_invoices, invoices_total, invoices_paid, invoices_outstanding,
  last_invoice_date, last_payment_date, lifetime_revenue,
  tags, ai_summary, ai_keywords,
  profile_completeness, needs_attention, attention_reasons,
  computed_at, stale_at
)
with
-- ── Every master client, with identity ──────────────────────────────────
base as (
  select
    c.id                                     as client_id,
    'contact'::text                          as client_kind,
    coalesce(nullif(trim(c.full_name), ''),
             nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '')) as display_name,
    c.contact_type                           as client_type,
    c.primary_email, c.phone_primary, c.city, c.state, c.status,
    coalesce(c.is_prospect, false)           as is_prospect,
    c.legacy_motta_client_id,
    c.karbon_contact_key,
    null::text                               as karbon_organization_key,
    c.user_defined_identifier,
    c.client_owner_id, c.client_manager_id,
    coalesce(c.tags, '{}')                   as tags,
    c.first_name, c.last_name,
    null::text                               as business_name
  from public.contacts c
  union all
  select
    o.id, 'organization',
    coalesce(nullif(trim(o.name), ''), nullif(trim(o.legal_name), '')),
    o.entity_type,
    o.primary_email, o.phone, o.city, o.state, o.status,
    false,
    -- organizations carries none of these three columns
    null::text, null::text,
    o.karbon_organization_key,
    o.user_defined_identifier,
    null::uuid, null::uuid,
    '{}'::text[],
    null::text, null::text,
    coalesce(nullif(trim(o.name), ''), nullif(trim(o.legal_name), ''))
  from public.organizations o
),
-- ── Cross-system identifiers, read natively (ORG WINS, deterministic pick) ─
pc as (
  select coalesce(hub_organization_id, hub_contact_id) as client_id,
         (array_agg(proconnect_client_id order by created_at, proconnect_client_id))[1] as proconnect_client_id
  from public.proconnect_clients
  where coalesce(hub_organization_id, hub_contact_id) is not null
    and proconnect_client_id is not null
  group by 1
),
ig as (
  select coalesce(organization_id, contact_id) as client_id,
         (array_agg(ignition_client_id order by created_at, ignition_client_id))[1] as ignition_client_id
  from public.ignition_clients
  where coalesce(organization_id, contact_id) is not null
    and ignition_client_id is not null
  group by 1
),
-- ── Work items (org wins) ───────────────────────────────────────────────
wi as (
  select coalesce(organization_id, contact_id) as client_id,
         id, title, work_type, primary_status, due_date, completed_date,
         client_owner_name, client_manager_name,
         (completed_date is null
          and lower(coalesce(primary_status, '')) <> 'completed') as is_open
  from public.work_items
  where coalesce(organization_id, contact_id) is not null
),
wi_agg as (
  select client_id,
         count(*)::int                                              as total_work_items,
         count(*) filter (where is_open)::int                        as open_work_items,
         count(*) filter (where completed_date is not null)::int     as completed_work_items,
         count(*) filter (where is_open and due_date < current_date)::int as overdue_work_items,
         coalesce(array_agg(distinct work_type)
                    filter (where is_open and work_type is not null), '{}') as active_work_types,
         -- Deterministic owner/manager pick (modal would be equivalent here:
         -- 0 clients have work items that disagree on a non-null value).
         (array_agg(client_owner_name order by (client_owner_name is null), due_date nulls last))[1]   as client_owner_name,
         (array_agg(client_manager_name order by (client_manager_name is null), due_date nulls last))[1] as client_manager_name
  from wi group by client_id
),
-- Next due: soonest upcoming open item, else soonest overdue open item.
wi_next as (
  select distinct on (client_id) client_id, id, title, due_date
  from wi
  where is_open and due_date is not null
  order by client_id, (due_date >= current_date) desc, due_date
),
-- ── Debriefs (org wins) ─────────────────────────────────────────────────
db as (
  select coalesce(organization_id, contact_id) as client_id,
         id, debrief_date, debrief_type, notes, action_items
  from public.debriefs
  where coalesce(organization_id, contact_id) is not null
    and deleted_at is null
),
db_agg as (
  select client_id, count(*)::int as total_debriefs from db group by client_id
),
db_last as (
  select distinct on (client_id) client_id, id, debrief_date, debrief_type, notes
  from db order by client_id, debrief_date desc nulls last, id
),
-- Action items are objects in action_items->'items'. None carries a status key
-- today, so every item counts as open; the guard is future-proofed anyway.
db_items as (
  select d.client_id, count(*)::int as open_action_items
  from db d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.action_items -> 'items') = 'array'
         then d.action_items -> 'items' else '[]'::jsonb end) as it
  where coalesce(it ->> 'status', '') not in ('completed', 'done')
    and coalesce(it ->> 'completed', 'false') <> 'true'
    and (it ->> 'completed_at') is null
  group by d.client_id
),
-- ── Meetings ────────────────────────────────────────────────────────────
cal as (
  select coalesce(ec.organization_id, ec.contact_id) as client_id,
         e.start_time, e.status
  from public.calendly_event_clients ec
  join public.calendly_events e on e.id = ec.calendly_event_id
  where coalesce(ec.organization_id, ec.contact_id) is not null
),
zoom as (
  select coalesce(zc.organization_id, zc.contact_id) as client_id,
         m.start_time, m.status
  from public.zoom_meeting_clients zc
  join public.zoom_meetings m on m.id = zc.zoom_meeting_id
  where coalesce(zc.organization_id, zc.contact_id) is not null
),
cal_agg as (
  -- Cancelled events are excluded from BOTH the count and the timestamps.
  select client_id, count(*)::int as total_calendly_events
  from cal where not (status is not null and status ~* 'cancel') group by client_id
),
zoom_agg as (
  select client_id, count(*)::int as total_zoom_meetings from zoom group by client_id
),
meet as (
  select client_id, start_time from cal
    where start_time is not null and not (status is not null and status ~* 'cancel')
  union all
  select client_id, start_time from zoom where start_time is not null
),
meet_agg as (
  select client_id,
         max(start_time) filter (where start_time <= now()) as last_meeting_at,
         min(start_time) filter (where start_time >  now()) as next_meeting_at
  from meet group by client_id
),
-- ── Proposals (org wins) ────────────────────────────────────────────────
prop as (
  select coalesce(organization_id, contact_id) as client_id,
         status, total_value, recurring_total, recurring_frequency
  from public.ignition_proposals
  where coalesce(organization_id, contact_id) is not null
),
prop_agg as (
  select client_id,
         count(*)::int as total_proposals,
         count(*) filter (where status ~* 'accepted|active|in_progress|signed')::int as active_proposals,
         coalesce(sum(coalesce(total_value, 0)), 0) as proposals_total_value,
         coalesce(sum(coalesce(recurring_total, 0))
                    filter (where status ~* 'accepted|active|in_progress|signed'), 0) as proposals_recurring_total
  from prop group by client_id
),
prop_freq as (
  select distinct on (client_id) client_id, recurring_frequency
  from (
    select client_id, recurring_frequency, count(*) n
    from prop
    where status ~* 'accepted|active|in_progress|signed' and recurring_frequency is not null
    group by 1, 2
  ) f order by client_id, n desc, recurring_frequency
),
-- ── Payments, only for their timestamp ──────────────────────────────────
-- Used purely to date a collection where the invoice has no paid_at. The
-- payments ledger is NOT used for the amount: it lags the invoice's own
-- payment_state by $17,422.50 firm-wide (payments in 'uncollected' and
-- 'cancelled' states, plus paid invoices with no payment row at all).
pay_per_inv as (
  select ignition_invoice_id, max(paid_at) as last_paid_at
  from public.ignition_payments
  where lower(coalesce(payment_status, '')) in ('disbursed', 'collected')
    and ignition_invoice_id is not null
  group by 1
),
-- ── Invoices: Karbon + Ignition, excluding dead statuses ────────────────
inv as (
  select coalesce(organization_id, contact_id) as client_id,
         coalesce(total_amount, 0) as amount,
         case when replace(replace(lower(coalesce(status, '')), ' ', ''), '_', '')
                   in ('paid', 'paidinfull', 'fullypaid')
              then coalesce(total_amount, 0) else 0 end as collected,
         issued_date    as issued,
         paid_date::timestamptz as paid_at
  from public.karbon_invoices
  where coalesce(organization_id, contact_id) is not null
  union all
  select coalesce(i.organization_id, i.contact_id),
         coalesce(i.amount, 0),
         -- ignition_invoices.payment_state is Ignition's authoritative
         -- collection flag, and it is the ONLY column that yields a
         -- reconciling figure. The 1,918 rows with status='issued' and
         -- payment_state='paid' ($886,401.00 collected) carry amount_paid = 0
         -- AND amount_outstanding = 0, so:
         --   * summing amount_paid alone understates revenue by $886k
         --   * summing amount_outstanding alone erases their remainder
         --   * netting the payments ledger understates by $17,422.50
         -- Reading payment_state first reconciles exactly, firm-wide:
         --   billed 1,322,244.59 = collected 1,218,908.89 + owed 103,335.70
         case when lower(coalesce(i.payment_state, '')) = 'paid'
                then coalesce(i.amount, 0)
              when lower(coalesce(i.status, '')) = 'paid'
                then coalesce(i.amount_paid, i.amount, 0)
              else 0 end,
         i.invoice_date,
         case when lower(coalesce(i.payment_state, '')) = 'paid'
                or lower(coalesce(i.status, '')) = 'paid'
              then coalesce(i.paid_at, pp.last_paid_at) end
  from public.ignition_invoices i
  left join pay_per_inv pp on pp.ignition_invoice_id = i.ignition_invoice_id
  where coalesce(i.organization_id, i.contact_id) is not null
    and lower(coalesce(i.status, '')) not in ('voided', 'archived', 'draft')
),
inv_agg as (
  select client_id,
         count(*)::int as total_invoices,
         coalesce(sum(amount), 0)    as invoices_total,
         coalesce(sum(collected), 0) as invoices_paid,
         -- Billed minus collected. No partial collections exist in the data
         -- (amount_paid is either 0 or the full amount on every row), so the
         -- binary rule above is exact; revisit if Ignition starts recording
         -- part-payments.
         greatest(0, coalesce(sum(amount), 0) - coalesce(sum(collected), 0))
           as invoices_outstanding,
         max(issued)  as last_invoice_date,
         max(paid_at) as last_payment_at
  from inv group by client_id
),
-- ── Assemble ────────────────────────────────────────────────────────────
assembled as (
  select
    b.*,
    ig.ignition_client_id,
    pc.proconnect_client_id,
    coalesce(w.total_work_items, 0)     as total_work_items,
    coalesce(w.open_work_items, 0)      as open_work_items,
    coalesce(w.completed_work_items, 0) as completed_work_items,
    coalesce(w.overdue_work_items, 0)   as overdue_work_items,
    coalesce(w.active_work_types, '{}') as active_work_types,
    w.client_owner_name, w.client_manager_name,
    wn.due_date as next_due_date, wn.title as next_due_work_item_title, wn.id as next_due_work_item_id,
    coalesce(da.total_debriefs, 0) as total_debriefs,
    dl.debrief_date as last_debrief_date, dl.debrief_type as last_debrief_type,
    left(dl.notes, 500) as last_debrief_notes, dl.id as last_debrief_id,
    coalesce(di.open_action_items, 0) as open_action_items,
    coalesce(ca.total_calendly_events, 0) as total_calendly_events,
    coalesce(za.total_zoom_meetings, 0)   as total_zoom_meetings,
    ma.last_meeting_at, ma.next_meeting_at,
    coalesce(pa.total_proposals, 0) as total_proposals,
    coalesce(pa.active_proposals, 0) as active_proposals,
    coalesce(pa.proposals_total_value, 0) as proposals_total_value,
    coalesce(pa.proposals_recurring_total, 0) as proposals_recurring_total,
    pf.recurring_frequency,
    coalesce(ia.total_invoices, 0) as total_invoices,
    coalesce(ia.invoices_total, 0) as invoices_total,
    coalesce(ia.invoices_paid, 0)  as invoices_paid,
    coalesce(ia.invoices_outstanding, 0) as invoices_outstanding,
    ia.last_invoice_date,
    -- last_payment_date is DATE, but the collection timestamps are timestamptz
    -- (karbon.paid_date is promoted by the union), so cast explicitly.
    ia.last_payment_at::date as last_payment_date
  from base b
  left join pc      on pc.client_id  = b.client_id
  left join ig      on ig.client_id  = b.client_id
  left join wi_agg  w  on w.client_id  = b.client_id
  left join wi_next wn on wn.client_id = b.client_id
  left join db_agg  da on da.client_id = b.client_id
  left join db_last dl on dl.client_id = b.client_id
  left join db_items di on di.client_id = b.client_id
  left join cal_agg ca on ca.client_id = b.client_id
  left join zoom_agg za on za.client_id = b.client_id
  left join meet_agg ma on ma.client_id = b.client_id
  left join prop_agg pa on pa.client_id = b.client_id
  left join prop_freq pf on pf.client_id = b.client_id
  left join inv_agg ia on ia.client_id = b.client_id
),
scored as (
  select a.*,
    -- Same weights as lib/clients/profile.ts (20/15/10/10/15/10/10/10).
    least(100,
      (case when a.display_name  is not null then 20 else 0 end) +
      (case when a.primary_email is not null then 15 else 0 end) +
      (case when a.phone_primary is not null then 10 else 0 end) +
      (case when a.legacy_motta_client_id is not null then 10 else 0 end) +
      (case when a.total_work_items > 0 then 15 else 0 end) +
      (case when a.total_debriefs   > 0 then 10 else 0 end) +
      (case when a.total_invoices   > 0 then 10 else 0 end) +
      (case when a.client_owner_name is not null or a.client_manager_name is not null then 10 else 0 end)
    ) as profile_completeness,
    array_remove(array[
      case when a.primary_email is null then 'Missing email' end,
      case when a.phone_primary is null then 'Missing phone' end,
      case when a.overdue_work_items > 0
           then a.overdue_work_items || ' overdue work item(s)' end,
      case when a.open_action_items > 0
           then a.open_action_items || ' open action item(s)' end,
      case when a.invoices_outstanding > 0
           then '$' || to_char(a.invoices_outstanding, 'FM999,999,999.00') || ' outstanding' end,
      case when a.client_owner_name is null and a.client_manager_name is null
           then 'No owner/manager assigned' end
    ], null) as attention_reasons
  from assembled a
)
select
  s.client_id, s.client_kind,
  coalesce(s.display_name, '(unnamed)'), s.client_type, s.primary_email, s.phone_primary,
  s.city, s.state, s.status, s.is_prospect,
  s.legacy_motta_client_id, s.karbon_contact_key, s.karbon_organization_key,
  s.ignition_client_id, s.proconnect_client_id, s.user_defined_identifier,
  s.client_owner_id, s.client_owner_name, s.client_manager_id, s.client_manager_name,
  s.total_work_items, s.open_work_items, s.completed_work_items, s.overdue_work_items,
  s.next_due_date, s.next_due_work_item_title, s.next_due_work_item_id, s.active_work_types,
  s.total_debriefs, s.last_debrief_date, s.last_debrief_type, s.last_debrief_notes,
  s.last_debrief_id, s.open_action_items,
  s.total_calendly_events, s.total_zoom_meetings, s.last_meeting_at, s.next_meeting_at,
  s.total_proposals, s.active_proposals, s.proposals_total_value, s.proposals_recurring_total,
  s.recurring_frequency,
  s.total_invoices, s.invoices_total, s.invoices_paid, s.invoices_outstanding,
  s.last_invoice_date, s.last_payment_date,
  s.invoices_paid as lifetime_revenue,
  s.tags,
  -- ai_summary mirrors generateAiSummary()'s sentence order.
  concat_ws(' ',
    coalesce(s.display_name, case when s.client_kind='organization' then 'This organization' else 'This client' end)
      || ' is a' || case when s.is_prospect then ' prospect.'
                        when s.client_kind='organization' then 'n organization.'
                        else 'n individual client.' end,
    case when s.open_work_items > 0
         then s.open_work_items || ' open work item' || case when s.open_work_items=1 then '' else 's' end || '.' end,
    case when s.next_due_work_item_title is not null and s.next_due_date is not null
         then 'Next due: "' || s.next_due_work_item_title || '" on ' || s.next_due_date || '.' end,
    case when s.active_proposals > 0
         then s.active_proposals || ' active proposal' || case when s.active_proposals=1 then '' else 's' end || '.' end,
    case when s.invoices_paid > 0
         then 'Lifetime revenue: $' || to_char(round(s.invoices_paid), 'FM999,999,999') || '.' end,
    case when s.client_owner_name is not null then 'Owner: ' || s.client_owner_name || '.' end,
    case when s.last_meeting_at is not null
         then 'Last meeting: ' || to_char(s.last_meeting_at, 'YYYY-MM-DD') || '.' end,
    case when s.total_debriefs > 0
         then s.total_debriefs || ' debrief' || case when s.total_debriefs=1 then '' else 's' end || ' on file.' end
  ) as ai_summary,
  -- ai_keywords: lowercased word set over name parts, geography, work types, tags.
  (select coalesce(array_agg(distinct kw), '{}')
   from unnest(
     string_to_array(
       lower(trim(regexp_replace(
         concat_ws(' ', s.first_name, s.last_name, s.business_name, s.state, s.city,
                   array_to_string(s.active_work_types, ' '),
                   array_to_string(s.tags, ' ')),
         '\s+', ' ', 'g'))), ' ')) as kw
   where kw <> '') as ai_keywords,
  s.profile_completeness,
  coalesce(array_length(s.attention_reasons, 1), 0) > 0 as needs_attention,
  s.attention_reasons,
  now() as computed_at,
  null::timestamptz as stale_at
from scored s
on conflict (client_id, client_kind) do update set
  display_name = excluded.display_name,
  client_type = excluded.client_type,
  primary_email = excluded.primary_email,
  phone_primary = excluded.phone_primary,
  city = excluded.city,
  state = excluded.state,
  status = excluded.status,
  is_prospect = excluded.is_prospect,
  legacy_motta_client_id = excluded.legacy_motta_client_id,
  karbon_contact_key = excluded.karbon_contact_key,
  karbon_organization_key = excluded.karbon_organization_key,
  ignition_client_id = excluded.ignition_client_id,
  proconnect_client_id = excluded.proconnect_client_id,
  user_defined_identifier = excluded.user_defined_identifier,
  client_owner_id = excluded.client_owner_id,
  client_owner_name = excluded.client_owner_name,
  client_manager_id = excluded.client_manager_id,
  client_manager_name = excluded.client_manager_name,
  total_work_items = excluded.total_work_items,
  open_work_items = excluded.open_work_items,
  completed_work_items = excluded.completed_work_items,
  overdue_work_items = excluded.overdue_work_items,
  next_due_date = excluded.next_due_date,
  next_due_work_item_title = excluded.next_due_work_item_title,
  next_due_work_item_id = excluded.next_due_work_item_id,
  active_work_types = excluded.active_work_types,
  total_debriefs = excluded.total_debriefs,
  last_debrief_date = excluded.last_debrief_date,
  last_debrief_type = excluded.last_debrief_type,
  last_debrief_notes = excluded.last_debrief_notes,
  last_debrief_id = excluded.last_debrief_id,
  open_action_items = excluded.open_action_items,
  total_calendly_events = excluded.total_calendly_events,
  total_zoom_meetings = excluded.total_zoom_meetings,
  last_meeting_at = excluded.last_meeting_at,
  next_meeting_at = excluded.next_meeting_at,
  total_proposals = excluded.total_proposals,
  active_proposals = excluded.active_proposals,
  proposals_total_value = excluded.proposals_total_value,
  proposals_recurring_total = excluded.proposals_recurring_total,
  recurring_frequency = excluded.recurring_frequency,
  total_invoices = excluded.total_invoices,
  invoices_total = excluded.invoices_total,
  invoices_paid = excluded.invoices_paid,
  invoices_outstanding = excluded.invoices_outstanding,
  last_invoice_date = excluded.last_invoice_date,
  last_payment_date = excluded.last_payment_date,
  lifetime_revenue = excluded.lifetime_revenue,
  tags = excluded.tags,
  ai_summary = excluded.ai_summary,
  ai_keywords = excluded.ai_keywords,
  profile_completeness = excluded.profile_completeness,
  needs_attention = excluded.needs_attention,
  attention_reasons = excluded.attention_reasons,
  computed_at = excluded.computed_at,
  stale_at = null;
