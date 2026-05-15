-- ──────────────────────────────────────────────────────────────────────
-- Tommy Awards Weekly Recap Archive
-- ──────────────────────────────────────────────────────────────────────
-- Persists every weekly recap email so ALFRED has continuity context
-- for future weeks (e.g. "this is the third consecutive podium for X")
-- and so we can render a year-to-date timeline on the Tommy Awards
-- admin page.
--
-- One row per (week_id) — re-running the cron in dry mode never writes
-- and re-running the cron for real upserts the AI summary + image.

create table if not exists public.tommy_weekly_recaps (
  id                uuid primary key default gen_random_uuid(),
  week_id           uuid not null references public.tommy_award_weeks(id) on delete cascade,
  week_date         date not null,
  week_label        text not null,
  total_ballots     integer not null default 0,

  -- Storyline narrative composed by ALFRED in the Motta Alliance voice.
  ai_summary        text not null default '',
  ai_model          text,

  -- Generated F1-podium image of the week's winners. Stored in
  -- Vercel Blob; URL is what we embed in the email and surface in the
  -- archive UI.
  podium_image_url  text,
  podium_image_prompt text,
  podium_image_model text,

  -- Snapshot of the top-three podium at the moment the recap fired.
  -- Mirrors the shape buildTommyRecapHtml consumes so we can re-render
  -- the email at any time without re-aggregating ballots.
  top_three         jsonb not null default '[]'::jsonb,

  -- Optional snapshot of YTD standings used as ALFRED's prompt context.
  ytd_standings     jsonb,

  email_sent_at     timestamptz,
  email_sent_count  integer,
  email_skipped_count integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (week_id)
);

create index if not exists tommy_weekly_recaps_week_date_idx
  on public.tommy_weekly_recaps (week_date desc);

alter table public.tommy_weekly_recaps enable row level security;

-- Service role bypasses RLS; this policy lets the authenticated app
-- read prior recaps for the admin archive view. Writes go through the
-- service-role admin client in the cron route.
drop policy if exists tommy_weekly_recaps_read_authenticated on public.tommy_weekly_recaps;
create policy tommy_weekly_recaps_read_authenticated
  on public.tommy_weekly_recaps for select
  to authenticated
  using (true);

-- Auto-update updated_at on edits.
create or replace function public.set_tommy_weekly_recaps_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tommy_weekly_recaps_updated_at_trg on public.tommy_weekly_recaps;
create trigger tommy_weekly_recaps_updated_at_trg
  before update on public.tommy_weekly_recaps
  for each row execute function public.set_tommy_weekly_recaps_updated_at();
