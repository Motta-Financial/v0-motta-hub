import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function getServerAccessToken() {
  const clientId = process.env.ZOOM_CLIENT_ID
  const clientSecret = process.env.ZOOM_CLIENT_SECRET
  const accountId = process.env.ZOOM_ACCOUNT_ID

  if (!clientId || !clientSecret || !accountId) {
    throw new Error("Zoom credentials not configured")
  }

  const tokenResponse = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "account_credentials",
      account_id: accountId,
    }),
  })

  if (!tokenResponse.ok) {
    throw new Error("Failed to get Zoom access token")
  }

  const tokenData = await tokenResponse.json()
  return tokenData.access_token
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") || "upcoming" // upcoming, scheduled, live
    const fromDate = searchParams.get("from")
    const toDate = searchParams.get("to")

    const accessToken = await getServerAccessToken()

    // First get all users in the account
    const usersResponse = await fetch("https://api.zoom.us/v2/users?page_size=300&status=active", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!usersResponse.ok) {
      throw new Error("Failed to fetch users")
    }

    const usersData = await usersResponse.json()
    const users = usersData.users || []

    // Fetch meetings for each user in parallel
    const allMeetings: any[] = []

    await Promise.all(
      users.map(async (user: any) => {
        try {
          const meetingsResponse = await fetch(
            `https://api.zoom.us/v2/users/${user.id}/meetings?type=${type}&page_size=100`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          )

          if (meetingsResponse.ok) {
            const meetingsData = await meetingsResponse.json()
            const meetings = meetingsData.meetings || []

            // Add host info to each meeting
            meetings.forEach((meeting: any) => {
              allMeetings.push({
                ...meeting,
                host_name: `${user.first_name} ${user.last_name}`,
                host_email: user.email,
                host_pic_url: user.pic_url,
              })
            })
          }
        } catch (err) {
          console.error(`Failed to fetch meetings for user ${user.email}:`, err)
        }
      }),
    )

    // Sort by start time
    allMeetings.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

    // Filter by date range if provided
    let filteredMeetings = allMeetings
    if (fromDate) {
      const from = new Date(fromDate)
      filteredMeetings = filteredMeetings.filter((m) => new Date(m.start_time) >= from)
    }
    if (toDate) {
      const to = new Date(toDate)
      filteredMeetings = filteredMeetings.filter((m) => new Date(m.start_time) <= to)
    }

    return NextResponse.json({
      meetings: filteredMeetings,
      users: users.map((u: any) => ({
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        display_name: `${u.first_name} ${u.last_name}`,
        pic_url: u.pic_url,
        type: u.type,
        status: u.status,
      })),
      total: filteredMeetings.length,
    })
  } catch (error) {
    console.error("[Zoom Master Meetings] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch meetings" },
      { status: 500 },
    )
  }
}

// POST to sync meetings to Supabase and send notifications
export async function POST(request: Request) {
  try {
    const accessToken = await getServerAccessToken()

    // Get all users
    const usersResponse = await fetch("https://api.zoom.us/v2/users?page_size=300&status=active", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!usersResponse.ok) {
      throw new Error("Failed to fetch users")
    }

    const usersData = await usersResponse.json()
    const users = usersData.users || []

    let meetingsSynced = 0
    const allMeetings: any[] = []

    // Fetch and sync meetings for each user
    for (const user of users) {
      try {
        const meetingsResponse = await fetch(
          `https://api.zoom.us/v2/users/${user.id}/meetings?type=upcoming&page_size=100`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        )

        if (meetingsResponse.ok) {
          const meetingsData = await meetingsResponse.json()
          const meetings = meetingsData.meetings || []

          for (const meeting of meetings) {
            // Upsert to Supabase
            const { error } = await supabaseAdmin.from("zoom_meetings").upsert(
              {
                zoom_meeting_id: meeting.id,
                zoom_uuid: meeting.uuid,
                zoom_host_id: meeting.host_id,
                topic: meeting.topic,
                meeting_type: meeting.type,
                status: meeting.status || "scheduled",
                start_time: meeting.start_time,
                duration: meeting.duration,
                timezone: meeting.timezone,
                agenda: meeting.agenda,
                join_url: meeting.join_url,
                password: meeting.password,
                host_email: user.email,
                raw_data: meeting,
                synced_at: new Date().toISOString(),
              },
              {
                onConflict: "zoom_meeting_id",
              },
            )

            if (!error) {
              meetingsSynced++
              allMeetings.push({
                ...meeting,
                host_name: `${user.first_name} ${user.last_name}`,
                host_email: user.email,
              })
            }
          }
        }
      } catch (err) {
        console.error(`Failed to sync meetings for user ${user.email}:`, err)
      }
    }

    // Log the sync
    await supabaseAdmin.from("zoom_sync_log").insert({
      sync_type: "meetings",
      status: "completed",
      completed_at: new Date().toISOString(),
      meetings_synced: meetingsSynced,
    })

    // Send notifications to all team members about today's meetings
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const todayMeetings = allMeetings.filter((m) => {
      const startTime = new Date(m.start_time)
      return startTime >= today && startTime < tomorrow
    })

    if (todayMeetings.length > 0) {
      // Get all team members
      const { data: teamMembers } = await supabaseAdmin.from("team_members").select("id").eq("is_active", true)

      if (teamMembers && teamMembers.length > 0) {
        const notifications = teamMembers.map((tm) => ({
          team_member_id: tm.id,
          type: "zoom_meeting",
          title: `${todayMeetings.length} Zoom meeting${todayMeetings.length > 1 ? "s" : ""} scheduled today`,
          message: todayMeetings.map((m) => `${m.topic} at ${new Date(m.start_time).toLocaleTimeString()}`).join(", "),
          is_read: false,
        }))

        await supabaseAdmin.from("notifications").insert(notifications)
      }
    }

    return NextResponse.json({
      success: true,
      meetingsSynced,
      todayMeetings: todayMeetings.length,
    })
  } catch (error) {
    console.error("[Zoom Master Meetings] Sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync meetings" },
      { status: 500 },
    )
  }
}
