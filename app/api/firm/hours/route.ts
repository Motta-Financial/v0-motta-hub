import { type NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireLeadership } from "@/lib/auth/require-leadership"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/firm/hours
 *
 * Firm-wide Karbon time-tracking dashboard data, restricted to PPD
 * (Partner / Principal / Director). Aggregates the SAME `karbon_timesheets`
 * table that backs the per-user /api/profile/hours endpoint, but rolled
 * up across every team member who tracks time in Karbon.
 *
 * The data shape intentionally mirrors the per-user endpoint where
 * possible so the leadership client component can re-use the visual
 * grammar (summary cards, weekly trend bars, top tables) — it just
 * adds a `byMember` slice on top.
 *
 * Auth: requireLeadership() — 401 / 403 on failure.
 *
 * Query params:
 *   - days  number (default 90)        // window for breakdowns + member table
 *   - tz    "America/New_York" (default)// week/MTD/YTD reference timezone
 *
 * Response:
 *   {
 *     summary: { thisWeek, mtd, ytd, allTime } each { hours, billableHours, billedAmount, entryCount, memberCount },
 *     weeklyTrend: Array<{ weekStart: string, hours: number, billableHours: number }>, // last 12 weeks, firm-wide
 *     byMember: Array<{ userKey, userName, hours, billableHours, billedAmount, entryCount }>, // last `days`, sorted desc
 *     byClient: Array<{ clientKey, clientName, hours, billableHours, billedAmount }>, // last `days`, top 15
 *     byWorkType: Array<{ taskTypeName, hours }>, // last `days`, top 10
 *     lastSyncedAt: string | null,
 *     windowDays: number,
 *   }
 *
 * Notes:
 *   - We use the service-role client AFTER passing requireLeadership(),
 *     because the table has no per-row policy distinguishing admins
 *     from rank-and-file. The gate above is the single source of truth
 *     for who's allowed to see firm-wide hours.
 *   - We pull at most 50,000 rows in one shot — the table has ~2,800
 *     today; even with several years of growth this stays well under
 *     PostgREST's hard limit. If the table ever blows past 50k we'll
 *     swap this for a SQL view.
 */
export async function GET(request: NextRequest) {
  const gate = await requireLeadership()
  if (!gate.ok) return gate.response

  const sp = request.nextUrl.searchParams
  const days = Math.max(1, Math.min(parseInt(sp.get("days") || "90", 10) || 90, 365))

  // Service-role client: the leadership gate already authorised the
  // caller. Using the SSR (cookie) client here would force every
  // future RLS policy on `karbon_timesheets` to special-case PPD,
  // which is brittle.
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: rows, error } = await supabase
    .from("karbon_timesheets")
    .select(
      "karbon_timesheet_key,date,minutes,description,is_billable,billing_status,hourly_rate,billed_amount," +
        "user_key,user_name,karbon_work_item_key,work_item_title,client_key,client_name,task_type_name,role_name",
    )
    .order("date", { ascending: false })
    .limit(50000)

  if (error) {
    console.error("[v0] firm-hours: query failed", error.message)
    return NextResponse.json({ error: "Failed to load timesheets" }, { status: 500 })
  }

  const entries = ((rows ?? []) as unknown) as Array<{
    karbon_timesheet_key: string
    date: string | null
    minutes: number | null
    is_billable: boolean | null
    billed_amount: number | null
    user_key: string | null
    user_name: string | null
    karbon_work_item_key: string | null
    work_item_title: string | null
    client_key: string | null
    client_name: string | null
    task_type_name: string | null
    role_name: string | null
  }>

  // ---- Date buckets (server-local; close enough for ET-based firm) ----
  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(today.getDate() - today.getDay()) // Sunday
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const yearStart = new Date(today.getFullYear(), 0, 1)
  const weekStartIso = weekStart.toISOString().slice(0, 10)
  const monthStartIso = monthStart.toISOString().slice(0, 10)
  const yearStartIso = yearStart.toISOString().slice(0, 10)

  const summary = {
    thisWeek: aggregate(entries.filter((e) => e.date && e.date >= weekStartIso)),
    mtd: aggregate(entries.filter((e) => e.date && e.date >= monthStartIso)),
    ytd: aggregate(entries.filter((e) => e.date && e.date >= yearStartIso)),
    allTime: aggregate(entries),
  }

  // ---- Weekly trend, last 12 firm-wide weeks ----
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

  // ---- N-day breakdowns ----
  const windowStart = new Date(today)
  windowStart.setDate(today.getDate() - days)
  const windowIso = windowStart.toISOString().slice(0, 10)
  const recent = entries.filter((e) => e.date && e.date >= windowIso)

  // By member — the headline table on the leadership page.
  const byMemberMap = new Map<
    string,
    {
      userKey: string | null
      userName: string
      minutes: number
      billableMinutes: number
      billed: number
      entryCount: number
    }
  >()
  for (const e of recent) {
    const key = e.user_key || e.user_name || "unknown"
    const cur = byMemberMap.get(key) || {
      userKey: e.user_key,
      userName: e.user_name || "Unknown",
      minutes: 0,
      billableMinutes: 0,
      billed: 0,
      entryCount: 0,
    }
    cur.minutes += e.minutes || 0
    if (e.is_billable) cur.billableMinutes += e.minutes || 0
    cur.billed += e.billed_amount || 0
    cur.entryCount += 1
    byMemberMap.set(key, cur)
  }
  const byMember = [...byMemberMap.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map((m) => ({
      userKey: m.userKey,
      userName: m.userName,
      hours: round1(m.minutes / 60),
      billableHours: round1(m.billableMinutes / 60),
      billedAmount: round2(m.billed),
      entryCount: m.entryCount,
      utilization: m.minutes > 0 ? Math.round((m.billableMinutes / m.minutes) * 100) : 0,
    }))

  // By client — top 15 in the window.
  const byClientMap = new Map<
    string,
    { clientKey: string | null; clientName: string; minutes: number; billableMinutes: number; billed: number }
  >()
  for (const e of recent) {
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
    .slice(0, 15)
    .map((c) => ({
      clientKey: c.clientKey,
      clientName: c.clientName,
      hours: round1(c.minutes / 60),
      billableHours: round1(c.billableMinutes / 60),
      billedAmount: round2(c.billed),
    }))

  // By work type — top 10 in the window.
  const byWorkTypeMap = new Map<string, number>()
  for (const e of recent) {
    const key = e.task_type_name || e.role_name || "Other"
    byWorkTypeMap.set(key, (byWorkTypeMap.get(key) || 0) + (e.minutes || 0))
  }
  const byWorkType = [...byWorkTypeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([taskTypeName, minutes]) => ({ taskTypeName, hours: round1(minutes / 60) }))

  const { data: syncRow } = await supabase
    .from("karbon_timesheets")
    .select("last_synced_at")
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    summary,
    weeklyTrend,
    byMember,
    byClient,
    byWorkType,
    lastSyncedAt: syncRow?.last_synced_at || null,
    windowDays: days,
  })
}

function aggregate(
  rows: Array<{ minutes: number | null; is_billable: boolean | null; billed_amount: number | null; user_key: string | null }>,
) {
  const minutes = rows.reduce((s, r) => s + (r.minutes || 0), 0)
  const billableMinutes = rows.filter((r) => r.is_billable).reduce((s, r) => s + (r.minutes || 0), 0)
  const billedAmount = rows.reduce((s, r) => s + (r.billed_amount || 0), 0)
  // Distinct member count gives leadership an at-a-glance "how much of
  // the firm logged time this period" stat without an extra query.
  const memberCount = new Set(rows.map((r) => r.user_key).filter(Boolean)).size
  return {
    hours: round1(minutes / 60),
    billableHours: round1(billableMinutes / 60),
    nonBillableHours: round1((minutes - billableMinutes) / 60),
    billedAmount: round2(billedAmount),
    entryCount: rows.length,
    memberCount,
  }
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}
function round2(n: number) {
  return Math.round(n * 100) / 100
}
