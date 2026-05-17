import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/profile/hours
 *
 * Returns the logged-in user's Karbon time-tracking summary, sourced from
 * `karbon_timesheets` (synced from Karbon's /Timesheets endpoint, expanded
 * with TimeEntries — see app/api/karbon/timesheets/route.ts and
 * app/api/cron/karbon-timesheets-sync/route.ts).
 *
 * The user is matched via team_members.karbon_user_key. If the current
 * user has no Karbon mapping, we 200 with empty data so the UI can show
 * an explanatory empty state.
 *
 * Query params:
 *   - userKey (optional, admin-only): override which user to look up.
 *     Used by future admin views, ignored here for self-service.
 *
 * Response:
 *   {
 *     karbonUserKey: string | null,
 *     summary: { thisWeek, mtd, ytd, allTime } each { hours, billableHours, billedAmount, entryCount },
 *     weeklyTrend: Array<{ weekStart: string, hours: number, billableHours: number }>, // last 12 weeks
 *     byClient: Array<{ clientKey, clientName, hours, billableHours, billedAmount }>,  // top 10 last 90d
 *     byWorkType: Array<{ taskTypeName, hours }>, // top 8 last 90d
 *     recent: Array<TimesheetRow> // last 30 entries
 *   }
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await getAuthenticatedUser(supabase)

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Resolve the user's Karbon UserKey via team_members.
    const { data: teamMember, error: tmError } = await supabase
      .from("team_members")
      .select("id, karbon_user_key, full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle()

    if (tmError) {
      console.error("[v0] hours: team_member lookup failed", tmError.message)
      return NextResponse.json({ error: "Failed to load team member" }, { status: 500 })
    }

    if (!teamMember?.karbon_user_key) {
      return NextResponse.json({
        karbonUserKey: null,
        teamMember: teamMember ? { id: teamMember.id, full_name: teamMember.full_name } : null,
        summary: emptySummary(),
        weeklyTrend: [],
        byClient: [],
        byWorkType: [],
        recent: [],
        message: "No Karbon user link found for this profile.",
      })
    }

    const karbonUserKey = teamMember.karbon_user_key

    // Pull all timesheets for this user. The table only has ~3k rows total
    // for the whole firm, so per-user is small enough to compute summaries
    // in app code without a SQL view.
    const { data: rows, error: tsError } = await supabase
      .from("karbon_timesheets")
      .select(
        "karbon_timesheet_key,date,minutes,description,is_billable,billing_status,hourly_rate,billed_amount," +
          "karbon_work_item_key,work_item_title,client_key,client_name,task_type_name,role_name,karbon_url",
      )
      .eq("user_key", karbonUserKey)
      .order("date", { ascending: false })
      .limit(5000)

    if (tsError) {
      console.error("[v0] hours: timesheets query failed", tsError.message)
      return NextResponse.json({ error: "Failed to load timesheets" }, { status: 500 })
    }

    const entries = ((rows ?? []) as unknown) as Array<{
      karbon_timesheet_key: string
      date: string | null
      minutes: number | null
      description: string | null
      is_billable: boolean | null
      billing_status: string | null
      hourly_rate: number | null
      billed_amount: number | null
      karbon_work_item_key: string | null
      work_item_title: string | null
      client_key: string | null
      client_name: string | null
      task_type_name: string | null
      role_name: string | null
      karbon_url: string | null
    }>

    // ---- Date buckets (in user's local-ish ET; just use ISO date strings) ----
    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = today.getMonth()

    // Sunday-anchored week start
    const weekStart = new Date(today)
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(today.getDate() - today.getDay())

    const monthStart = new Date(yyyy, mm, 1)
    const yearStart = new Date(yyyy, 0, 1)

    const weekStartIso = weekStart.toISOString().slice(0, 10)
    const monthStartIso = monthStart.toISOString().slice(0, 10)
    const yearStartIso = yearStart.toISOString().slice(0, 10)

    const summary = {
      thisWeek: aggregate(entries.filter((e) => e.date && e.date >= weekStartIso)),
      mtd: aggregate(entries.filter((e) => e.date && e.date >= monthStartIso)),
      ytd: aggregate(entries.filter((e) => e.date && e.date >= yearStartIso)),
      allTime: aggregate(entries),
    }

    // ---- Weekly trend, last 12 weeks ----
    const weeklyTrend: Array<{ weekStart: string; hours: number; billableHours: number }> = []
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(weekStart)
      ws.setDate(weekStart.getDate() - i * 7)
      const we = new Date(ws)
      we.setDate(ws.getDate() + 7)
      const wsIso = ws.toISOString().slice(0, 10)
      const weIso = we.toISOString().slice(0, 10)
      const inWeek = entries.filter((e) => e.date && e.date >= wsIso && e.date < weIso)
      const totalMin = inWeek.reduce((s, e) => s + (e.minutes || 0), 0)
      const billMin = inWeek.filter((e) => e.is_billable).reduce((s, e) => s + (e.minutes || 0), 0)
      weeklyTrend.push({
        weekStart: wsIso,
        hours: round1(totalMin / 60),
        billableHours: round1(billMin / 60),
      })
    }

    // ---- Last-90-day breakdowns ----
    const ninetyAgo = new Date(today)
    ninetyAgo.setDate(today.getDate() - 90)
    const ninetyIso = ninetyAgo.toISOString().slice(0, 10)
    const recent90 = entries.filter((e) => e.date && e.date >= ninetyIso)

    const byClientMap = new Map<
      string,
      { clientKey: string | null; clientName: string; minutes: number; billableMinutes: number; billed: number }
    >()
    for (const e of recent90) {
      const key = e.client_key || e.client_name || "unknown"
      const cur = byClientMap.get(key) || {
        clientKey: e.client_key,
        clientName: e.client_name || "Unknown client",
        minutes: 0,
        billableMinutes: 0,
        billed: 0,
      }
      cur.minutes += e.minutes || 0
      if (e.is_billable) cur.billableMinutes += e.minutes || 0
      cur.billed += e.billed_amount || 0
      byClientMap.set(key, cur)
    }
    const byClient = [...byClientMap.values()]
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10)
      .map((c) => ({
        clientKey: c.clientKey,
        clientName: c.clientName,
        hours: round1(c.minutes / 60),
        billableHours: round1(c.billableMinutes / 60),
        billedAmount: round2(c.billed),
      }))

    const byWorkTypeMap = new Map<string, number>()
    for (const e of recent90) {
      const key = e.task_type_name || e.role_name || "Other"
      byWorkTypeMap.set(key, (byWorkTypeMap.get(key) || 0) + (e.minutes || 0))
    }
    const byWorkType = [...byWorkTypeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([taskTypeName, minutes]) => ({ taskTypeName, hours: round1(minutes / 60) }))

    const recent = entries.slice(0, 30).map((e) => ({
      key: e.karbon_timesheet_key,
      date: e.date,
      hours: round2((e.minutes || 0) / 60),
      minutes: e.minutes || 0,
      isBillable: !!e.is_billable,
      billingStatus: e.billing_status,
      description: e.description,
      taskTypeName: e.task_type_name,
      clientName: e.client_name,
      workItemTitle: e.work_item_title,
      billedAmount: e.billed_amount,
      karbonUrl: e.karbon_url,
    }))

    // Last sync timestamp — most recent updated_at across user's rows
    const { data: syncRow } = await supabase
      .from("karbon_timesheets")
      .select("last_synced_at")
      .eq("user_key", karbonUserKey)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      karbonUserKey,
      teamMember: { id: teamMember.id, full_name: teamMember.full_name },
      lastSyncedAt: syncRow?.last_synced_at || null,
      summary,
      weeklyTrend,
      byClient,
      byWorkType,
      recent,
    })
  } catch (error) {
    console.error("[v0] hours: unexpected error", error)
    return NextResponse.json({ error: "Failed to load hours" }, { status: 500 })
  }
}

function aggregate(rows: Array<{ minutes: number | null; is_billable: boolean | null; billed_amount: number | null }>) {
  const minutes = rows.reduce((s, r) => s + (r.minutes || 0), 0)
  const billableMinutes = rows
    .filter((r) => r.is_billable)
    .reduce((s, r) => s + (r.minutes || 0), 0)
  const billedAmount = rows.reduce((s, r) => s + (r.billed_amount || 0), 0)
  return {
    hours: round1(minutes / 60),
    billableHours: round1(billableMinutes / 60),
    nonBillableHours: round1((minutes - billableMinutes) / 60),
    billedAmount: round2(billedAmount),
    entryCount: rows.length,
  }
}

function emptySummary() {
  return {
    thisWeek: { hours: 0, billableHours: 0, nonBillableHours: 0, billedAmount: 0, entryCount: 0 },
    mtd: { hours: 0, billableHours: 0, nonBillableHours: 0, billedAmount: 0, entryCount: 0 },
    ytd: { hours: 0, billableHours: 0, nonBillableHours: 0, billedAmount: 0, entryCount: 0 },
    allTime: { hours: 0, billableHours: 0, nonBillableHours: 0, billedAmount: 0, entryCount: 0 },
  }
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}
function round2(n: number) {
  return Math.round(n * 100) / 100
}
