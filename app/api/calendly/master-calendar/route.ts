import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Helper to refresh token if needed
async function getValidAccessToken(connection: any, supabase: any): Promise<string | null> {
  const expiresAt = new Date(connection.expires_at)
  const now = new Date()

  // If token expires in less than 5 minutes, refresh it
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    const CALENDLY_CLIENT_ID = process.env.CALENDLY_CLIENT_ID!
    const CALENDLY_CLIENT_SECRET = process.env.CALENDLY_CLIENT_SECRET!

    const tokenResponse = await fetch("https://auth.calendly.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CALENDLY_CLIENT_ID,
        client_secret: CALENDLY_CLIENT_SECRET,
        refresh_token: connection.refresh_token,
      }),
    })

    if (!tokenResponse.ok) {
      await supabase.from("calendly_connections").update({ is_active: false }).eq("id", connection.id)
      return null
    }

    const tokens = await tokenResponse.json()
    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    await supabase
      .from("calendly_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || connection.refresh_token,
        expires_at: newExpiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id)

    return tokens.access_token
  }

  return connection.access_token
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const minDate = searchParams.get("min_date") || new Date().toISOString()
    const maxDate = searchParams.get("max_date") || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const supabase = await createClient()

    // Get all active connections
    const { data: connections, error: connError } = await supabase
      .from("calendly_connections")
      .select(`
        *,
        team_members (
          id,
          full_name,
          email,
          avatar_url,
          title
        )
      `)
      .eq("is_active", true)
      .eq("sync_enabled", true)

    if (connError) {
      console.error("Failed to fetch connections:", connError)
      return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 })
    }

    if (!connections || connections.length === 0) {
      return NextResponse.json({
        events: [],
        connections: [],
        message: "No active Calendly connections found",
      })
    }

    // Fetch events from each connected user
    const allEvents: any[] = []
    const connectionStatuses: any[] = []

    for (const connection of connections) {
      const accessToken = await getValidAccessToken(connection, supabase)

      if (!accessToken) {
        connectionStatuses.push({
          teamMember: connection.team_members,
          status: "token_expired",
          error: "Token refresh failed",
        })
        continue
      }

      try {
        // Fetch scheduled events for this user
        const eventsUrl = new URL("https://api.calendly.com/scheduled_events")
        eventsUrl.searchParams.set("user", connection.calendly_user_uri)
        eventsUrl.searchParams.set("min_start_time", minDate)
        eventsUrl.searchParams.set("max_start_time", maxDate)
        eventsUrl.searchParams.set("status", "active")
        eventsUrl.searchParams.set("count", "100")

        const eventsResponse = await fetch(eventsUrl.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        })

        if (!eventsResponse.ok) {
          connectionStatuses.push({
            teamMember: connection.team_members,
            status: "fetch_failed",
            error: `HTTP ${eventsResponse.status}`,
          })
          continue
        }

        const { collection: events } = await eventsResponse.json()

        // Fetch invitees for each event
        for (const event of events) {
          const inviteesResponse = await fetch(`${event.uri}/invitees`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          })

          let invitees: any[] = []
          if (inviteesResponse.ok) {
            const inviteesData = await inviteesResponse.json()
            invitees = inviteesData.collection || []
          }

          allEvents.push({
            ...event,
            invitees,
            host: {
              teamMemberId: connection.team_member_id,
              name: connection.team_members?.full_name || connection.calendly_user_name,
              email: connection.team_members?.email || connection.calendly_user_email,
              avatar: connection.team_members?.avatar_url || connection.calendly_user_avatar,
              title: connection.team_members?.title,
            },
          })
        }

        // Update last synced time
        await supabase
          .from("calendly_connections")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", connection.id)

        connectionStatuses.push({
          teamMember: connection.team_members,
          status: "synced",
          eventCount: events.length,
        })
      } catch (err) {
        console.error(`Error fetching events for ${connection.calendly_user_email}:`, err)
        connectionStatuses.push({
          teamMember: connection.team_members,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }

    // Sort all events by start time
    allEvents.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

    return NextResponse.json({
      events: allEvents,
      connections: connectionStatuses,
      totalConnections: connections.length,
      totalEvents: allEvents.length,
    })
  } catch (error) {
    console.error("Master calendar error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST to sync all events to Supabase and send notifications
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // First get all events from master calendar
    const eventsResponse = await fetch(`${request.nextUrl.origin}/api/calendly/master-calendar`, {
      headers: request.headers,
    })

    if (!eventsResponse.ok) {
      return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 })
    }

    const { events } = await eventsResponse.json()

    let synced = 0
    let notificationsSent = 0

    for (const event of events) {
      // Extract UUID from URI
      const eventUuid = event.uri.split("/").pop()

      // Check if event already exists
      const { data: existing } = await supabase
        .from("calendly_events")
        .select("id")
        .eq("calendly_uuid", eventUuid)
        .single()

      const isNew = !existing

      // Upsert event
      const { data: savedEvent, error: eventError } = await supabase
        .from("calendly_events")
        .upsert(
          {
            calendly_uuid: eventUuid,
            calendly_uri: event.uri,
            name: event.name,
            status: event.status,
            start_time: event.start_time,
            end_time: event.end_time,
            event_type_uuid: event.event_type?.split("/").pop(),
            location_type: event.location?.type,
            location: event.location?.location,
            join_url: event.location?.join_url,
            calendly_user_uri: event.event_memberships?.[0]?.user,
            calendly_user_name: event.host?.name,
            calendly_user_email: event.host?.email,
            team_member_id: event.host?.teamMemberId,
            calendly_created_at: event.created_at,
            calendly_updated_at: event.updated_at,
            synced_at: new Date().toISOString(),
            raw_data: event,
          },
          {
            onConflict: "calendly_uuid",
          },
        )
        .select()
        .single()

      if (!eventError && savedEvent) {
        synced++

        // Sync invitees
        for (const invitee of event.invitees || []) {
          const inviteeUuid = invitee.uri.split("/").pop()

          await supabase.from("calendly_invitees").upsert(
            {
              calendly_uuid: inviteeUuid,
              calendly_uri: invitee.uri,
              calendly_event_id: savedEvent.id,
              calendly_event_uuid: eventUuid,
              name: invitee.name,
              email: invitee.email,
              timezone: invitee.timezone,
              status: invitee.status,
              reschedule_url: invitee.reschedule_url,
              cancel_url: invitee.cancel_url,
              questions_answers: invitee.questions_and_answers,
              calendly_created_at: invitee.created_at,
              calendly_updated_at: invitee.updated_at,
              synced_at: new Date().toISOString(),
              raw_data: invitee,
            },
            {
              onConflict: "calendly_uuid",
            },
          )
        }

        // Send notifications for new events
        if (isNew) {
          // Get all active team members
          const { data: teamMembers } = await supabase.from("team_members").select("id").eq("is_active", true).not("role", "eq", "Company").not("role", "eq", "Alumni")

          if (teamMembers) {
            const inviteeNames = (event.invitees || []).map((i: any) => i.name || i.email).join(", ")
            const startTime = new Date(event.start_time).toLocaleString()

            for (const member of teamMembers) {
              await supabase.from("notifications").insert({
                team_member_id: member.id,
                type: "calendly_event",
                title: `New Meeting Scheduled: ${event.name}`,
                message: `${event.host?.name || "A team member"} has a meeting with ${inviteeNames || "a client"} on ${startTime}`,
                data: {
                  eventId: savedEvent.id,
                  eventUuid,
                  hostName: event.host?.name,
                  invitees: event.invitees?.map((i: any) => ({ name: i.name, email: i.email })),
                  startTime: event.start_time,
                  endTime: event.end_time,
                },
                is_read: false,
              })

              notificationsSent++
            }
          }
        }
      }
    }

    // Log sync
    await supabase.from("calendly_sync_log").insert({
      sync_type: "master_calendar",
      status: "completed",
      completed_at: new Date().toISOString(),
      events_synced: synced,
      invitees_synced: events.reduce((acc: number, e: any) => acc + (e.invitees?.length || 0), 0),
    })

    return NextResponse.json({
      success: true,
      synced,
      notificationsSent,
      totalEvents: events.length,
    })
  } catch (error) {
    console.error("Master calendar sync error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
