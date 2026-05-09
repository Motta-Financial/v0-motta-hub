/**
 * Server-side companion to `lib/mentions.ts`.
 *
 * The same parser runs on both sides of the wire — when a user posts a
 * message or debrief comment, the route handler invokes
 * `extractMentionedTeamMemberIds()` against the freshly persisted text
 * and fans out in-app notifications for every resolved teammate. We
 * deliberately keep this lightweight (no email by default) so users
 * don't get a duplicate inbox blast on top of the regular debrief /
 * message subscriptions; mentions are a foreground "tap on the
 * shoulder" surfaced via the bell icon.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { extractMentionIds, type MentionMember } from "@/lib/mentions"

/**
 * Fetch the active team-members directory shaped for mention parsing.
 * Cached at the route-handler level — every call re-fetches, which is
 * fine because POST volume is tiny (a few per minute at peak) and the
 * row count is ~50.
 */
export async function fetchMentionableMembers(
  supabase: SupabaseClient,
): Promise<MentionMember[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("id, full_name, first_name, last_name")
    .eq("is_active", true)

  if (error) {
    console.error("[mentions-server] failed to load directory:", error)
    return []
  }

  return (data || [])
    .filter((r: any) => !!r.full_name)
    .map((r: any) => ({
      id: r.id,
      full_name: r.full_name,
      first_name: r.first_name,
      last_name: r.last_name,
    }))
}

/**
 * Convenience: parse `text` and return the unique set of mentioned
 * `team_members.id`s, optionally minus an "exclude" id (typically the
 * author themselves so we don't notify them about their own mention).
 */
export async function extractMentionedTeamMemberIds(
  supabase: SupabaseClient,
  text: string | null | undefined,
  options?: { excludeId?: string | null },
): Promise<string[]> {
  if (!text) return []
  const members = await fetchMentionableMembers(supabase)
  let ids = extractMentionIds(text, members)
  if (options?.excludeId) {
    ids = ids.filter((id) => id !== options.excludeId)
  }
  return ids
}

/**
 * Insert in-app notifications for a list of mentioned teammates.
 * Idempotent-ish: we don't dedupe against existing notifications
 * because a user re-mentioning the same person in an edit ought to be
 * surfaced again. Failures are logged and swallowed — the upstream
 * mutation already succeeded; mention notifications are best-effort.
 */
export async function notifyMentions(
  supabase: SupabaseClient,
  params: {
    recipientIds: string[]
    title: string
    message: string
    actionUrl: string
    entityType: string
    entityId: string
    notificationType?: string
  },
): Promise<void> {
  const {
    recipientIds,
    title,
    message,
    actionUrl,
    entityType,
    entityId,
    notificationType = "mention",
  } = params
  if (!recipientIds.length) return

  const rows = recipientIds.map((teamMemberId) => ({
    team_member_id: teamMemberId,
    notification_type: notificationType,
    entity_type: entityType,
    entity_id: entityId,
    title,
    message,
    action_url: actionUrl,
    is_read: false,
  }))

  const { error } = await supabase.from("notifications").insert(rows)
  if (error) {
    console.error("[mentions-server] failed to insert mention notifications:", error)
  }
}
