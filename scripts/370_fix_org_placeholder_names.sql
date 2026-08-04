-- 370: Repair organizations.name rows poisoned with the "Organization <key>"
-- placeholder.
--
-- The bulk import route (app/api/karbon/organizations/route.ts) built `name`
-- as `OrganizationName || Name || 'Organization ' || OrganizationKey`, but
-- Karbon's /Organizations payloads populate FullName — so ~716 rows were
-- persisted with the key placeholder in `name` while `full_name` holds the
-- real name (e.g. name = 'Organization 257GlGDFgSHf',
-- full_name = 'ProConnect Tax'). The mapper is fixed in the same PR as this
-- script; this backfills the rows already written.
--
-- Idempotent: rows already repaired no longer match the WHERE clause.
-- Reversible: the placeholder is derivable ('Organization ' || karbon_organization_key).

UPDATE organizations
SET
  name = btrim(full_name),
  updated_at = NOW()
WHERE
  name ~ '^Organization [A-Za-z0-9]{8,20}$'
  AND full_name IS NOT NULL
  AND btrim(full_name) <> ''
  -- Don't copy a placeholder over a placeholder
  AND btrim(full_name) !~ '^Organization [A-Za-z0-9]{8,20}$';

-- Follow-up (optional, heavier): POST /api/karbon/sync-fullnames re-pulls
-- names from Karbon and also refreshes stale work_items.client_name.
