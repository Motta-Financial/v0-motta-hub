/**
 * Helpers for choosing a human-readable organization display name.
 *
 * Background: earlier Karbon org sync runs (bulk import route) built
 * `organizations.name` as `OrganizationName || Name` with a synthetic
 * `Organization <OrganizationKey>` fallback — but Karbon's /Organizations
 * payloads populate `FullName`, not `OrganizationName`, so hundreds of rows
 * were persisted with the key placeholder in `name` while `full_name` holds
 * the real name (e.g. name = "Organization 257GlGDFgSHf",
 * full_name = "ProConnect Tax"). The webhook mapper
 * (lib/karbon/mappers/organization.ts) was fixed, and
 * /api/karbon/sync-fullnames repairs rows, but any consumer of
 * `organizations.name` must still treat the placeholder as "no name".
 */

/** Karbon entity keys are ~10–14 char base62 strings (e.g. 257GlGDFgSHf). */
const PLACEHOLDER_ORG_NAME = /^Organization [A-Za-z0-9]{8,20}$/

/**
 * True when the value is empty or one of the synthetic names our sync has
 * historically written ("Organization <KarbonKey>", "Unnamed Organization").
 */
export function isPlaceholderOrgName(name: string | null | undefined): boolean {
  const trimmed = (name || "").trim()
  if (!trimmed) return true
  if (trimmed === "Unnamed Organization") return true
  return PLACEHOLDER_ORG_NAME.test(trimmed)
}

/**
 * Return the first candidate that is a real, human-readable name — skipping
 * empties and sync placeholders. Returns null when none qualify so callers
 * choose their own last-resort label.
 */
export function pickOrgDisplayName(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate && !isPlaceholderOrgName(candidate)) return candidate.trim()
  }
  return null
}
