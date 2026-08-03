-- Trigram similarity search RPC for ProConnect ↔ Hub fuzzy matcher
-- ----------------------------------------------------------------
-- The fuzzy matcher in lib/tax/proconnect-client-match.ts needs to find
-- the top-N organizations whose name is "similar" (by pg_trgm) to a
-- normalized ProConnect business_name. We do this server-side because:
--   1) pg_trgm runs in C, so 700+ orgs × 500 unmatched proposals is
--      milliseconds, not seconds.
--   2) The PostgREST API can't compose `similarity()` + ORDER BY in one
--      round-trip without an RPC, and we want this called from the
--      review-queue endpoint at request time.
--
-- We compare against a *normalized* version of organizations.name so the
-- strip rules in normalizeBusinessName() match what we ranked against.

create or replace function organizations_trgm_search(q text, match_limit int default 25)
returns table (
  id uuid,
  name text,
  ein text,
  primary_email text,
  state text,
  status text,
  similarity real
)
language sql
stable
as $$
  with normalized as (
    select
      o.id, o.name, o.ein, o.primary_email, o.state, o.status,
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(coalesce(o.name,'')),
            '\b(l\.?l\.?c|inc(orporated)?|corp(oration)?|co(mpany)?|l\.?p|l\.?l\.?p|ltd|p\.?l\.?l\.?c|p\.?c|p\.?a|trust|estate)\b\.?',
            ' ',
            'g'
          ),
          '[''"`.,()&]+',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      ) as norm
    from organizations o
    where o.name is not null
  )
  select
    n.id, n.name, n.ein, n.primary_email, n.state, n.status,
    similarity(trim(n.norm), q) as similarity
  from normalized n
  where trim(n.norm) % q
  order by similarity desc
  limit greatest(match_limit, 1);
$$;

comment on function organizations_trgm_search is
  'Fuzzy search organizations by trigram similarity against an entity-suffix-normalized name. Used by /api/tax/client-links to surface candidate Hub orgs for unmapped ProConnect clients.';
