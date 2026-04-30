-- ============================================================================
-- Karbon ↔ Supabase live sync infrastructure
-- ============================================================================
-- Creates the webhook event/subscription tables, the outbound write-back queue
-- (kept idle until KARBON_TWO_WAY_SYNC=true), and enables Supabase Realtime on
-- the synced Karbon tables that aren't already published.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Webhook subscriptions registry
-- ----------------------------------------------------------------------------
-- One row per Karbon WebhookSubscription we manage. Used by the watchdog cron
-- to detect subs Karbon dropped (after 10 failed deliveries Karbon cancels the
-- sub) and recreate them.
create table if not exists karbon_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  webhook_type text not null check (webhook_type in
    ('Contact','Work','Note','User','IntegrationTask','Invoice','EstimateSummary','CustomField')),
  karbon_subscription_id text unique,
  target_url text not null,
  signing_key_configured boolean not null default false,
  status text not null default 'active' check (status in ('active','paused','expired','failed')),
  last_event_at timestamptz,
  failure_count int not null default 0,
  last_failure_at timestamptz,
  last_failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists karbon_webhook_subscriptions_type_idx
  on karbon_webhook_subscriptions (webhook_type);

-- ----------------------------------------------------------------------------
-- 2. Webhook event log (with idempotency)
-- ----------------------------------------------------------------------------
create table if not exists karbon_webhook_events (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  action_type text not null,
  resource_perma_key text not null,
  parent_entity_key text,
  client_key text,
  client_type text,
  event_timestamp timestamptz not null,
  raw_payload jsonb not null,
  signature_valid boolean,
  processed_at timestamptz,
  processing_status text not null default 'pending'
    check (processing_status in ('pending','processing','succeeded','failed','skipped','duplicate')),
  processing_error text,
  retry_count int not null default 0,
  received_at timestamptz not null default now()
);

-- Idempotency: Karbon retries failed deliveries up to 10 times. The tuple
-- (resource_perma_key, action_type, event_timestamp) uniquely identifies a
-- logical event regardless of how many times Karbon redelivers it. The receiver
-- catches the unique-violation and short-circuits with status='duplicate'.
create unique index if not exists karbon_webhook_events_dedup_idx
  on karbon_webhook_events (resource_perma_key, action_type, event_timestamp);

-- Used by the replay worker
create index if not exists karbon_webhook_events_unprocessed_idx
  on karbon_webhook_events (processing_status, received_at)
  where processing_status in ('pending','failed');

-- Used by the admin UI
create index if not exists karbon_webhook_events_recent_idx
  on karbon_webhook_events (received_at desc);

-- ----------------------------------------------------------------------------
-- 3. Outbound write-back queue (idle until two-way sync is enabled)
-- ----------------------------------------------------------------------------
create table if not exists karbon_outbound_changes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in
    ('contact','organization','client_group','work_item','note','invoice')),
  supabase_row_id uuid,
  karbon_key text,
  change_payload jsonb not null,
  origin_user_id uuid,
  status text not null default 'pending'
    check (status in ('pending','processing','succeeded','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists karbon_outbound_changes_pending_idx
  on karbon_outbound_changes (status, created_at)
  where status in ('pending','failed');

-- ----------------------------------------------------------------------------
-- 4. Enable Realtime publication on the Karbon tables that aren't already published
-- ----------------------------------------------------------------------------
-- (work_items, contacts, organizations, client_groups, team_members are already
-- published per existing project state — only adding karbon_notes, karbon_tasks,
-- karbon_invoices.)
do $$
begin
  begin
    alter publication supabase_realtime add table karbon_notes;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table karbon_tasks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table karbon_invoices;
  exception when duplicate_object then null;
  end;
end$$;

-- ----------------------------------------------------------------------------
-- 5. RLS — read-only-via-service-role tables (admin operates these)
-- ----------------------------------------------------------------------------
alter table karbon_webhook_subscriptions enable row level security;
alter table karbon_webhook_events enable row level security;
alter table karbon_outbound_changes enable row level security;

-- Server uses the service role key, which bypasses RLS. Authenticated users
-- (admins) can read for observability via the admin UI.
do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename='karbon_webhook_subscriptions' and policyname='authenticated_can_read') then
    create policy authenticated_can_read on karbon_webhook_subscriptions
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies
                 where tablename='karbon_webhook_events' and policyname='authenticated_can_read') then
    create policy authenticated_can_read on karbon_webhook_events
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies
                 where tablename='karbon_outbound_changes' and policyname='authenticated_can_read') then
    create policy authenticated_can_read on karbon_outbound_changes
      for select to authenticated using (true);
  end if;
end$$;
