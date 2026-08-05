-- 385: Calendly integration optimization — make the real-time path
-- provably alive, capture every Calendly resource in Supabase, and fix
-- the duplicate `meetings` mirror.
--
-- Context (integration audit 2026-08-05):
--   · Webhook subscriptions exist at Calendly but deliveries have been
--     rejected 401 for months: the endpoint requires a signed payload and
--     the subscriptions were registered without (or with a different)
--     signing key. Nothing proves delivery because the webhook receiver
--     never wrote to calendly_webhook_events.
--   · calendly_webhook_subscriptions / calendly_webhook_events existed
--     but were never written by any code path.
--   · Routing forms + submissions had no Supabase home at all — the
--     webhook dumped them into a notification row.
--   · lib/calendly-sync.ts mirrored meetings keyed by the CALENDLY uuid
--     while lib/meetings/sync-hub-meetings.ts keys by the INTERNAL
--     calendly_events.id — producing duplicate meetings rows (46 found).

-- ── 1. Webhook subscription bookkeeping ─────────────────────────────────
-- The signing key registered with a subscription can never be read back
-- from Calendly, so we store a SHA-256 fingerprint of the key we used at
-- creation time. If the fingerprint on file doesn't match the fingerprint
-- of the key the receiver verifies with, the subscription is provably
-- broken and gets recreated by the self-healing pass in the cron sync.
alter table public.calendly_webhook_subscriptions
  add column if not exists signing_key_fingerprint text,
  add column if not exists last_verified_at timestamptz;

-- ── 2. Webhook delivery ledger ──────────────────────────────────────────
-- Every delivery is now recorded (idempotently). dedupe_key collapses
-- Calendly's retries AND dual delivery when both an org-scope and a
-- user-scope subscription cover the same event.
alter table public.calendly_webhook_events
  add column if not exists dedupe_key text;

create unique index if not exists calendly_webhook_events_dedupe_uniq
  on public.calendly_webhook_events (dedupe_key)
  where dedupe_key is not null;

-- ── 3. Routing forms + submissions ──────────────────────────────────────
create table if not exists public.calendly_routing_forms (
  id                  uuid primary key default gen_random_uuid(),
  calendly_uuid       text unique not null,
  calendly_uri        text not null,
  organization_uri    text,
  name                text,
  status              text,
  questions           jsonb,
  raw_data            jsonb,
  calendly_created_at timestamptz,
  calendly_updated_at timestamptz,
  synced_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.calendly_routing_form_submissions (
  id                    uuid primary key default gen_random_uuid(),
  calendly_uuid         text unique not null,
  calendly_uri          text not null,
  routing_form_uri      text,
  routing_form_id       uuid references public.calendly_routing_forms(id) on delete set null,
  -- URI of the invitee created when the submission routed to a booking
  -- page and the visitor completed it; null for external/custom-message
  -- outcomes. Joinable to calendly_invitees.routing_form_submission_uri.
  submitter_uri         text,
  submitter_type        text,
  questions_and_answers jsonb,
  tracking              jsonb,
  result                jsonb,
  contact_id            uuid references public.contacts(id) on delete set null,
  raw_data              jsonb,
  calendly_created_at   timestamptz,
  calendly_updated_at   timestamptz,
  synced_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists calendly_routing_form_submissions_form
  on public.calendly_routing_form_submissions (routing_form_uri);
create index if not exists calendly_routing_form_submissions_submitter
  on public.calendly_routing_form_submissions (submitter_uri);
create index if not exists calendly_routing_form_submissions_contact
  on public.calendly_routing_form_submissions (contact_id);

alter table public.calendly_routing_forms enable row level security;
drop policy if exists calendly_routing_forms_staff on public.calendly_routing_forms;
create policy calendly_routing_forms_staff on public.calendly_routing_forms
  for all
  using ((select auth.role()) in ('authenticated', 'service_role'))
  with check ((select auth.role()) in ('authenticated', 'service_role'));

alter table public.calendly_routing_form_submissions enable row level security;
drop policy if exists calendly_routing_form_submissions_staff on public.calendly_routing_form_submissions;
create policy calendly_routing_form_submissions_staff on public.calendly_routing_form_submissions
  for all
  using ((select auth.role()) in ('authenticated', 'service_role'))
  with check ((select auth.role()) in ('authenticated', 'service_role'));

-- ── 4. Sync log detail blob ─────────────────────────────────────────────
-- Carries the new per-run counters (routing forms, org-wide catch-all
-- events, webhook-health outcome) without a column per metric.
alter table public.calendly_sync_log
  add column if not exists details jsonb;

-- ── 5. Repair the duplicate meetings mirror ─────────────────────────────
-- lib/calendly-sync.ts used to upsert meetings keyed by the Calendly uuid;
-- the canonical mirror (sync-hub-meetings) keys by the internal
-- calendly_events.id. Delete the legacy-keyed rows — verified to have no
-- inbound references (meeting_attendees / debriefs / calendly_events /
-- zoom_meetings all 0) — the canonical rows remain, and the next
-- syncHubMeetings pass recreates anything missing with full client links.
delete from public.meetings m
using public.calendly_events ce
where m.calendly_event_id = ce.calendly_uuid;
