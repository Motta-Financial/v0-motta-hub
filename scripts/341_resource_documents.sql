-- ===========================================================================
-- 341_resource_documents.sql
--
-- Firm "Resources" knowledge base — teammate-uploaded documents that live on
-- the /resources page (Client Resources + Templates + Team Instructions).
--
-- Unlike public.documents (which is per-client / per-work-item), these are
-- FIRM-WIDE reference materials. When a teammate uploads one, ALFRED reads it
-- (via Claude) to extract a plain-text rendering + a summary, and auto-tags it
-- to one or more canonical service lines (public.service_lines.code).
--
-- Replacing a resource is an IN-PLACE version bump: the row id is stable, the
-- blob is swapped, `version` increments, and the prior file metadata is pushed
-- onto `version_history` for traceability.
--
-- ALFRED reads these ONLY through the column-restricted view
-- `alfred_resource_documents` (created below + added to the allowlist), which
-- omits the blob url/pathname (delivery concerns) and exposes the
-- teammate-useful text fields. Same pattern as alfred_meeting_transcripts.
-- ===========================================================================

create table if not exists public.resource_documents (
  id                 uuid primary key default gen_random_uuid(),

  -- Display / classification
  title              text not null,
  description        text,
  -- Which section of the Resources page this belongs to.
  -- 'client-resources' | 'templates' | 'team-instructions' | 'sop' | 'other'
  category           text not null default 'client-resources',
  -- Who the material is meant for: 'team' (internal) | 'client' (shareable).
  audience           text not null default 'team',

  -- Blob storage (Vercel Blob, private-by-obscurity like other uploads)
  file_url           text not null,
  file_pathname      text not null,
  file_name          text not null,
  mime_type          text,
  file_size_bytes    bigint,

  -- Versioning. Replacing the file bumps `version` and appends the prior
  -- file metadata ({version,file_url,file_pathname,file_name,replaced_at,
  -- replaced_by_id}) to this array.
  version            integer not null default 1,
  version_history    jsonb not null default '[]'::jsonb,

  -- ALFRED ingest output
  -- status: 'processing' (just uploaded) | 'ready' | 'failed'
  status             text not null default 'processing',
  extracted_text     text,           -- faithful plain-text rendering ALFRED can cite
  ai_summary         text,           -- 2-4 sentence summary
  ai_keywords        text[] default '{}',
  -- canonical service-line codes (public.service_lines.code), e.g. {TAX,ACCT}
  service_line_codes text[] default '{}',
  ingest_error       text,
  ingested_at        timestamptz,
  ingest_model       text,

  -- Provenance
  uploaded_by_id     uuid references public.team_members(id) on delete set null,
  uploaded_by_name   text,
  is_archived        boolean not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.resource_documents is
  'Firm-wide Resources knowledge base. Teammate-uploaded reference docs; ALFRED reads + auto-tags them to service_lines. Replacing a file is an in-place version bump.';

create index if not exists idx_resource_documents_category
  on public.resource_documents (category) where is_archived = false;
create index if not exists idx_resource_documents_status
  on public.resource_documents (status);
create index if not exists idx_resource_documents_service_lines
  on public.resource_documents using gin (service_line_codes);
create index if not exists idx_resource_documents_created
  on public.resource_documents (created_at desc);

-- keep updated_at fresh
create or replace function public.touch_resource_documents_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_resource_documents_updated_at on public.resource_documents;
create trigger trg_resource_documents_updated_at
  before update on public.resource_documents
  for each row execute function public.touch_resource_documents_updated_at();

-- RLS: authenticated teammates manage resources (mirrors documents/training).
alter table public.resource_documents enable row level security;
drop policy if exists resource_documents_all on public.resource_documents;
create policy resource_documents_all
  on public.resource_documents
  for all
  to authenticated
  using (true)
  with check (true);

-- ── ALFRED column-restricted view ─────────────────────────────────────────
-- Exposes the teammate-useful text fields ONLY. Omits file_url/file_pathname
-- (delivery concern, not knowledge) and provenance internals. ALFRED reads
-- firm resources through THIS view, never the base table.
create or replace view public.alfred_resource_documents as
select
  id,
  title,
  description,
  category,
  audience,
  version,
  status,
  ai_summary,
  ai_keywords,
  service_line_codes,
  extracted_text,
  file_name,
  mime_type,
  uploaded_by_name,
  ingested_at,
  created_at,
  updated_at
from public.resource_documents
where is_archived = false
  and status = 'ready';

comment on view public.alfred_resource_documents is
  'Column-restricted read surface of resource_documents for ALFRED. Omits blob url/pathname; exposes title/summary/extracted_text/service_line_codes for ready, non-archived docs only.';

grant select on public.alfred_resource_documents to authenticated;
-- No anon access (firm-internal knowledge base).
revoke all on public.alfred_resource_documents from anon;
