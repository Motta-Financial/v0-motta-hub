-- 377: Import ALL Ignition Reporting API fields into the ignition_* tables.
--
-- Source of truth: the Ignition Reporting API OpenAPI spec (api1.json,
-- https://developers.ignitionapp.com/external/api/v1). Every field the API
-- exposes that wasn't already materialised as a column is added here, and
-- then BACKFILLED from the raw_payload JSONB that every sync run has been
-- stashing since day one — so historical rows get the new fields with zero
-- API round-trips. lib/ignition/sync.ts populates the same columns on every
-- future sync.
--
-- All changes are additive (ADD COLUMN IF NOT EXISTS) — nothing is renamed,
-- dropped, or retyped, so existing views/queries are untouched.

-- ────────────────────────────────────────────────────────────────────────
-- 1. ignition_clients  ← /reporting/clients (ClientDetail)
--    New identity keys for the master mapping: external_client_id,
--    xero_contact_id, qbo_customer_id. Plus servicing assignments
--    (manager/partner), tags, group and lifecycle state.
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_clients
  add column if not exists state               text,
  add column if not exists external_client_id  text,
  add column if not exists xero_contact_id     text,
  add column if not exists qbo_customer_id     bigint,
  add column if not exists manager_name        text,
  add column if not exists manager_email       text,
  add column if not exists partner_name        text,
  add column if not exists partner_email       text,
  add column if not exists tags                text[],
  add column if not exists group_name          text,
  add column if not exists ignition_url        text;

comment on column public.ignition_clients.state is
  'Ignition client lifecycle state: lead | active | inactive | archived';
comment on column public.ignition_clients.external_client_id is
  'User-assigned external identifier in Ignition — cross-system join key';
comment on column public.ignition_clients.xero_contact_id is
  'Xero contact ID mapped to this client in Ignition — cross-system join key';
comment on column public.ignition_clients.qbo_customer_id is
  'QuickBooks Online customer ID mapped to this client in Ignition — cross-system join key';

update public.ignition_clients set
  state              = coalesce(state,              raw_payload->>'state'),
  external_client_id = coalesce(external_client_id, nullif(raw_payload->>'external_client_id','')),
  xero_contact_id    = coalesce(xero_contact_id,    nullif(raw_payload->>'xero_contact_id','')),
  qbo_customer_id    = coalesce(qbo_customer_id,
                         case when raw_payload->>'qbo_customer_id' ~ '^\d+$'
                              then (raw_payload->>'qbo_customer_id')::bigint end),
  manager_name       = coalesce(manager_name,  raw_payload->'manager'->>'name'),
  manager_email      = coalesce(manager_email, raw_payload->'manager'->>'email'),
  partner_name       = coalesce(partner_name,  raw_payload->'partner'->>'name'),
  partner_email      = coalesce(partner_email, raw_payload->'partner'->>'email'),
  tags               = coalesce(tags,
                         case when jsonb_typeof(raw_payload->'tags') = 'array'
                              then (select array_agg(t) from jsonb_array_elements_text(raw_payload->'tags') t) end),
  group_name         = coalesce(group_name, raw_payload->>'group_name'),
  ignition_url       = coalesce(ignition_url, raw_payload->>'link')
where raw_payload is not null;

create index if not exists idx_ignition_clients_qbo_customer_id
  on public.ignition_clients (qbo_customer_id) where qbo_customer_id is not null;
create index if not exists idx_ignition_clients_xero_contact_id
  on public.ignition_clients (xero_contact_id) where xero_contact_id is not null;
create index if not exists idx_ignition_clients_external_client_id
  on public.ignition_clients (external_client_id) where external_client_id is not null;
create index if not exists idx_ignition_clients_state
  on public.ignition_clients (state) where state is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 2. ignition_contacts  ← /reporting/contacts (ContactDetail)
--    Contact roles matter for engagement letters and invoicing:
--    is_signatory / is_invoice_recipient / is_primary.
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_contacts
  add column if not exists ignition_numeric_id  bigint,
  add column if not exists mobile               text,
  add column if not exists salutation           text,
  add column if not exists addressee            text,
  add column if not exists is_primary           boolean,
  add column if not exists is_signatory         boolean,
  add column if not exists is_invoice_recipient boolean,
  add column if not exists ignition_url         text;

update public.ignition_contacts set
  ignition_numeric_id  = coalesce(ignition_numeric_id,
                           case when raw_payload->>'id' ~ '^\d+$' then (raw_payload->>'id')::bigint end),
  mobile               = coalesce(mobile,     raw_payload->>'mobile'),
  salutation           = coalesce(salutation, raw_payload->>'salutation'),
  addressee            = coalesce(addressee,  raw_payload->>'addressee'),
  is_primary           = coalesce(is_primary,           (raw_payload->>'is_primary')::boolean),
  is_signatory         = coalesce(is_signatory,         (raw_payload->>'is_signatory')::boolean),
  is_invoice_recipient = coalesce(is_invoice_recipient, (raw_payload->>'is_invoice_recipient')::boolean),
  ignition_url         = coalesce(ignition_url, raw_payload->>'link')
where raw_payload is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 3. ignition_deals  ← /reporting/deals (DealDetail)
--    Pipeline analytics fields: stage position/win-likelihood, projected
--    value + its source, time-in-stage and time-to-close.
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_deals
  add column if not exists priority                 text,
  add column if not exists stage_position           integer,
  add column if not exists stage_win_likelihood     numeric,
  add column if not exists client_name              text,
  add column if not exists external_client_id       text,
  add column if not exists linked_proposal_slug     text,
  add column if not exists projected_value          numeric,
  add column if not exists projected_value_currency text,
  add column if not exists projected_value_source   text,
  add column if not exists current_stage_started_at timestamptz,
  add column if not exists seconds_to_close         bigint,
  add column if not exists ignition_url             text;

update public.ignition_deals set
  priority                 = coalesce(priority,   raw_payload->>'priority'),
  stage_position           = coalesce(stage_position,
                               case when raw_payload->>'stage_position' ~ '^-?\d+$'
                                    then (raw_payload->>'stage_position')::integer end),
  stage_win_likelihood     = coalesce(stage_win_likelihood,
                               case when raw_payload->>'stage_win_likelihood' ~ '^-?\d+(\.\d+)?$'
                                    then (raw_payload->>'stage_win_likelihood')::numeric end),
  client_name              = coalesce(client_name, raw_payload->>'client_name'),
  external_client_id       = coalesce(external_client_id, nullif(raw_payload->>'external_client_id','')),
  linked_proposal_slug     = coalesce(linked_proposal_slug, raw_payload->>'linked_proposal_slug'),
  projected_value          = coalesce(projected_value,
                               case when raw_payload->'projected_value'->>'amount' ~ '^-?\d+(\.\d+)?$'
                                    then (raw_payload->'projected_value'->>'amount')::numeric end),
  projected_value_currency = coalesce(projected_value_currency, raw_payload->'projected_value'->>'currency'),
  projected_value_source   = coalesce(projected_value_source, raw_payload->>'projected_value_source'),
  current_stage_started_at = coalesce(current_stage_started_at,
                               nullif(raw_payload->>'current_stage_started_at','')::timestamptz),
  seconds_to_close         = coalesce(seconds_to_close,
                               case when raw_payload->>'seconds_to_close' ~ '^\d+$'
                                    then (raw_payload->>'seconds_to_close')::bigint end),
  ignition_url             = coalesce(ignition_url, raw_payload->>'link')
where raw_payload is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 4. ignition_deal_stages  ← /reporting/deal_stages (DealStageDetail)
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_deal_stages
  add column if not exists win_likelihood          numeric,
  add column if not exists inactive_threshold_days integer;

update public.ignition_deal_stages set
  win_likelihood          = coalesce(win_likelihood,
                              case when raw_payload->>'win_likelihood' ~ '^-?\d+(\.\d+)?$'
                                   then (raw_payload->>'win_likelihood')::numeric end),
  inactive_threshold_days = coalesce(inactive_threshold_days,
                              case when raw_payload->>'inactive_threshold_days' ~ '^\d+$'
                                   then (raw_payload->>'inactive_threshold_days')::integer end)
where raw_payload is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 5. ignition_services  ← /reporting/services (ServiceDetail)
--    Full pricing model (price_type, unit, min/max), catalog grouping and
--    library category, tax rate, and origin.
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_services
  add column if not exists state                 text,
  add column if not exists price_type            text,
  add column if not exists billing_mode          text,
  add column if not exists unit_name             text,
  add column if not exists min_price             numeric,
  add column if not exists max_price             numeric,
  add column if not exists tax_rate              text,
  add column if not exists service_group_slug    text,
  add column if not exists service_group_name    text,
  add column if not exists service_category_slug text,
  add column if not exists service_category_name text,
  add column if not exists service_origin        text,
  add column if not exists ignition_url          text,
  add column if not exists ignition_created_at   timestamptz,
  add column if not exists ignition_updated_at   timestamptz;

update public.ignition_services set
  state                 = coalesce(state,        raw_payload->>'state'),
  price_type            = coalesce(price_type,   raw_payload->>'price_type'),
  billing_mode          = coalesce(billing_mode, raw_payload->>'billing_mode'),
  unit_name             = coalesce(unit_name,    raw_payload->>'unit_name'),
  min_price             = coalesce(min_price,
                            case when raw_payload->>'min_price' ~ '^-?\d+(\.\d+)?$'
                                 then (raw_payload->>'min_price')::numeric end),
  max_price             = coalesce(max_price,
                            case when raw_payload->>'max_price' ~ '^-?\d+(\.\d+)?$'
                                 then (raw_payload->>'max_price')::numeric end),
  tax_rate              = coalesce(tax_rate, raw_payload->>'tax_rate'),
  service_group_slug    = coalesce(service_group_slug, raw_payload->'service_group'->>'slug'),
  service_group_name    = coalesce(service_group_name,
                            raw_payload->>'service_group_name',
                            raw_payload->'service_group'->>'name'),
  service_category_slug = coalesce(service_category_slug, raw_payload->'service_category'->>'slug'),
  service_category_name = coalesce(service_category_name, raw_payload->'service_category'->>'name'),
  service_origin        = coalesce(service_origin, raw_payload->>'service_origin'),
  ignition_url          = coalesce(ignition_url, raw_payload->>'link'),
  ignition_created_at   = coalesce(ignition_created_at, nullif(raw_payload->>'created_at','')::timestamptz),
  ignition_updated_at   = coalesce(ignition_updated_at, nullif(raw_payload->>'updated_at','')::timestamptz)
where raw_payload is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 6. ignition_proposals  ← /reporting/proposals (ProposalDetail)
--    Contract framing (term, min length, start/end), client tags at
--    proposal time, creator, and the external client id.
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_proposals
  add column if not exists external_client_id      text,
  add column if not exists client_tags             text[],
  add column if not exists contract_term           text,
  add column if not exists minimum_contract_length integer,
  add column if not exists proposal_start_type     text,
  add column if not exists proposal_start_date     date,
  add column if not exists proposal_end_date       date,
  add column if not exists created_by              text,
  add column if not exists ignition_url            text;

update public.ignition_proposals set
  external_client_id      = coalesce(external_client_id, nullif(raw_payload->>'external_client_id','')),
  client_tags             = coalesce(client_tags,
                              case when jsonb_typeof(raw_payload->'client_tags') = 'array'
                                   then (select array_agg(t) from jsonb_array_elements_text(raw_payload->'client_tags') t) end),
  contract_term           = coalesce(contract_term, raw_payload->>'contract_term'),
  minimum_contract_length = coalesce(minimum_contract_length,
                              case when raw_payload->>'minimum_contract_length' ~ '^\d+$'
                                   then (raw_payload->>'minimum_contract_length')::integer end),
  proposal_start_type     = coalesce(proposal_start_type, raw_payload->>'proposal_start_type'),
  proposal_start_date     = coalesce(proposal_start_date, nullif(raw_payload->>'proposal_start_date','')::date),
  proposal_end_date       = coalesce(proposal_end_date,   nullif(raw_payload->>'proposal_end_date','')::date),
  created_by              = coalesce(created_by, raw_payload->'creator'->>'name'),
  ignition_url            = coalesce(ignition_url, raw_payload->>'link')
where raw_payload is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 7. ignition_proposal_services  ← ProposalDetail.services[]
--    Line-level slug, acceptance/add-on flags, invoice strategy, price
--    type, billing summary + full schedules, and the service category.
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_proposal_services
  add column if not exists line_slug                  text,
  add column if not exists invoice_strategy           text,
  add column if not exists price_type                 text,
  add column if not exists is_add_on                  boolean,
  add column if not exists is_selected_for_acceptance boolean,
  add column if not exists is_recurring               boolean,
  add column if not exists billing_summary            text,
  add column if not exists billing_schedules          jsonb,
  add column if not exists position                   integer,
  add column if not exists service_category_slug      text,
  add column if not exists service_category_name      text;

update public.ignition_proposal_services set
  line_slug                  = coalesce(line_slug, raw_payload->>'slug'),
  invoice_strategy           = coalesce(invoice_strategy, raw_payload->>'invoice_strategy'),
  price_type                 = coalesce(price_type, raw_payload->'pricing'->>'price_type'),
  is_add_on                  = coalesce(is_add_on, (raw_payload->>'is_add_on')::boolean),
  is_selected_for_acceptance = coalesce(is_selected_for_acceptance,
                                 (raw_payload->>'is_selected_for_acceptance')::boolean),
  is_recurring               = coalesce(is_recurring, (raw_payload->'billing'->>'is_recurring')::boolean),
  billing_summary            = coalesce(billing_summary, raw_payload->'billing'->>'summary'),
  billing_schedules          = coalesce(billing_schedules,
                                 case when jsonb_typeof(raw_payload->'billing'->'schedules') = 'array'
                                      then raw_payload->'billing'->'schedules' end),
  position                   = coalesce(position,
                                 case when raw_payload->>'position' ~ '^-?\d+$'
                                      then (raw_payload->>'position')::integer end),
  service_category_slug      = coalesce(service_category_slug, raw_payload->'service_category'->>'slug'),
  service_category_name      = coalesce(service_category_name, raw_payload->'service_category'->>'name')
where raw_payload is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 8. ignition_invoices  ← /reporting/invoices (InvoiceDetail)
--    Payment lifecycle (payment_state/date/method/source/reference), line
--    items, accounting-system deployment info, disbursal linkage, memo.
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_invoices
  add column if not exists reference           text,
  add column if not exists billing_reference   text,
  add column if not exists payment_state       text,
  add column if not exists payment_date        date,
  add column if not exists surcharge           numeric,
  add column if not exists items               jsonb,
  add column if not exists issued_by_name      text,
  add column if not exists issued_by_email     text,
  add column if not exists source              text,
  add column if not exists payment_method_type text,
  add column if not exists payment_source      text,
  add column if not exists payment_reference   text,
  add column if not exists memo                text,
  add column if not exists deployment          jsonb,
  add column if not exists disbursal_id        text,
  add column if not exists disbursal_state     text,
  add column if not exists ignition_url        text,
  add column if not exists ignition_created_at timestamptz,
  add column if not exists ignition_updated_at timestamptz;

comment on column public.ignition_invoices.payment_state is
  'Ignition invoice payment state: unpaid | partially_paid | paid';

update public.ignition_invoices set
  reference           = coalesce(reference, raw_payload->>'reference'),
  billing_reference   = coalesce(billing_reference, raw_payload->>'billing_reference'),
  payment_state       = coalesce(payment_state, raw_payload->>'payment_state'),
  payment_date        = coalesce(payment_date, nullif(raw_payload->>'payment_date','')::date),
  surcharge           = coalesce(surcharge,
                          case when raw_payload->'amount'->>'surcharge' ~ '^-?\d+(\.\d+)?$'
                               then (raw_payload->'amount'->>'surcharge')::numeric end),
  items               = coalesce(items,
                          case when jsonb_typeof(raw_payload->'items') = 'array'
                               then raw_payload->'items' end),
  issued_by_name      = coalesce(issued_by_name,  raw_payload->'issued_by'->>'name'),
  issued_by_email     = coalesce(issued_by_email, raw_payload->'issued_by'->>'email'),
  source              = coalesce(source, raw_payload->>'source'),
  payment_method_type = coalesce(payment_method_type, raw_payload->>'payment_method_type'),
  payment_source      = coalesce(payment_source, raw_payload->>'payment_source'),
  payment_reference   = coalesce(payment_reference, raw_payload->>'payment_reference'),
  memo                = coalesce(memo, raw_payload->>'memo'),
  deployment          = coalesce(deployment,
                          case when jsonb_typeof(raw_payload->'deployment') = 'object'
                               then raw_payload->'deployment' end),
  disbursal_id        = coalesce(disbursal_id,    raw_payload->'disbursal'->>'id'),
  disbursal_state     = coalesce(disbursal_state, raw_payload->'disbursal'->>'state'),
  ignition_url        = coalesce(ignition_url, raw_payload->>'link'),
  ignition_created_at = coalesce(ignition_created_at, nullif(raw_payload->>'created_at','')::timestamptz),
  ignition_updated_at = coalesce(ignition_updated_at, nullif(raw_payload->>'updated_at','')::timestamptz)
where raw_payload is not null;

create index if not exists idx_ignition_invoices_payment_state
  on public.ignition_invoices (payment_state) where payment_state is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 9. ignition_payments  ← /reporting/payments (PaymentDetail)
--    Funds-availability date, collection/disbursal linkage, surcharge,
--    and ALL linked invoice slugs (a payment can span invoices).
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_payments
  add column if not exists available_on        date,
  add column if not exists disbursal_id        text,
  add column if not exists disbursal_state     text,
  add column if not exists collection_type     text,
  add column if not exists surcharge           numeric,
  add column if not exists invoice_slugs       text[],
  add column if not exists ignition_url        text,
  add column if not exists ignition_created_at timestamptz;

update public.ignition_payments set
  available_on        = coalesce(available_on, nullif(raw_payload->>'available_on','')::date),
  disbursal_id        = coalesce(disbursal_id,    raw_payload->'disbursal'->>'id'),
  disbursal_state     = coalesce(disbursal_state, raw_payload->'disbursal'->>'state'),
  collection_type     = coalesce(collection_type, raw_payload->'collection'->>'type'),
  surcharge           = coalesce(surcharge,
                          case when raw_payload->'amount'->>'surcharge' ~ '^-?\d+(\.\d+)?$'
                               then (raw_payload->'amount'->>'surcharge')::numeric end),
  invoice_slugs       = coalesce(invoice_slugs,
                          case when jsonb_typeof(raw_payload->'invoices') = 'array'
                               then (select array_agg(inv->>'slug')
                                     from jsonb_array_elements(raw_payload->'invoices') inv
                                     where inv->>'slug' is not null) end),
  ignition_url        = coalesce(ignition_url, raw_payload->>'link'),
  ignition_created_at = coalesce(ignition_created_at, nullif(raw_payload->>'created_at','')::timestamptz)
where raw_payload is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 10. ignition_payment_transactions  ← /reporting/collections
--     (PaymentCollection | Clawback rows). Adds the client/invoice slugs
--     (real join keys — previously only free-text names were kept), fee
--     detail, disbursal state/dates, and — critically — raw_payload,
--     which this table never had.
-- ────────────────────────────────────────────────────────────────────────
alter table public.ignition_payment_transactions
  add column if not exists client_slug              text,
  add column if not exists external_client_id       text,
  add column if not exists invoice_slug             text,
  add column if not exists fee_description          text,
  add column if not exists fee_invoice_date         date,
  add column if not exists disbursal_state          text,
  add column if not exists disbursal_submitted_date date,
  add column if not exists disbursal_arrival_date   date,
  add column if not exists raw_payload              jsonb;

create index if not exists idx_ignition_payment_transactions_client_slug
  on public.ignition_payment_transactions (client_slug) where client_slug is not null;

-- No raw_payload backfill possible here — the column is new and historical
-- rows never stored the raw response. The next collections sync repopulates
-- every row (upsert on transaction_id) including these columns.
