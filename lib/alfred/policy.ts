// Audience-aware policy layer for the ALFRED public chat surface.
//
// This module is the single seam where we decide what a given audience
// (currently `staff`, eventually also `client`) is allowed to do. The
// chat route consults `buildPolicy()` once per request and uses the
// returned object to:
//
//   - Filter the static `alfredTools` map down to the allowed subset
//     before passing tools to `streamText`.
//   - Restrict `queryDatabase`'s table parameter to the allowed subset
//     of `ALLOWED_TABLES` (a runtime guard layered on top of the
//     existing `isAllowedTable` check).
//   - Append an audience-specific suffix to the system prompt so the
//     model knows who it is talking to.
//
// The `client` branch is intentionally NOT implemented yet -- it
// throws a recognisable error that the route catches and surfaces as
// a clean 403 to the caller. This keeps the seam visible and forces
// us to make a deliberate decision before flipping a client UI on.

import { ALLOWED_TABLES } from "@/lib/alfred/allowed-tables"

export type Audience = "staff" | "client"

/**
 * The narrow shape of the requesting user that the policy actually
 * needs. We accept either the resolved Hub user (from
 * `lib/alfred/resolve-user.ts`) or any structurally-compatible object,
 * so the policy can be built in test contexts without spinning up the
 * full Supabase resolver.
 */
export interface PolicyUser {
  teamMemberId: string
  fullName: string | null
  email: string
  role: string | null
  department: string | null
}

export interface AlfredPolicy {
  audience: Audience
  currentUser: PolicyUser
  /**
   * Tool names (the keys of the `alfredTools` map in the chat route,
   * plus the user-scoped tools created per-request) that the model is
   * allowed to invoke under this policy. The route filters its tool
   * map by this list before handing it to `streamText`.
   */
  allowedTools: string[]
  /**
   * Subset of `ALLOWED_TABLES` that `queryDatabase` may target under
   * this policy. For staff this is the full list; a future client
   * policy is expected to narrow it dramatically.
   */
  tableAllowlist: string[]
  /**
   * Appended to the base SYSTEM_PROMPT after the identity preamble.
   * Lets us tell the model "you're talking to a client, do not reveal
   * internal-only data" without rewriting the whole prompt.
   */
  systemPromptSuffix: string
}

/**
 * Tool names available to the staff audience. Kept in sync by hand
 * with `alfredTools` + the user-scoped tools defined inside POST in
 * `app/api/alfred/chat/route.ts`. Adding a new staff tool: add it to
 * `alfredTools` in the chat route AND to this list.
 *
 * (We accept the duplication here rather than dynamically reading the
 * tool map because the policy module shouldn't import the route file
 * -- routes import the policy, not the other way around.)
 */
const STAFF_TOOL_NAMES: readonly string[] = [
  // Static tools defined in alfredTools
  "queryDatabase",
  "getDatabaseStats",
  "searchAcrossTables",
  "getWorkItemsSummary",
  "getTeamWorkload",
  "getClientInfo",
  "getUpcomingDeadlines",
  "getRecentActivity",
  "getTommyAwardsLeaderboard",
  "getServices",
  "getFinancialSummary",
  "getDealPipeline",
  "getProjects",
  "findPerson",
  "getZoomRecordingStatus",
  "pullZoomRecordings",
  "webSearch",
  "browsePage",
  // Per-request user-scoped tools (constructed inside POST)
  "getMyWorkItems",
  "getMyUpcomingDeadlines",
] as const

/**
 * Construct a per-request policy. Throws a plain `Error` for the
 * `client` audience because the client branch is not yet enabled --
 * the chat route catches this and returns a 403 with the same
 * message, giving us a single, obvious place to decide when to flip
 * the client surface on.
 */
export function buildPolicy(args: {
  audience: Audience
  currentUser: PolicyUser
}): AlfredPolicy {
  const { audience, currentUser } = args

  if (audience === "staff") {
    return {
      audience,
      currentUser,
      allowedTools: [...STAFF_TOOL_NAMES],
      tableAllowlist: [...ALLOWED_TABLES],
      systemPromptSuffix: "Audience: staff (Motta team member).",
    }
  }

  if (audience === "client") {
    // Intentional throw -- the route surfaces this as a 403. When the
    // client surface is ready, replace this branch with a proper
    // implementation that narrows `allowedTools` and `tableAllowlist`
    // and appends a client-appropriate prompt suffix.
    throw new Error(
      "Client ALFRED is not yet enabled. Contact Motta if you need access.",
    )
  }

  // Exhaustiveness guard. If a new Audience variant is added to the
  // type union and not handled above, this throw makes it visible at
  // runtime instead of silently returning undefined.
  const _exhaustive: never = audience
  throw new Error(`Unknown ALFRED audience: ${String(_exhaustive)}`)
}
