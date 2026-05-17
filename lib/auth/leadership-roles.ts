/**
 * Pure, client-safe constants and helpers for the "Leadership" (PPD)
 * access tier. Split out from `require-leadership.ts` so client
 * components (e.g. the sidebar) can import these without dragging
 * `next/server` and the SSR Supabase client into the browser bundle.
 *
 * The server gate in `require-leadership.ts` re-exports `LEADERSHIP_ROLES`
 * from this module — there's a single source of truth for who counts
 * as PPD.
 */

export const LEADERSHIP_ROLES = ["Partner", "Principal", "Director"] as const

export type LeadershipRole = (typeof LEADERSHIP_ROLES)[number]

/**
 * Helper for client components that already have the team_member's
 * `role` string in hand (via `useUser().teamMember`). Case-sensitive
 * on purpose — `team_members.role` is a controlled vocabulary set in
 * `app/settings/users` and we don't want a typo'd "partner" silently
 * counting as leadership.
 */
export function isLeadershipRole(role: string | null | undefined): role is LeadershipRole {
  if (!role) return false
  return (LEADERSHIP_ROLES as readonly string[]).includes(role)
}
