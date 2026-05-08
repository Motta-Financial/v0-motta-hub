-- Firm-wide color overrides for Calendly meeting types.
--
-- The team calendar groups meetings by event_type_name (e.g. "Discovery
-- Meeting", "Client Check-In: Existing Client (30mins)"). The default color
-- comes from Calendly itself (calendly_event_types.color), but the firm
-- often wants to standardize a custom palette so the calendar reads at a
-- glance — e.g. green for prospect intros, blue for tax review, etc.
--
-- This table holds the override. Keyed by event_type_name (case-sensitive
-- string match) because the same name appears across multiple per-user
-- calendly_event_types rows and we want one shared color for the firm.
-- Any teammate can edit; the audit columns capture who last changed what.

create table if not exists public.calendly_event_type_colors (
  event_type_name        text primary key,
  color                  text not null,
  updated_by_team_member_id uuid references public.team_members(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Lookups always go by name from the calendar grid; primary key serves the
-- read path. No additional indexes needed.

-- Sanity-check: hex color (#rrggbb / #rrggbbaa). Calendly returns lowercase
-- 7-char hex strings; we accept upper/lower and an optional alpha byte for
-- future-proofing.
alter table public.calendly_event_type_colors
  drop constraint if exists calendly_event_type_colors_color_format_chk;
alter table public.calendly_event_type_colors
  add constraint calendly_event_type_colors_color_format_chk
  check (color ~* '^#[0-9a-f]{6}([0-9a-f]{2})?$');

-- Bump updated_at automatically. We follow the same trigger pattern used
-- elsewhere in this schema (see scripts/038_*.sql) — a simple BEFORE UPDATE
-- trigger that stamps now() into updated_at. Re-creating idempotently so
-- re-runs of this migration don't fail.
create or replace function public.calendly_event_type_colors_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_calendly_event_type_colors_updated_at
  on public.calendly_event_type_colors;
create trigger trg_calendly_event_type_colors_updated_at
  before update on public.calendly_event_type_colors
  for each row execute function public.calendly_event_type_colors_set_updated_at();
