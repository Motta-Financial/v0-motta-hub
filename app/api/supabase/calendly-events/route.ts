import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

function isTableNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const err = error as Record<string, unknown>
  if (err.code === "PGRST205") return true
  if (typeof err.message === "string" && err.message.includes("Could not find the table")) return true
  return false
}

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const startDate = searchParams.get("start_date")
  const endDate = searchParams.get("end_date")
  const limit = Number.parseInt(searchParams.get("limit") || "100")

  try {
    let query = supabase
      .from("calendly_events")
      .select(`
        id,
        calendly_uuid,
        calendly_uri,
        name,
        status,
        start_time,
        end_time,
        event_type_uuid,
        event_type_name,
        location_type,
        location,
        join_url,
        calendly_user_name,
        calendly_user_email,
        canceled_at,
        canceler_type,
        canceler_name,
        cancel_reason,
        rescheduled,
        meeting_id,
        team_member_id,
        synced_at,
        created_at,
        calendly_invitees (
          id,
          calendly_uuid,
          email,
          name,
          status,
          timezone,
          cancel_url,
          reschedule_url,
          questions_answers,
          contact_id,
          contacts:contact_id (
            id,
            full_name,
            primary_email,
            avatar_url
          )
        )
      `)
      .order("start_time", { ascending: true })
      .limit(limit)

    if (status) {
      query = query.eq("status", status)
    }

    if (startDate) {
      query = query.gte("start_time", startDate)
    }

    if (endDate) {
      query = query.lte("start_time", endDate)
    }

    const { data, error } = await query

    if (error) {
      if (isTableNotFoundError(error)) {
        return NextResponse.json({ events: [], tableExists: false })
      }
      console.error("Error fetching calendly events:", error)
      return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 })
    }

    return NextResponse.json({ events: data || [], tableExists: true })
  } catch (error) {
    console.error("Error:", error)
    return NextResponse.json({ events: [], tableExists: false })
  }
}

export async function POST(request: Request) {
  const supabase = createAdminClient()
  const { type } = await request.json().catch(() => ({}))

  if (type === "event_types") {
    const { data, error } = await supabase
      .from("calendly_event_types")
      .select("*")
      .eq("active", true)
      .order("name", { ascending: true })

    if (error) {
      if (isTableNotFoundError(error)) {
        return NextResponse.json({ eventTypes: [], tableExists: false })
      }
      return NextResponse.json({ error: "Failed to fetch event types" }, { status: 500 })
    }

    return NextResponse.json({ eventTypes: data || [], tableExists: true })
  }

  if (type === "sync_status") {
    const { data, error } = await supabase
      .from("calendly_sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(5)

    if (error) {
      return NextResponse.json({ syncHistory: [] })
    }

    return NextResponse.json({ syncHistory: data || [] })
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 })
}
