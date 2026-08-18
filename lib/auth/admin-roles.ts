/**
 * Pure, client-safe constants and helpers for the platform "Admin"
 * access tier. Split out from `require-admin.ts` so client components
 * (e.g. an admin-only button gate) can import these without dragging
 * `next/server` and the SSR Supabase client into the browser bundle.
 *
 * The server gate in `require-admin.ts` re-exports `ADMIN_ROLES` from
 * this module — there's a single source of truth for who counts as an
 * admin.
 */

/**
 * The set of `team_members.role` values that count as platform admins.
 *
 * - "Company" and "Partner" are the firm-leadership tier.
 * - "Admin" is reserved for non-leadership operators that still need
 *   full platform access (e.g. the back-end development lead).
 *
 * If/when an explicit `is_admin` column gets added to `team_members`,
 * swap this constant out for a column check.
 */
export const ADMIN_ROLES = ["Company", "Partner", "Admin"] as const

export type AdminRole = (typeof ADMIN_ROLES)[number]

/**
 * Helper for client components that already have the team_member's
 * `role` string in hand (via `useUser().teamMember`). Case-sensitive
 * on purpose — `team_members.role` is a controlled vocabulary set in
 * `app/settings/users` and we don't want a typo'd "partner" silently
 * counting as admin. This is purely a UI-visibility check — the
 * matching server-side `requireAdmin()` gate is authoritative.
 */
export function isAdminRole(role: string | null | undefined): role is AdminRole {
  if (!role) return false
  return (ADMIN_ROLES as readonly string[]).includes(role)
}
