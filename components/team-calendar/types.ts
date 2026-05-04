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
  link_source: "auto" | "manual"
  match_method: string | null
  contact?: { id: string; full_name: string | null; primary_email: string | null } | null
  organization?: { id: string; name: string | null } | null
}

export interface TeamCalendarWorkItemTag {
  id: string
  work_item_id: string
  work_item: { id: string; title: string; client_name: string | null; status: string | null } | null
}

export interface TeamCalendarServiceTag {
  id: string
  service_id: string
  service: { id: string; name: string; category: string | null } | null
}

export interface TeamCalendarEvent {
  id: string
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
  team_members: TeamCalendarHost | null
  calendly_invitees: TeamCalendarInvitee[]
  calendly_event_clients: TeamCalendarClientTag[]
  calendly_event_work_items: TeamCalendarWorkItemTag[]
  calendly_event_services: TeamCalendarServiceTag[]
  /** Pre-computed by the API — count of comments for the event. */
  commentCount: number
}
