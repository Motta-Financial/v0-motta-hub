import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Shared helpers for linking debriefs to the specific meeting they cover
 * (Calendly event or Zoom meeting). Used by:
 *   - the debrief detail dialog (Start / Link existing controls)
 *   - the prefilled /debriefs/new form
 *   - the hourly debrief-reminder cron (recipient + type resolution)
 *
 * Kept framework-agnostic (no Next imports) so it can run in a route
 * handler, a cron, or be unit-tested directly.
 */

export type MeetingSource = "calendly" | "zoom"

/** The three modalities every meeting falls into, per the firm's process. */
export type DebriefMeetingType = "zoom" | "phone" | "in_person"

/**
 * Map a Calendly `location_type` (or Zoom) to one of our three meeting
 * modalities. Calendly emits values like `physical`, `outbound_call`,
 * `inbound_call`, `zoom`, `google_conference`, `microsoft_teams_conference`,
 * `gotomeeting`, `webex`, `ask_invitee`, `custom`. Anything video-based maps
 * to `zoom`, anything phone-based maps to `phone`, physical maps to
 * `in_person`. Zoom meetings are always `zoom`.
 */
export function resolveMeetingType(
  source: MeetingSource,
  locationType?: string | null,
): DebriefMeetingType {
  if (source === "zoom") return "zoom"
  const t = (locationType || "").toLowerCase()
  if (t.includes("physical") || t.includes("in_person") || t.includes("in-person")) return "in_person"
  if (t.includes("call") || t.includes("phone") || t.includes("outbound") || t.includes("inbound")) return "phone"
  // Video conferencing of any flavor -> treat as a "zoom"-style virtual meeting.
  if (
    t.includes("zoom") ||
    t.includes("conference") ||
    t.includes("teams") ||
    t.includes("meet") ||
    t.includes("webex") ||
    t.includes("gotomeeting")
  ) {
    return "zoom"
  }
  // Sensible default for ask_invitee/custom/unknown: virtual.
  return "zoom"
}

/** Human label for a meeting type, used in emails and the UI. */
export function meetingTypeLabel(type: DebriefMeetingType): string {
  switch (type) {
    case "zoom":
      return "Zoom"
    case "phone":
      return "Phone call"
    case "in_person":
      return "In person"
  }
}

/** Params used to prefill the /debriefs/new form. */
export interface DebriefPrefillParams {
  source: MeetingSource
  /** UUID of the calendly_events or zoom_meetings row. */
  meetingRowId: string
  /** ISO date (YYYY-MM-DD) of the meeting. */
  meetingDate?: string | null
  meetingTitle?: string | null
  meetingType?: DebriefMeetingType | null
  teamMemberId?: string | null
  teamMemberName?: string | null
  /** Primary contact/org the meeting was tagged to. */
  contactId?: string | null
  contactType?: "contact" | "organization" | null
  contactName?: string | null
  karbonKey?: string | null
}

/**
 * Build the relative `/debriefs/new?...` URL that prefills the form. Only
 * non-empty params are appended so the URL stays clean. The form reads these
 * via useSearchParams and seeds its initial state.
 */
export function buildDebriefPrefillPath(params: DebriefPrefillParams): string {
  const sp = new URLSearchParams()
  if (params.source === "calendly") sp.set("calendly_event_id", params.meetingRowId)
  if (params.source === "zoom") sp.set("zoom_meeting_id", params.meetingRowId)
  if (params.meetingDate) sp.set("meeting_date", params.meetingDate)
  if (params.meetingTitle) sp.set("meeting_title", params.meetingTitle)
  if (params.meetingType) sp.set("meeting_type", params.meetingType)
  if (params.teamMemberId) sp.set("team_member_id", params.teamMemberId)
  if (params.teamMemberName) sp.set("team_member_name", params.teamMemberName)
  if (params.contactId) sp.set("contact_id", params.contactId)
  if (params.contactType) sp.set("contact_type", params.contactType)
  if (params.contactName) sp.set("contact_name", params.contactName)
  if (params.karbonKey) sp.set("karbon_key", params.karbonKey)
  return `/debriefs/new?${sp.toString()}`
}

/** Absolute URL variant for emails. */
export function buildDebriefPrefillUrl(appUrl: string, params: DebriefPrefillParams): string {
  return `${appUrl}${buildDebriefPrefillPath(params)}`
}

/**
 * Resolve the team member ids who should receive the post-meeting debrief
 * request: the host plus any internal co-hosts/attendees we can identify.
 *
 * - Calendly: host = `team_member_id`; co-hosts are matched from the
 *   `event_memberships` user emails against active team members.
 * - Zoom: host = `team_member_id`, falling back to a `host_email` match.
 *
 * Returns a de-duplicated list of active team member UUIDs.
 */
export async function resolveMeetingDebriefRecipientIds(
  supabase: SupabaseClient,
  args: {
    source: MeetingSource
    hostTeamMemberId?: string | null
    hostEmail?: string | null
    /** Calendly `event_memberships` JSON (array of { user_email, ... }). */
    eventMemberships?: any[] | null
  },
): Promise<string[]> {
  const ids = new Set<string>()

  if (args.hostTeamMemberId) ids.add(args.hostTeamMemberId)

  // Collect candidate emails: the host email plus any membership emails.
  const emails = new Set<string>()
  if (args.hostEmail) emails.add(args.hostEmail.toLowerCase())
  if (Array.isArray(args.eventMemberships)) {
    for (const m of args.eventMemberships) {
      const e = (m?.user_email || m?.email || "").toString().toLowerCase()
      if (e) emails.add(e)
    }
  }

  if (emails.size > 0) {
    const { data: matched } = await supabase
      .from("team_members")
      .select("id, email, is_active")
      .in("email", Array.from(emails))
    for (const tm of matched || []) {
      if (tm.is_active !== false) ids.add(tm.id)
    }
  }

  return Array.from(ids)
}
