/**
 * Types shared across the Team Calendar page and its sub-components.
 *
 * We deliberately do NOT pull these from `@supabase/supabase-js` types —
 * the API endpoint flattens / counts some fields server-side and we
 * want the client surface to reflect the trimmed shape, not the raw DB.
 */

/**
 * The four built-in views. Day/week/month follow the obvious calendar
 * conventions; "list" is a flat agenda for users who prefer reading
 * over scanning a grid.
 */
export type CalendarView = "day" | "week" | "month" | "list"

export interface TeamCalendarHost {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  title: string | null
}

export interface TeamCalendarInvitee {
  id: string
  name: string | null
  email: string
  status: string
  timezone: string | null
  questions_answers: any
  contact_id: string | null
}

export interface TeamCalendarClientTag {
  id: string
  contact_id: string | null
  organization_id: string | null
  /** "alfred" rows come from the AI triage step; see lib/alfred/calendly-triage.ts. */
  link_source: "auto" | "manual" | "alfred"
  match_method: string | null
  /** ALFRED's self-reported confidence (0..1). Null for auto/manual. */
  confidence?: number | null
  /** ALFRED's one-sentence justification, surfaced as a tooltip. */
  alfred_reason?: string | null
  /** True when ALFRED's confidence is below the auto-accept threshold. */
  needs_review?: boolean | null
  contact?: { id: string; full_name: string | null; primary_email: string | null } | null
  organization?: { id: string; name: string | null } | null
}

export interface TeamCalendarWorkItemTag {
  id: string
  work_item_id: string
  link_source?: "auto" | "manual" | "alfred"
  confidence?: number | null
  alfred_reason?: string | null
  needs_review?: boolean | null
  work_item: { id: string; title: string; client_name: string | null; status: string | null } | null
}

export interface TeamCalendarServiceTag {
  id: string
  service_id: string
  link_source?: "auto" | "manual" | "alfred"
  confidence?: number | null
  alfred_reason?: string | null
  needs_review?: boolean | null
  service: { id: string; name: string; category: string | null } | null
}

export interface TeamCalendarEvent {
  id: string
  /**
   * Origin of the row. Calendly events still come from `calendly_events`,
   * Zoom meetings come from `zoom_meetings` and are normalised into the
   * same shape by /api/calendly/team-calendar (see that route for the
   * field-by-field mapping). The UI uses this to:
   *   • render an origin chip / icon next to the meeting name
   *   • skip the Calendly-only `Tags`/`Comments` tabs in the detail
   *     dialog when the row is a Zoom meeting (those features are
   *     wired against /api/calendly/events/* endpoints that don't
   *     exist for Zoom).
   */
  source?: "calendly" | "zoom"
  /** Numeric Zoom meeting id (only present when `source === "zoom"`). */
  zoom_meeting_id?: number | string | null
  calendly_uuid: string
  name: string
  status: "active" | "canceled" | string
  start_time: string
  end_time: string
  location_type: string | null
  location: string | null
  join_url: string | null
  team_member_id: string | null
  calendly_user_uri: string | null
  calendly_user_name: string | null
  calendly_user_email: string | null
  /**
   * Calendly's event_type identifiers. The UUID is per-user (each host
   * has their own copy of the same template) but the NAME is the natural
   * grouping key — "Discovery Meeting" looks the same regardless of
   * which teammate is hosting. Color coding keys off the name.
   */
  event_type_uuid: string | null
  event_type_name: string | null
  team_members: TeamCalendarHost | null
  calendly_invitees: TeamCalendarInvitee[]
  calendly_event_clients: TeamCalendarClientTag[]
  calendly_event_work_items: TeamCalendarWorkItemTag[]
  calendly_event_services: TeamCalendarServiceTag[]
  /** Pre-computed by the API — count of comments for the event. */
  commentCount: number
}

/**
 * One row in the firm-wide event-type color map. Keyed by the human-
 * readable event_type_name. `color` is whatever the chip should render
 * (override if set, else Calendly's own default); `default` lets the
 * settings UI offer a "reset to default" affordance.
 */
export interface EventTypeColorEntry {
  event_type_name: string
  color: string
  default: string | null
  isOverride: boolean
  count: number
}
