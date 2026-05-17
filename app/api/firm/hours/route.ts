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

  // ── Resolve Karbon keys → Hub records ──────────────────────────────
  // The /Timesheets $expand=TimeEntries payload from Karbon doesn't
  // include UserName / ClientName on individual time entries, so the
  // upstream import writes those columns as null. Without resolution
  // the leadership dashboard renders every row as "Unknown" / "Unknown
  // client" — which is exactly the regression the user reported.
  //
  // We do the join in code (rather than Postgres) because:
  //   1. There's no FK between karbon_timesheets.user_key and
  //      team_members.karbon_user_key — cross-referencing those two
  //      columns inside PostgREST would require a view.
  //   2. The lookup tables are tiny (≈20 team members, ≈3k contacts,
  //      ≈700 orgs) and easily cached in memory per request.
  //   3. We want graceful fallback when a Karbon user/client isn't
  //      yet imported into the Hub (admins can fix at their leisure
  //      without breaking the dashboard).
  const distinctUserKeys = Array.from(new Set(entries.map((e) => e.user_key).filter(Boolean) as string[]))
  const distinctClientKeys = Array.from(new Set(entries.map((e) => e.client_key).filter(Boolean) as string[]))

  type MemberInfo = { id: string; name: string; avatarUrl: string | null }
  type ClientInfo = { type: "contact" | "organization"; id: string; name: string }

  const memberByKarbonKey = new Map<string, MemberInfo>()
  const clientByKarbonKey = new Map<string, ClientInfo>()

  if (distinctUserKeys.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, full_name, first_name, last_name, avatar_url, karbon_user_key")
      .in("karbon_user_key", distinctUserKeys)
    for (const m of members ?? []) {
      const key = (m as any).karbon_user_key as string | null
      if (!key) continue
      const name =
        (m as any).full_name ||
        [(m as any).first_name, (m as any).last_name].filter(Boolean).join(" ").trim() ||
        "(unnamed teammate)"
      memberByKarbonKey.set(key, {
        id: (m as any).id,
        name,
        avatarUrl: (m as any).avatar_url ?? null,
      })
    }
  }

  if (distinctClientKeys.length > 0) {
    // Karbon's `ClientKey` is overloaded — it can point at either a
    // person (contact) or an entity (organization). We try contacts
    // first because that's the more common case for a tax/accounting
    // firm; misses fall through to organizations.
    const [{ data: contacts }, { data: orgs }] = await Promise.all([
      supabase
        .from("contacts")
        .select("id, full_name, karbon_contact_key")
        .in("karbon_contact_key", distinctClientKeys),
      supabase
        .from("organizations")
        .select("id, name, karbon_organization_key")
        .in("karbon_organization_key", distinctClientKeys),
    ])
    for (const c of contacts ?? []) {
      const key = (c as any).karbon_contact_key as string | null
      if (!key) continue
      clientByKarbonKey.set(key, {
        type: "contact",
        id: (c as any).id,
        name: (c as any).full_name || "(unnamed contact)",
      })
    }
    for (const o of orgs ?? []) {
      const key = (o as any).karbon_organization_key as string | null
      if (!key || clientByKarbonKey.has(key)) continue // contacts win on collision
      clientByKarbonKey.set(key, {
        type: "organization",
        id: (o as any).id,
        name: (o as any).name || "(unnamed organization)",
      })
    }
  }

  // Resolved lookup helpers. These are the single source of truth for
  // the four breakdowns below — every call site uses them so the
  // "Unknown" fallback only fires when a Karbon key has truly never
  // been imported into the Hub.
  function resolveMemberName(userKey: string | null, fallback: string | null): string {
    if (userKey && memberByKarbonKey.has(userKey)) return memberByKarbonKey.get(userKey)!.name
    if (fallback) return fallback
    if (userKey) return `Unmapped (${userKey})`
    return "Unknown"
  }
  function resolveMemberId(userKey: string | null): string | null {
    return userKey && memberByKarbonKey.has(userKey) ? memberByKarbonKey.get(userKey)!.id : null
  }
  function resolveClientName(clientKey: string | null, fallback: string | null): string {
    if (clientKey && clientByKarbonKey.has(clientKey)) return clientByKarbonKey.get(clientKey)!.name
    if (fallback) return fallback
    if (clientKey) return `Unmapped (${clientKey})`
    return "Unknown client"
  }
  function resolveClient(clientKey: string | null): ClientInfo | null {
    return clientKey ? clientByKarbonKey.get(clientKey) ?? null : null
  }

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
      teamMemberId: string | null
      avatarUrl: string | null
      minutes: number
      billableMinutes: number
      billed: number
      entryCount: number
    }
  >()
  for (const e of recent) {
    // Group by Karbon user_key first (stable), falling back to the
    // resolved Hub display name so two unmapped keys don't collide.
    const groupKey = e.user_key || resolveMemberName(null, e.user_name)
    const member = e.user_key ? memberByKarbonKey.get(e.user_key) : null
    const cur = byMemberMap.get(groupKey) || {
      userKey: e.user_key,
      userName: resolveMemberName(e.user_key, e.user_name),
      teamMemberId: member?.id ?? null,
      avatarUrl: member?.avatarUrl ?? null,
      minutes: 0,
      billableMinutes: 0,
      billed: 0,
      entryCount: 0,
    }
    cur.minutes += e.minutes || 0
    if (e.is_billable) cur.billableMinutes += e.minutes || 0
    cur.billed += e.billed_amount || 0
    cur.entryCount += 1
    byMemberMap.set(groupKey, cur)
  }
  const byMember = [...byMemberMap.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map((m) => ({
      userKey: m.userKey,
      userName: m.userName,
      teamMemberId: m.teamMemberId,
      avatarUrl: m.avatarUrl,
      hours: round1(m.minutes / 60),
      billableHours: round1(m.billableMinutes / 60),
      billedAmount: round2(m.billed),
      entryCount: m.entryCount,
      utilization: m.minutes > 0 ? Math.round((m.billableMinutes / m.minutes) * 100) : 0,
    }))

  // By client — top 15 in the window.
  const byClientMap = new Map<
    string,
    {
      clientKey: string | null
      clientName: string
      hubClientType: "contact" | "organization" | null
      hubClientId: string | null
      minutes: number
      billableMinutes: number
      billed: number
    }
  >()
  for (const e of recent) {
    const groupKey = e.client_key || resolveClientName(null, e.client_name)
    const linked = resolveClient(e.client_key)
    const cur = byClientMap.get(groupKey) || {
      clientKey: e.client_key,
      clientName: resolveClientName(e.client_key, e.client_name),
      hubClientType: linked?.type ?? null,
      hubClientId: linked?.id ?? null,
      minutes: 0,
      billableMinutes: 0,
      billed: 0,
    }
    cur.minutes += e.minutes || 0
    if (e.is_billable) cur.billableMinutes += e.minutes || 0
    cur.billed += e.billed_amount || 0
    byClientMap.set(groupKey, cur)
  }
  const byClient = [...byClientMap.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 15)
    .map((c) => ({
      clientKey: c.clientKey,
      clientName: c.clientName,
      hubClientType: c.hubClientType,
      hubClientId: c.hubClientId,
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

  // Diagnostic surface for leadership: which Karbon user_keys appear
  // in time entries but have no matching team_members row? This is
  // the only data-quality issue that produces an "Unmapped" row in
  // the dashboard, and admins can resolve it by setting
  // `team_members.karbon_user_key` to the listed value.
  const unmappedUserKeys = distinctUserKeys.filter((k) => !memberByKarbonKey.has(k))
  const unmappedClientKeys = distinctClientKeys.filter((k) => !clientByKarbonKey.has(k))

  return NextResponse.json({
    summary,
    weeklyTrend,
    byMember,
    byClient,
    byWorkType,
    lastSyncedAt: syncRow?.last_synced_at || null,
    windowDays: days,
    diagnostics: {
      unmappedUserKeyCount: unmappedUserKeys.length,
      unmappedUserKeys: unmappedUserKeys.slice(0, 25),
      unmappedClientKeyCount: unmappedClientKeys.length,
      unmappedClientKeys: unmappedClientKeys.slice(0, 25),
    },
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
