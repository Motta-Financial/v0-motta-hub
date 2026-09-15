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
  reconnectReason: string | null
  brokenAt: string | null // ISO
}

export interface OutlookTeamCoverage {
  id: string
  fullName: string
  avatarUrl: string | null
  mailbox: string | null // null = not connected
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
  reconnectReason: "Your password changed, or access was revoked.",
  brokenAt: "2025-09-10T09:15:00.000Z",
}

export const MOCK_TEAM_COVERAGE: OutlookTeamCoverage[] = [
  { id: "tm-1", fullName: "Jordan Reyes", avatarUrl: null, mailbox: "jordan.reyes@mottacpa.com" },
  { id: "tm-2", fullName: "Priya Nair", avatarUrl: null, mailbox: "priya.nair@mottacpa.com" },
  { id: "tm-3", fullName: "Sam Okafor", avatarUrl: null, mailbox: "sam.okafor@mottacpa.com" },
  { id: "tm-4", fullName: "Dana Whitfield", avatarUrl: null, mailbox: "dana.whitfield@mottacpa.com" },
  { id: "tm-5", fullName: "Marcus Lee", avatarUrl: null, mailbox: "marcus.lee@mottacpa.com" },
  { id: "tm-6", fullName: "Elena Vasquez", avatarUrl: null, mailbox: "elena.vasquez@mottacpa.com" },
  { id: "tm-7", fullName: "Tom Bradshaw", avatarUrl: null, mailbox: null },
  { id: "tm-8", fullName: "Ariana Petrov", avatarUrl: null, mailbox: null },
  { id: "tm-9", fullName: "Devon Marsh", avatarUrl: null, mailbox: null },
]
