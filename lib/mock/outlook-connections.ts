/**
 * Shared mock data for the per-user Outlook mailbox connection feature.
 *
 * There is no backing schema for this yet (no `outlook_connections`
 * table), so components/settings/outlook-dashboard.tsx imports this
 * sample set directly. The dashboard is wrapped in <PreviewFeature> so
 * nobody mistakes this for a real connection. Once a real integration
 * lands, replace this with fetches against /api/outlook/* and delete
 * this file.
 */

export type OutlookConnectionStatus = "not_connected" | "connected" | "needs_reconnect"

export interface OutlookOwnConnection {
  status: OutlookConnectionStatus
  mailbox: string | null
  connectedAt: string | null // ISO
  lastSyncAt: string | null // ISO
  emailsSynced: number
  calendarEventsSynced: number
  webhookConfigured: boolean
  reconnectReason: string | null
  brokenAt: string | null // ISO
}

export interface OutlookRecentEmail {
  id: string
  subject: string
  from: string
  receivedAt: string // ISO
  preview: string
}

export interface OutlookCalendarEvent {
  id: string
  title: string
  startsAt: string // ISO
  attendees: number
  location: string | null
}

// Flip this to "not_connected" or "needs_reconnect" to preview the other
// two states without touching the component.
export const MOCK_MY_CONNECTION: OutlookOwnConnection = {
  status: "connected",
  mailbox: "jordan.reyes@mottacpa.com",
  connectedAt: "2025-03-03T14:00:00.000Z",
  lastSyncAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  emailsSynced: 1842,
  calendarEventsSynced: 96,
  webhookConfigured: false,
  reconnectReason: "Your password changed, or access was revoked.",
  brokenAt: "2025-09-10T09:15:00.000Z",
}

export const MOCK_RECENT_EMAILS: OutlookRecentEmail[] = [
  {
    id: "em-1",
    subject: "Re: Q3 estimated payments",
    from: "Karen Ibarra",
    receivedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    preview: "Thanks for the reminder — I'll send the wire confirmation over today.",
  },
  {
    id: "em-2",
    subject: "1099s for review",
    from: "Devon Marsh",
    receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    preview: "Attached are the three 1099s that still need a second look before filing.",
  },
  {
    id: "em-3",
    subject: "Signed engagement letter",
    from: "Priya Nair",
    receivedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    preview: "Client countersigned this morning — copy attached for the file.",
  },
]

export const MOCK_CALENDAR_EVENTS: OutlookCalendarEvent[] = [
  {
    id: "ev-1",
    title: "Client call — Ibarra Consulting",
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    attendees: 3,
    location: "Microsoft Teams",
  },
  {
    id: "ev-2",
    title: "Internal review — year-end close",
    startsAt: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
    attendees: 5,
    location: null,
  },
]
