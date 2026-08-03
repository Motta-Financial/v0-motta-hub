-- Stripe Checkout — Hub-native service-package pay links
-- Migration 345: net-new payment surface that lets staff send a client a
-- branded pay link for a fixed service package, collect the payment through
-- Stripe Checkout (embedded), and record the result.
--
-- This is DISTINCT from the existing Ignition payment feed:
--   * `ignition_payments` / `ignition_invoices` are READ-ONLY projections of
--     payments that already flowed through Ignition (which uses Stripe under
--     the hood). They are displayed at /payments and deep-link to Stripe.
--   * The tables below are the Hub INITIATING a charge itself. They never
--     collide with the Ignition names.
--
-- Design rules (see v0_plans/deep-guide.md + Stripe skill):
--   * Amounts are ALWAYS validated server-side from `service_packages`. The
--     client only ever sends a pay-link token, never a price.
--   * Stripe Product/Price IDs are CACHED on our rows and created lazily on
--     first use, so the catalog is editable in the Hub without a Stripe round
--     trip per render.
--   * All tables are service-role only — there are NO anon RLS policies on
--     `public.*` (PII-leak rule). The public pay page reads through the Hub
--     `/api/public/pay/*` routes, never anon Supabase.
--   * One-time is built first; `recurring` columns are present from day one so
--     subscriptions slot in without a schema change.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. service_packages — the firm-owned payable catalog
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.service_packages (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  -- Price snapshot in the smallest currency unit (cents). Source of truth for
  -- what we charge; the cached Stripe price is derived from this.
  price_cents         integer not null check (price_cents >= 0),
  currency            text not null default 'usd',
  -- 'one_time' | 'recurring'
  billing_type        text not null default 'one_time'
                        check (billing_type in ('one_time', 'recurring')),
  -- For recurring only: 'month' | 'quarter' | 'year' (null for one_time).
  recurring_interval  text
                        check (recurring_interval in ('month', 'quarter', 'year')),
  -- Cached Stripe objects (created lazily on first checkout). Nullable until
  -- first synced; a price change nulls stripe_price_id so a new one is minted.
  stripe_product_id   text,
  stripe_price_id     text,
  active              boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A recurring package MUST declare an interval; a one_time MUST NOT.
  constraint service_packages_interval_consistency check (
    (billing_type = 'recurring' and recurring_interval is not null) or
    (billing_type = 'one_time'  and recurring_interval is null)
  )
);

comment on table public.service_packages is
  'Firm-owned catalog of fixed-price services that clients can pay for via a Hub pay link. Distinct from the read-only Ignition `services` analytics.';

create index if not exists service_packages_active_idx
  on public.service_packages (active, sort_order);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. payment_requests — one row per "please pay" link
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.payment_requests (
  id                          uuid primary key default gen_random_uuid(),
  -- URL-safe random token embedded in /embed/pay/<token>. Unique + indexed.
  token                       text not null unique,
  service_package_id          uuid references public.service_packages(id) on delete restrict,
  -- Master Hub contact this charge is for (canonical identifier).
  contact_id                  uuid references public.contacts(id) on delete set null,
  organization_id             uuid references public.organizations(id) on delete set null,
  -- Snapshot of name/amount at creation so historical links stay accurate even
  -- if the catalog later changes. `amount_cents` may differ from the package
  -- price if a staffer overrides it (e.g. a partial deposit).
  package_name                text not null,
  amount_cents                integer not null check (amount_cents >= 0),
  currency                    text not null default 'usd',
  billing_type                text not null default 'one_time'
                                check (billing_type in ('one_time', 'recurring')),
  recurring_interval          text
                                check (recurring_interval in ('month', 'quarter', 'year')),
  -- 'pending' | 'paid' | 'canceled' | 'expired'
  status                      text not null default 'pending'
                                check (status in ('pending', 'paid', 'canceled', 'expired')),
  memo                        text,
  -- Where to email the link (snapshot; defaults to the contact's email).
  recipient_email             text,
  recipient_name              text,
  -- Stripe linkage, populated as the flow progresses.
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,
  stripe_subscription_id      text,
  stripe_customer_id          text,
  created_by_team_member_id   uuid references public.team_members(id) on delete set null,
  expires_at                  timestamptz,
  paid_at                     timestamptz,
  last_emailed_at             timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.payment_requests is
  'One row per Hub-issued pay link. Amount is snapshotted at creation; the public pay page rebuilds the Stripe session from this row server-side.';

create index if not exists payment_requests_status_idx
  on public.payment_requests (status, created_at desc);
create index if not exists payment_requests_contact_idx
  on public.payment_requests (contact_id);
create index if not exists payment_requests_session_idx
  on public.payment_requests (stripe_checkout_session_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. stripe_payments — confirmed payment ledger
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.stripe_payments (
  id                          uuid primary key default gen_random_uuid(),
  payment_request_id          uuid references public.payment_requests(id) on delete set null,
  -- Idempotency anchor: the Stripe event id we processed. Unique so a
  -- redelivered webhook can't double-insert.
  stripe_event_id             text unique,
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,
  stripe_invoice_id           text,
  stripe_subscription_id      text,
  stripe_customer_id          text,
  amount_cents                integer,
  currency                    text default 'usd',
  -- 'succeeded' | 'processing' | 'refunded' | 'failed'
  status                      text not null default 'succeeded',
  customer_email              text,
  -- Full Stripe object for forensics / reconciliation.
  raw                         jsonb,
  created_at                  timestamptz not null default now()
);

comment on table public.stripe_payments is
  'Confirmed payments collected through Hub-issued pay links. Written only by the signature-verified Stripe webhook. Named to avoid colliding with the Ignition `ignition_payments` view.';

create index if not exists stripe_payments_request_idx
  on public.stripe_payments (payment_request_id);
create index if not exists stripe_payments_intent_idx
  on public.stripe_payments (stripe_payment_intent_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. stripe_customers — map a Hub contact to a reusable Stripe Customer
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.stripe_customers (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid references public.contacts(id) on delete cascade,
  organization_id     uuid references public.organizations(id) on delete cascade,
  stripe_customer_id  text not null unique,
  email               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.stripe_customers is
  'Maps a master Hub contact/organization to its Stripe Customer so repeat payers reuse one customer record (and so subscriptions can be managed).';

create unique index if not exists stripe_customers_contact_uidx
  on public.stripe_customers (contact_id) where contact_id is not null;
create unique index if not exists stripe_customers_org_uidx
  on public.stripe_customers (organization_id) where organization_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS: enable + service-role only. NO anon/auth policies — every read/write
-- goes through Hub server code using the service-role key, exactly like the
-- other operational tables. (Adding anon policies here is how PII leaks.)
-- ─────────────────────────────────────────────────────────────────────────
alter table public.service_packages enable row level security;
alter table public.payment_requests enable row level security;
alter table public.stripe_payments  enable row level security;
alter table public.stripe_customers enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at touch trigger (reuse the existing helper if present, else create)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists service_packages_touch on public.service_packages;
create trigger service_packages_touch before update on public.service_packages
  for each row execute function public.touch_updated_at();

drop trigger if exists payment_requests_touch on public.payment_requests;
create trigger payment_requests_touch before update on public.payment_requests
  for each row execute function public.touch_updated_at();

drop trigger if exists stripe_customers_touch on public.stripe_customers;
create trigger stripe_customers_touch before update on public.stripe_customers
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Seed a few starter packages (idempotent). Prices are placeholders the firm
-- can edit in the Hub. Mix of one-time and recurring to exercise both paths.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.service_packages
  (name, description, price_cents, billing_type, recurring_interval, sort_order)
values
  ('Individual Tax Return (1040)',
   'Preparation and filing of a personal federal + state individual income tax return.',
   75000, 'one_time', null, 10),
  ('Business Tax Return',
   'Preparation and filing of a business income tax return (1120 / 1120-S / 1065).',
   150000, 'one_time', null, 20),
  ('Tax Planning Session',
   'A focused strategy session to reduce your tax liability and plan ahead.',
   40000, 'one_time', null, 30),
  ('Engagement Deposit',
   'Initial deposit to begin work on your engagement, credited toward your final invoice.',
   50000, 'one_time', null, 40),
  ('Monthly Bookkeeping',
   'Ongoing monthly bookkeeping, reconciliation, and financial statements.',
   60000, 'recurring', 'month', 50),
  ('Quarterly Advisory Retainer',
   'Quarterly advisory and CFO-style guidance retainer.',
   250000, 'recurring', 'quarter', 60)
on conflict do nothing;
