-- 420: Make it possible to show a meeting recap to a client WITHOUT
-- exposing the internal debrief.
--
-- The portal's Meetings page and its dashboard "latest meeting" card are
-- built and running on lib/mock/meetings.ts. The obvious wiring -- point
-- them at debriefs_full -- is the one thing that must not happen:
-- debriefs.notes carries internal commentary (fee adjustments, candid
-- assessments of the client). Piping it to the client is a one-way
-- mistake.
--
-- So a debrief gets a separate, deliberately-written client-facing summary
-- and an explicit share flag. Default is NOT shared: a debrief written
-- before this migration, or written later by someone who doesn't know
-- about the portal, stays invisible to the client. Nothing becomes visible
-- by accident -- only by a staff member typing a summary and turning it on.

alter table public.debriefs
  add column if not exists client_summary text,
  add column if not exists shared_with_client boolean not null default false,
  add column if not exists shared_at timestamptz,
  add column if not exists shared_by_id uuid references public.team_members(id) on delete set null;

comment on column public.debriefs.client_summary is
  'Client-facing recap, written or approved by staff. NEVER derive this from debriefs.notes, which is internal.';
comment on column public.debriefs.shared_with_client is
  'Explicit opt-in. False (the default) means the client sees nothing about this meeting in the portal, regardless of client_summary.';

-- A debrief can only be shared once it actually has something safe to show.
alter table public.debriefs
  drop constraint if exists debriefs_shared_requires_summary;
alter table public.debriefs
  add constraint debriefs_shared_requires_summary
  check (
    shared_with_client = false
    or (client_summary is not null and length(btrim(client_summary)) > 0)
  );

create index if not exists debriefs_shared_idx
  on public.debriefs (contact_id, organization_id, debrief_date desc)
  where shared_with_client = true and deleted_at is null;
