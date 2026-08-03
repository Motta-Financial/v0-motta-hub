-- 220_proconnect_master_enrichment_log
--
-- Audit table for the ProConnect → Master Mapping enrichment pass.
-- Captures every Hub field write sourced from proconnect_clients so we
-- can trace, report, or roll back. Writes are always "fill-only"
-- (Hub field was empty at time of write) — see
-- scripts/apply-proconnect-master-enrichment.ts.
--
-- Kept separate from `tax_proconnect_client_link_log` (which audits
-- LINK creation/removal) so the two concerns are clearly distinct:
--   - link_log  = "who points to whom"
--   - this log  = "what data was copied between them"

create table if not exists public.proconnect_master_enrichment_log (
  id uuid primary key default gen_random_uuid(),
  proconnect_client_id text not null,
  hub_table text not null check (hub_table in ('contacts', 'organizations')),
  hub_record_id uuid not null,
  field_name text not null,
  -- Old value is always NULL for fill-only writes (precondition: empty).
  -- Stored anyway so the column shape matches if we ever support
  -- conflict resolution writes. Conflicts are NEVER auto-written today.
  old_value text,
  new_value text,
  source text not null default 'proconnect_master_enrichment',
  applied_at timestamptz not null default now(),
  applied_by text
);

create index if not exists proconnect_master_enrichment_log_pc_idx
  on public.proconnect_master_enrichment_log(proconnect_client_id);

create index if not exists proconnect_master_enrichment_log_hub_idx
  on public.proconnect_master_enrichment_log(hub_table, hub_record_id);

create index if not exists proconnect_master_enrichment_log_applied_at_idx
  on public.proconnect_master_enrichment_log(applied_at desc);

comment on table public.proconnect_master_enrichment_log is
  'Audit trail of Hub master-record fields populated from ProConnect '
  'data via the linked proconnect_clients row. Fill-only: writes only '
  'occur when the Hub field was empty. SSNs are never written.';
