/**
 * ALFRED service-account helpers.
 *
 * ALFRED is the AI assistant identity ("ALFRED AI") that performs
 * automated work inside the Hub. It owes its existence to a single,
 * sentinel row in `team_members` that is created and protected by
 * scripts/052_alfred_service_account.sql:
 *
 *   - The row is identified by `is_service_account = TRUE`.
 *   - A Postgres trigger (`trg_team_members_protect_service_account`)
 *     rejects any UPDATE that attempts to flip `is_service_account` off,
 *     change the email away from the canonical address, or deactivate
 *     the row. It also rejects DELETE.
 *   - There is at most one such row (enforced by a partial unique
 *     index on `is_service_account` WHERE `is_service_account = TRUE`).
 *
 * This module is the ONLY place application code should reference the
 * canonical ALFRED email or perform existence checks. UI code should
 * call `isAlfredServiceAccount()` to decide whether to show "service
 * account" badges and disable destructive controls; server code should
 * call `getAlfredServiceAccount()` to load the row when assigning
 * tasks/work to ALFRED.
 *
 * IMPORTANT: ALFRED gets the same authentication and authorization
 * treatment as any other team member. We deliberately do NOT auto-elevate
 * or grant special privileges here. Any future privileged behavior must
 * be opted into explicitly at the call site.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Canonical ALFRED email address. The migration's protection trigger
 * key off this exact case-insensitive value, so changing it here would
 * be a breaking change requiring a coordinated migration. If you ever
 * need to change the address, update both this constant and the
 * trigger function in a new migration.
 */
export const ALFRED_EMAIL = "Info@mottafinancial.com"

/**
 * Minimal shape of a team_members row that the helpers in this module
 * need. Wider shapes (i.e. fully-typed Supabase rows) satisfy this
 * interface structurally, so callers don't have to remap their data.
 */
export interface TeamMemberLike {
  id?: string
  email?: string | null
  is_service_account?: boolean | null
}

/**
 * Returns the ALFRED service-account row, or throws if it is missing.
 *
 * The row is created by scripts/052_alfred_service_account.sql and is
 * protected from deletion. If this function ever throws "missing",
 * either the migration has not been applied to the target environment
 * or the row has been removed out-of-band — both of which require
 * operator intervention rather than silent fallback.
 *
 * @param supabase A Supabase client with read access to `team_members`.
 *                 In server code this is typically the service-role
 *                 client; in client code it would be the user-scoped
 *                 client (RLS permitting).
 */
export async function getAlfredServiceAccount(
  supabase: SupabaseClient<any, any, any>,
) {
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("is_service_account", true)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to load ALFRED service account: ${error.message}. ` +
        `Ensure scripts/052_alfred_service_account.sql has been applied.`,
    )
  }

  if (!data) {
    throw new Error(
      `ALFRED service account row is missing from team_members. ` +
        `Re-run scripts/052_alfred_service_account.sql.`,
    )
  }

  return data
}

/**
 * Returns true if the given team_members row represents the ALFRED
 * service account. Accepts any object that resembles a team_members
 * row, including Supabase typed rows or partial objects from
 * client-side caches.
 *
 * Implementation notes:
 *  - We trust the `is_service_account` flag first because that is what
 *    the database trigger enforces.
 *  - We fall back to a case-insensitive email comparison so that older
 *    cached rows missing the flag (e.g. fetched before the column was
 *    added) still match correctly. This fallback is purely defensive;
 *    new rows always have the flag populated.
 */
export function isAlfredServiceAccount(
  teamMember: TeamMemberLike | null | undefined,
): boolean {
  if (!teamMember) return false
  if (teamMember.is_service_account === true) return true
  const email = teamMember.email
  if (typeof email === "string" && email.length > 0) {
    return email.toLowerCase() === ALFRED_EMAIL.toLowerCase()
  }
  return false
}
