/**
 * Service-catalog search + grouping, shared and testable.
 *
 * Lives outside the debrief form so the matching rules can be asserted
 * (see `scripts/test-service-filter.mjs`) rather than eyeballed. The
 * debrief's "Project Finance" picker is how selected services reach a
 * proposal, so a service the partner can't find is a service that
 * doesn't get quoted.
 */

export interface FilterableService {
  id: string
  name: string
  category: string | null
  subcategory: string | null
  description: string | null
}

/**
 * Escape a term for use inside a PostgREST `or()` filter.
 *
 * `or()` is a comma-separated list of filters, so an unescaped comma in
 * user input splits it into nonsense and the request 500s. Parens close
 * the group early. `%` / `_` are `ilike` wildcards — a stray underscore
 * would otherwise match any character, quietly widening the search.
 *
 * Exported for the API route and for tests; kept here so the escaping
 * rule has exactly one definition.
 */
export function escapeForOrFilter(term: string): string {
  return term.replace(/[(),]/g, " ").replace(/[%_\\]/g, "\\$&").trim()
}

/**
 * Filter the catalog for a query string.
 *
 * Matches across name, category, subcategory and description, so a
 * partner finds "Form 1120-S" by typing "1120", "s-corp", or words from
 * the description. Multiple whitespace-separated terms must ALL match —
 * "tax 1040" narrows, where a single OR would widen and bury the answer.
 *
 * An empty query returns everything, which is the behaviour the previous
 * implementation got wrong: its debounced fetch bailed on an empty string,
 * so clearing the search box left the last subset on screen with no way
 * back.
 */
export function filterServices<T extends FilterableService>(
  services: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return services
  const terms = q.split(/\s+/)
  return services.filter((svc) => {
    const haystack = [svc.name, svc.category, svc.subcategory, svc.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return terms.every((t) => haystack.includes(t))
  })
}

/**
 * Group services by category, alphabetically, categories sorted.
 *
 * Grouping earns its place at this catalog size: Tax alone is 56 of ~100
 * services, and a flat alphabetical list of 100 rows is hard to scan.
 * Services with no category collect under "Other" rather than vanishing.
 */
export function groupServicesByCategory<T extends FilterableService>(
  services: T[],
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>()
  for (const svc of services) {
    const key = svc.category || "Other"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(svc)
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
}
