import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

/**
 * POST /api/tommy-awards/ensure-week
 *
 * Ensures a tommy_award_weeks row exists for the given week_date (YYYY-MM-DD).
 * Returns the existing or newly-created row.
 *
 * The voting form calls this server-side so it doesn't need INSERT privileges
 * via the browser Supabase client (which may be blocked by RLS or Zscaler).
 */
export async function POST(request: NextRequest) {
  let body: { week_date: string; week_name: string }
  try {
    body = (await request.json()) as { week_date: string; week_name: string }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.week_date || !body.week_name) {
    return NextResponse.json({ error: "week_date and week_name are required" }, { status: 400 })
  }

  const supabase = await createClient()

  // Try to fetch first (avoid unnecessary insert attempt)
  const { data: existing } = await supabase
    .from("tommy_award_weeks")
    .select("id, week_date, week_name, is_active")
    .eq("week_date", body.week_date)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ week: existing })
  }

  // Insert the new week
  const { data: newWeek, error: insertError } = await supabase
    .from("tommy_award_weeks")
    .insert({
      week_date: body.week_date,
      week_name: body.week_name,
      is_active: true,
    })
    .select("id, week_date, week_name, is_active")
    .single()

  if (insertError) {
    // Duplicate key race condition — someone else inserted between our SELECT and INSERT
    if (insertError.code === "23505") {
      const { data: racedWeek } = await supabase
        .from("tommy_award_weeks")
        .select("id, week_date, week_name, is_active")
        .eq("week_date", body.week_date)
        .single()
      return NextResponse.json({ week: racedWeek })
    }
    console.error("[v0] ensure-week insert error:", insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ week: newWeek })
}
