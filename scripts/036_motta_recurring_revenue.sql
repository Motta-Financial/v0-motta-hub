-- ────────────────────────────────────────────────────────────────────────
-- 036_motta_recurring_revenue.sql
--
-- Curated source-of-truth for Motta Financial monthly recurring revenue.
-- Seeded from two CSVs maintained by the Accounting and Tax leads:
--   • Recurring Accounting_Detail (csv_accounting_2026)
--   • Recurring Revenue_Tax       (csv_tax_2026)
--
-- This list is the authoritative answer to the question
-- "is this client actually on a recurring engagement?". The Ignition
-- proposal feed flags many one-time engagements as "recurring" because the
-- platform allows monthly billing schedules on fixed-fee work; we use this
-- table to scrub the dashboard / proposals / overview surfaces and to
-- power the dedicated /sales/recurring-revenue page.
--
-- The script is idempotent: re-running it will TRUNCATE and reseed.
-- ────────────────────────────────────────────────────────────────────────

create table if not exists motta_recurring_revenue (
  id uuid primary key default gen_random_uuid(),
  department text not null check (department in ('Accounting','Tax')),
  service_type text not null,
  client_name text not null,
  -- Generated normalized form so we can match against ignition_proposals.client_name
  -- and organizations.name without worrying about punctuation / casing.
  normalized_name text generated always as (
    lower(regexp_replace(client_name, '[^a-zA-Z0-9]+', '', 'g'))
  ) stored,
  cadence text not null check (cadence in ('Monthly','Quarterly')),
  service_fee numeric(12,2) not null default 0,    -- fee per cadence period
  one_time_fee numeric(12,2) not null default 0,
  client_group text,
  client_status text default 'Client',
  source text not null,                             -- 'csv_accounting_2026' | 'csv_tax_2026'
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists motta_recurring_revenue_normalized_idx
  on motta_recurring_revenue (normalized_name);
create index if not exists motta_recurring_revenue_department_idx
  on motta_recurring_revenue (department);
create index if not exists motta_recurring_revenue_service_type_idx
  on motta_recurring_revenue (service_type);

alter table motta_recurring_revenue enable row level security;
drop policy if exists motta_recurring_revenue_read on motta_recurring_revenue;
create policy motta_recurring_revenue_read on motta_recurring_revenue
  for select to authenticated using (true);

-- Reset & seed
truncate table motta_recurring_revenue;

insert into motta_recurring_revenue
  (department, service_type, client_name, cadence, service_fee, one_time_fee, source)
values
  -- ── Accounting › Acct Fees ($10/mo each) ────────────────────────────
  ('Accounting','Acct Fees','Advance Enterprises LLC','Monthly',10,0,'csv_accounting_2026'),
  ('Accounting','Acct Fees','CGC Consulting Solutions','Monthly',10,0,'csv_accounting_2026'),
  ('Accounting','Acct Fees','InSPIRe Alliance, LLC','Monthly',10,0,'csv_accounting_2026'),
  ('Accounting','Acct Fees','M3 Ranch LLC','Monthly',10,0,'csv_accounting_2026'),
  ('Accounting','Acct Fees','Symmetry Chiropractic (MHP)','Monthly',10,0,'csv_accounting_2026'),
  ('Accounting','Acct Fees','Synergy Green River Building (SRGB)','Monthly',10,0,'csv_accounting_2026'),
  ('Accounting','Acct Fees','Trailhead Properties LLC','Monthly',10,0,'csv_accounting_2026'),

  -- ── Accounting › Bookkeeping ────────────────────────────────────────
  ('Accounting','Bookkeeping','Adzemen Demolition','Monthly',250,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','411 Claims Restoration','Monthly',150,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Buffaloes Tires','Monthly',750,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Compassionate Recovery Solutions','Monthly',99,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Dalton & The Sheriffs','Monthly',500,8000,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Debian Guys LLC','Monthly',350,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Giang Enterprises','Monthly',450,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Halifax Nails and Spa','Monthly',450,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Harlow Contracting','Monthly',99,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Harrison Hunter CFP','Monthly',149,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','JJV Trucking','Monthly',650,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Matt Coleman Plumbing','Monthly',250,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Monteforte Law','Monthly',500,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Motta Wealth Management','Monthly',99,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Ola Swim Academy','Monthly',250,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Positive Pathways Mental Health','Monthly',75,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','RISEilience','Monthly',499,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','The Elden House','Monthly',400,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','VerEstate Title','Monthly',750,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','LVTD','Monthly',400,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Maggie Mey','Monthly',125,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Ola Mate','Monthly',300,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Scordio Productions','Monthly',400,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Stable Conference','Monthly',1000,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','This Week in Fintech','Monthly',500,750,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Renegade Contracting Solutions','Monthly',399,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Advance Therapy','Monthly',500,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Alliance Physical Therapy','Monthly',900,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Nielson Family Chiropractic','Monthly',1200,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Synergy Rehab Bridgeport','Monthly',300,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Synergy Rehab Evanston','Monthly',300,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Synergy Rehab Solutions, LLC','Monthly',300,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Unified Medical Billing','Monthly',150,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Three Point Insurance','Monthly',300,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Three Point Mortgage','Monthly',298.80,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','E 27th Ave','Monthly',150,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Elmira 1460 LLC','Monthly',149,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Home Connection Group','Monthly',750,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','Sunny Eye Shop LLC','Monthly',400,0,'csv_accounting_2026'),
  ('Accounting','Bookkeeping','DJV Inc.','Monthly',400,0,'csv_accounting_2026'),

  -- ── Accounting › Payroll ────────────────────────────────────────────
  ('Accounting','Payroll','Renegade Contracting Solutions','Monthly',175,0,'csv_accounting_2026'),
  ('Accounting','Payroll','Compassionate Recovery Solutions','Monthly',99,0,'csv_accounting_2026'),
  ('Accounting','Payroll','Debian Guys LLC','Monthly',150,0,'csv_accounting_2026'),
  ('Accounting','Payroll','Positive Pathways Mental Health','Monthly',50,0,'csv_accounting_2026'),
  ('Accounting','Payroll','Unabridged MD','Monthly',99,0,'csv_accounting_2026'),
  ('Accounting','Payroll','TLL Medical Transport','Monthly',500,0,'csv_accounting_2026'),
  ('Accounting','Payroll','Halifax Nails & Spa','Monthly',225,0,'csv_accounting_2026'),

  -- ── Accounting › Cash Flow Advisory ─────────────────────────────────
  ('Accounting','Cash Flow Advisory','Adzemen Demolition','Monthly',800,0,'csv_accounting_2026'),

  -- ── Accounting › FP&A ───────────────────────────────────────────────
  ('Accounting','FP&A','Three Point Mortgage','Monthly',500,0,'csv_accounting_2026'),
  ('Accounting','FP&A','TLL Medical Transport','Monthly',500,0,'csv_accounting_2026'),

  -- ── Accounting › Controller ─────────────────────────────────────────
  ('Accounting','Controller','Milestone Mortgage Solutions','Monthly',4000,7500,'csv_accounting_2026'),

  -- ── Accounting › CFO Services ───────────────────────────────────────
  ('Accounting','CFO Services','TLL Medical Transport','Monthly',3500,0,'csv_accounting_2026'),

  -- ── Tax › Advisory (Monthly) ────────────────────────────────────────
  ('Tax','Advisory','Iacomini, Cam','Monthly',1000,0,'csv_tax_2026'),
  ('Tax','Advisory','Sismanopoulos, Nikolos','Monthly',200,0,'csv_tax_2026'),
  ('Tax','Advisory','Apex Estimators','Monthly',1050,0,'csv_tax_2026'),
  ('Tax','Advisory','Debian Guys LLC','Monthly',100,0,'csv_tax_2026'),
  ('Tax','Advisory','Gavan, Jason & Vamsi','Monthly',654,0,'csv_tax_2026'),
  ('Tax','Advisory','Model FA','Monthly',0,1400,'csv_tax_2026'),

  -- ── Tax › Tax Estimates (Quarterly) ─────────────────────────────────
  ('Tax','Tax Estimates','Denver Hair Party','Quarterly',50,250,'csv_tax_2026'),
  ('Tax','Tax Estimates','Matt Coleman Plumbing & Heating Inc','Quarterly',99,0,'csv_tax_2026'),
  ('Tax','Tax Estimates','Paul McCurdy DVM','Quarterly',75,0,'csv_tax_2026');

-- Convenience view: per-client roll-up across service types so the dashboard
-- doesn't need to do this aggregation in TS on every render.
create or replace view motta_recurring_revenue_by_client as
select
  department,
  client_name,
  normalized_name,
  string_agg(distinct service_type, ', ' order by service_type) as service_types,
  bool_or(cadence = 'Monthly')                        as has_monthly,
  bool_or(cadence = 'Quarterly')                      as has_quarterly,
  -- Monthly recurring revenue contribution (quarterly fees ÷ 3)
  sum(
    case
      when cadence = 'Monthly'   then service_fee
      when cadence = 'Quarterly' then service_fee / 3.0
      else 0
    end
  )::numeric(12,2) as mrr,
  -- Annualized recurring revenue
  sum(
    case
      when cadence = 'Monthly'   then service_fee * 12
      when cadence = 'Quarterly' then service_fee * 4
      else 0
    end
  )::numeric(12,2) as arr,
  sum(one_time_fee)::numeric(12,2) as one_time_total,
  count(*) as service_line_count
from motta_recurring_revenue
group by department, client_name, normalized_name;
