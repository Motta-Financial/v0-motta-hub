import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(request: Request) {
  const accessToken = process.env.CALENDLY_ACCESS_TOKEN

  if (!accessToken) {
    return NextResponse.json({ error: "Calendly access token not configured" }, { status: 401 })
  }

  try {
    const {
      syncPast = false,
      daysBack = 30,
      daysForward = 90,
      syncEventTypes = true,
    } = await request.json().catch(() => ({}))

    // Get the current user
    const userResponse = await fetch("https://api.calendly.com/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!userResponse.ok) {
      throw new Error(`Failed to fetch Calendly user: ${userResponse.status}`)
    }

    const userData = await userResponse.json()
    const userUri = userData.resource.uri
    const userName = userData.resource.name
    const userEmail = userData.resource.email

    // Create sync log entry
    const { data: syncLog } = await supabase
      .from("calendly_sync_log")
      .insert({
        sync_type: syncPast ? "full" : "incremental",
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    // Calculate date range
    const now = new Date()
    const minStartTime = syncPast
      ? new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString()
      : now.toISOString()
    const maxStartTime = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString()

    let syncedEvents = 0
    let syncedInvitees = 0
    let syncedEventTypes = 0
    const errors: string[] = []

    if (syncEventTypes) {
      try {
        const eventTypesResponse = await fetch(
          `https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&count=100`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          },
        )

        if (eventTypesResponse.ok) {
          const eventTypesData = await eventTypesResponse.json()
          const eventTypes = eventTypesData.collection || []

          for (const eventType of eventTypes) {
            const eventTypeUuid = eventType.uri.split("/").pop()

            const { error: etError } = await supabase.from("calendly_event_types").upsert(
              {
                calendly_uuid: eventTypeUuid,
                calendly_uri: eventType.uri,
                name: eventType.name,
                slug: eventType.slug,
                description_plain: eventType.description_plain,
                description_html: eventType.description_html,
                duration_minutes: eventType.duration,
                kind: eventType.kind,
                type: eventType.type,
                pooling_type: eventType.pooling_type,
                active: eventType.active,
                booking_method: eventType.booking_method,
                color: eventType.color,
                scheduling_url: eventType.scheduling_url,
                secret: eventType.secret,
                calendly_user_uri: eventType.profile?.owner,
                raw_data: eventType,
                calendly_created_at: eventType.created_at,
                calendly_updated_at: eventType.updated_at,
                synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              {
                onConflict: "calendly_uuid",
              },
            )

            if (!etError) {
              syncedEventTypes++
            } else {
              errors.push(`Event type ${eventType.name}: ${etError.message}`)
            }
          }
        }
      } catch (etErr) {
        errors.push(`Event types sync failed: ${etErr}`)
      }
    }

    // Fetch scheduled events
    const params = new URLSearchParams({
      user: userUri,
      min_start_time: minStartTime,
      max_start_time: maxStartTime,
      count: "100",
      sort: "start_time:asc",
    })

    const eventsResponse = await fetch(`https://api.calendly.com/scheduled_events?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!eventsResponse.ok) {
      throw new Error(`Failed to fetch Calendly events: ${eventsResponse.status}`)
    }

    const eventsData = await eventsResponse.json()
    const events = eventsData.collection || []

    // Process each event
    for (const event of events) {
      const eventUuid = event.uri.split("/").pop()
      const eventTypeUuid = event.event_type?.split("/").pop()

      // Get location details
      const location = event.location || {}

      const { data: upsertedEvent, error: eventError } = await supabase
        .from("calendly_events")
        .upsert(
          {
            calendly_uuid: eventUuid,
            calendly_uri: event.uri,
            name: event.name,
            status: event.status,
            start_time: event.start_time,
            end_time: event.end_time,
            event_type_uuid: eventTypeUuid,
            event_type_name: event.event_type_name || event.name,
            location_type: location.type,
            location: location.location,
            join_url: location.join_url,
            calendly_user_uri: userUri,
            calendly_user_name: userName,
            calendly_user_email: userEmail,
            canceled_at: event.cancellation?.canceled_at,
            canceler_type: event.cancellation?.canceler_type,
            canceler_name: event.cancellation?.canceler?.name,
            cancel_reason: event.cancellation?.reason,
            rescheduled: event.rescheduled || false,
            raw_data: event,
            calendly_created_at: event.created_at,
            calendly_updated_at: event.updated_at,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "calendly_uuid",
          },
        )
        .select()
        .single()

      if (eventError) {
        errors.push(`Event ${eventUuid}: ${eventError.message}`)
        continue
      }

      syncedEvents++

      try {
        const inviteesResponse = await fetch(`${event.uri}/invitees`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        })

        if (inviteesResponse.ok) {
          const inviteesData = await inviteesResponse.json()
          const invitees = inviteesData.collection || []

          for (const invitee of invitees) {
            const inviteeUuid = invitee.uri.split("/").pop()

            // Try to find matching contact by email
            const { data: matchingContact } = await supabase
              .from("contacts")
              .select("id")
              .or(`primary_email.ilike.${invitee.email},secondary_email.ilike.${invitee.email}`)
              .limit(1)
              .maybeSingle()

            const { error: inviteeError } = await supabase.from("calendly_invitees").upsert(
              {
                calendly_uuid: inviteeUuid,
                calendly_uri: invitee.uri,
                calendly_event_id: upsertedEvent?.id,
                calendly_event_uuid: eventUuid,
                email: invitee.email,
                name: invitee.name,
                status: invitee.status,
                timezone: invitee.timezone,
                reschedule_url: invitee.reschedule_url,
                cancel_url: invitee.cancel_url,
                canceled_at: invitee.cancellation?.canceled_at,
                canceler_type: invitee.cancellation?.canceler_type,
                cancel_reason: invitee.cancellation?.reason,
                questions_answers: invitee.questions_and_answers,
                utm_source: invitee.tracking?.utm_source,
                utm_medium: invitee.tracking?.utm_medium,
                utm_campaign: invitee.tracking?.utm_campaign,
                utm_term: invitee.tracking?.utm_term,
                utm_content: invitee.tracking?.utm_content,
                contact_id: matchingContact?.id || null,
                raw_data: invitee,
                calendly_created_at: invitee.created_at,
                calendly_updated_at: invitee.updated_at,
                synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              {
                onConflict: "calendly_uuid",
              },
            )

            if (!inviteeError) {
              syncedInvitees++
            } else {
              errors.push(`Invitee ${invitee.email}: ${inviteeError.message}`)
            }
          }
        }
      } catch (inviteeErr) {
        errors.push(`Invitees for event ${eventUuid}: ${inviteeErr}`)
      }

      // Also sync to meetings table for unified view
      await supabase.from("meetings").upsert(
        {
          calendly_event_id: eventUuid,
          title: event.name,
          scheduled_start: event.start_time,
          scheduled_end: event.end_time,
          status: event.status === "active" ? "scheduled" : "cancelled",
          location_type: location.type || "virtual",
          video_link: location.join_url,
          meeting_type: "client_meeting",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "calendly_event_id",
          ignoreDuplicates: false,
        },
      )
    }

    if (syncLog?.id) {
      await supabase
        .from("calendly_sync_log")
        .update({
          status: errors.length > 0 ? "completed_with_errors" : "completed",
          completed_at: new Date().toISOString(),
          events_synced: syncedEvents,
          invitees_synced: syncedInvitees,
          event_types_synced: syncedEventTypes,
          errors: errors.length > 0 ? errors : null,
        })
        .eq("id", syncLog.id)
    }

    return NextResponse.json({
      success: true,
      synced: {
        events: syncedEvents,
        invitees: syncedInvitees,
        eventTypes: syncedEventTypes,
      },
      dateRange: {
        from: minStartTime,
        to: maxStartTime,
      },
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error("Calendly sync error:", error)
    return NextResponse.json({ error: "Failed to sync Calendly data" }, { status: 500 })
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from("calendly_sync_log")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("Error fetching sync status:", error)
    return NextResponse.json({ lastSync: null })
  }

  return NextResponse.json({ lastSync: data })
}
