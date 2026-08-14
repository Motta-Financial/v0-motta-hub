import type { PortalUser } from "@/lib/portal/require-portal-auth"

// Minimal shape we depend on — avoids pulling in @supabase/postgrest-js
// (not a direct project dependency) just for a type annotation. Every
// Supabase query builder (`.eq()`, `.or()`, etc.) satisfies this shape.
interface FilterableQuery {
  eq(column: string, value: string): FilterableQuery
  or(filters: string): FilterableQuery
}

/**
 * Applies an `.or(...)` filter scoping a query to the portal user's
 * accessible contact_id/organization_id values. Shared by every
 * client-portal route that queries work_items, documents, or any other
 * table with contact_id/organization_id columns.
 *
 * RLS also enforces this at the database level — this filter exists so
 * routes fetch only relevant rows (and so `.single()`/count queries behave
 * correctly), not as the sole line of defense.
 *
 * `contactColumn`/`organizationColumn` let callers use this against joined
 * tables (e.g. `work_items.contact_id` when querying comments through a
 * join) without hardcoding column names.
 */
export function applyPortalEntityFilter<T extends FilterableQuery>(
  query: T,
  portalUser: Pick<PortalUser, "contactIds" | "organizationIds">,
  { contactColumn = "contact_id", organizationColumn = "organization_id" } = {},
): T {
  const orFilters: string[] = []
  if (portalUser.contactIds.length > 0) {
    orFilters.push(`${contactColumn}.in.(${portalUser.contactIds.join(",")})`)
  }
  if (portalUser.organizationIds.length > 0) {
    orFilters.push(`${organizationColumn}.in.(${portalUser.organizationIds.join(",")})`)
  }

  // requirePortalAuth guarantees at least one entity, so orFilters is never
  // empty in practice. Guard anyway so a bug here fails closed (returns
  // nothing) rather than open (returns everything via an empty .or()).
  if (orFilters.length === 0) {
    return query.eq("id", "00000000-0000-0000-0000-000000000000") as T
  }

  return query.or(orFilters.join(",")) as T
}
