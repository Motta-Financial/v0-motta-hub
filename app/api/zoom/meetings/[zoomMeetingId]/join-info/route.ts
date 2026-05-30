/**
 * GET /api/zoom/meetings/[zoomMeetingId]/join-info
 *
 * Resolves everything the Meeting SDK (Client View) needs to join a meeting,
 * keyed by the numeric Zoom meeting id:
 *   { meetingNumber, passcode, topic, displayName }
 *
 * The passcode is returned here (auth-gated) rather than being embedded in a
 * shareable link. Display name defaults to the signed-in teammate so they show
 * up correctly in the meeting roster.
 *
 * Auth: signed-in Hub teammate only. Meeting rows are read with the admin
 * client because zoom_meetings is a service-role table.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getTeamMemberByAuthId } from "@/lib/team-members"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ zoomMeetingId: string }> },
) {
  const { zoomMeetingId } = await params

  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const numericId = Number(String(zoomMeetingId).replace(/\D/g, ""))
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "invalid_meeting_id" }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: meeting, error } = await admin
    .from("zoom_meetings")
    .select("zoom_meeting_id, topic, password")
    .eq("zoom_meeting_id", numericId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Default the roster name to the teammate; fall back to their email/user.
  const member = await getTeamMemberByAuthId(user.id, user.email)
  const displayName =
    member?.full_name?.trim() ||
    user.user_metadata?.full_name ||
    user.email ||
    "ALFRED Hub"

  return NextResponse.json({
    meetingNumber: String(numericId),
    passcode: meeting?.password ?? "",
    topic: meeting?.topic ?? null,
    displayName,
    known: Boolean(meeting),
  })
}
