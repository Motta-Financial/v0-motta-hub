import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── ProConnect client roster with pagination ─────────────────────────
// Stat cards use count queries (no data transfer, works past 1000 rows).
// The table uses .range() pagination — 50 rows per page by default.
// For rollups PostgREST can't express (distinct counts, column-level
// comparisons, group-by) we walk the table in 1,000-row pages so we
// don't silently truncate at the cap.

const TABLE_PAGE_SIZE = 50
const SCAN_PAGE_SIZE = 1000

type ProconnectClient = {
  id: string
  proconnect_client_id: string | null
  proconnect_entity_id: string | null
  top_level_entity_id: string | null
  client_type: string | null
  client_state: string | null
  display_name: string | null
  business_name: string | null
  name_for_matching: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  zip: string | null
  tax_id: string | null
  created_at: string | null
  updated_at: string | null
}

type MasterMappingRow = {
  internal_client_id: string
  client_type: "PERSON" | "ORGANIZATION"
  display_name: string | null
  primary_email: string | null
  karbon_client_id: string | null
  ignition_client_id: string | null
  proconnect_client_id: string | null
  karbon_url: string | null
  linked_systems: string[] | null
  link_count: number | null
}

type ProconnectEngagement = {
  id: string
  engagement_id: string | null
  proconnect_client_id: string | null
  tax_year: number | null
  return_type: string | null
  form_type: string | null
  status: string | null
  efile_status: string | null
  work_status: string | null
  assignee_profile_id: string | null
  raw_json: Record<string, unknown> | null
  synced_at: string | null
  updated_at: string | null
}

// Paged fetch — see explanation in /api/tax/overview/route.ts. Walks the
// table 1,000 rows at a time so we get every row, no PostgREST truncation.
async function fetchAllPaged<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFactory: () => any,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const to = from + SCAN_PAGE_SIZE - 1
    const { data, error } = await queryFactory().range(from, to)
    if (error) throw error
    const batch = (data || []) as T[]
    out.push(...batch)
    if (batch.length < SCAN_PAGE_SIZE) break
    from += SCAN_PAGE_SIZE
  }
  return out
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()

    // Parse pagination params
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const search = searchParams.get("search")?.trim().toLowerCase() || ""
    const typeFilter = searchParams.get("type") || "all"
    const stateFilter = searchParams.get("state") || "all"
    // Default view: only clients with at least one tax return on file.
    // Anything else is a ProConnect record we don't actually serve as a
    // tax client. Pass `withReturns=false` to include the full roster.
    const withReturnsFilter =
      (searchParams.get("withReturns") ?? "true").toLowerCase() !== "false"

    // ── Pure count queries (head: true = no data, just count) ────────
    // These run in parallel and each returns only a count, not rows.
    const [
      totalRes,
      personsRes,
      orgsRes,
      totalReturnsRes,
      linkedToKarbonRes,
      mappedRes,
      linkedToIgnitionRes,
    ] = await Promise.all([
      supabase
        .from("proconnect_clients")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("proconnect_clients")
        .select("*", { count: "exact", head: true })
        .eq("client_type", "PERSON"),
      supabase
        .from("proconnect_clients")
        .select("*", { count: "exact", head: true })
        .eq("client_type", "ORGANIZATION"),
      supabase
        .from("proconnect_engagements")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("master_client_mapping")
        .select("*", { count: "exact", head: true })
        .not("proconnect_client_id", "is", null)
        .not("karbon_client_id", "is", null),
      supabase
        .from("master_client_mapping")
        .select("*", { count: "exact", head: true })
        .not("proconnect_client_id", "is", null),
      supabase
        .from("master_client_mapping")
        .select("*", { count: "exact", head: true })
        .not("proconnect_client_id", "is", null)
        .not("ignition_client_id", "is", null),
    ])

    if (totalRes.error) throw totalRes.error
    if (personsRes.error) throw personsRes.error
    if (orgsRes.error) throw orgsRes.error
    if (totalReturnsRes.error) throw totalReturnsRes.error
    if (linkedToKarbonRes.error) throw linkedToKarbonRes.error
    if (mappedRes.error) throw mappedRes.error
    if (linkedToIgnitionRes.error) throw linkedToIgnitionRes.error

    const totalClients = totalRes.count ?? 0
    const mappedCount = mappedRes.count ?? 0
    const unmappedToHub = totalClients - mappedCount

    // ── Rollups that PostgREST can't express ─────────────────────────
    // Run in parallel. Each is a paged scan, not a single .select(),
    // so they survive past 1,000 rows.
    const [
      distinctClientsForReturns,
      stateRows,
      entityRows,
    ] = await Promise.all([
      // Distinct clients with at least one engagement.
      // Postgres has no PostgREST way to express COUNT(DISTINCT col),
      // so we scan the (small) projection and dedupe in JS.
      fetchAllPaged<{ proconnect_client_id: string | null }>(() =>
        supabase.from("proconnect_engagements").select("proconnect_client_id"),
      ),
      // by-state rollup — same reason, no PostgREST GROUP BY.
      fetchAllPaged<{ client_state: string | null }>(() =>
        supabase.from("proconnect_clients").select("client_state"),
      ),
      // Sub-entity check requires comparing two columns; PostgREST
      // can't do that without a SQL view, so scan and compare in JS.
      fetchAllPaged<{
        proconnect_entity_id: string | null
        top_level_entity_id: string | null
      }>(() =>
        supabase
          .from("proconnect_clients")
          .select("proconnect_entity_id, top_level_entity_id"),
      ),
    ])

    const withReturnsCount = new Set(
      distinctClientsForReturns
        .map((d) => d.proconnect_client_id)
        .filter((id): id is string => Boolean(id)),
    ).size

    // Cached for the table query when `withReturnsFilter` is on.
    const clientIdsWithReturns = Array.from(
      new Set(
        distinctClientsForReturns
          .map((d) => d.proconnect_client_id)
          .filter((id): id is string => Boolean(id)),
      ),
    )

    const byState: Record<string, number> = {}
    for (const row of stateRows) {
      const key = row.client_state || "UNKNOWN"
      byState[key] = (byState[key] || 0) + 1
    }

    const subEntitiesCount = entityRows.filter(
      (c) =>
        c.proconnect_entity_id &&
        c.top_level_entity_id &&
        c.proconnect_entity_id !== c.top_level_entity_id,
    ).length

    // ── Filtered + paginated table data ──────────────────────────────
    let query = supabase
      .from("proconnect_clients")
      .select(
        "id, proconnect_client_id, proconnect_entity_id, top_level_entity_id, client_type, client_state, display_name, business_name, name_for_matching, first_name, last_name, email, phone, city, state, zip, tax_id, created_at, updated_at",
        { count: "exact" },
      )
      .order("display_name", { ascending: true })

    if (typeFilter !== "all") {
      query = query.eq("client_type", typeFilter)
    }
    if (stateFilter !== "all") {
      query = query.eq("client_state", stateFilter)
    }
    if (withReturnsFilter) {
      // Constrain the roster to ProConnect clients we actually have at
      // least one engagement for. Without this filter the page also
      // surfaces ProConnect records that aren't really our tax clients.
      if (clientIdsWithReturns.length === 0) {
        // No engagements at all — short-circuit so we don't pass an
        // empty `in()` list (PostgREST treats `in.()` as a syntax err).
        query = query.eq("proconnect_client_id", "__none__")
      } else {
        query = query.in("proconnect_client_id", clientIdsWithReturns)
      }
    }
    if (search) {
      query = query.or(
        `display_name.ilike.%${search}%,email.ilike.%${search}%,proconnect_client_id.ilike.%${search}%,business_name.ilike.%${search}%,tax_id.ilike.%${search}%`,
      )
    }

    const from = (page - 1) * TABLE_PAGE_SIZE
    const to = from + TABLE_PAGE_SIZE - 1
    query = query.range(from, to)

    const clientsRes = await query
    if (clientsRes.error) throw clientsRes.error

    const clients = (clientsRes.data || []) as ProconnectClient[]
    const filteredTotal = clientsRes.count ?? 0
    const totalPages = Math.ceil(filteredTotal / TABLE_PAGE_SIZE)

    // ── Related data for the current page only (small set, capped) ───
    const clientIds = clients
      .map((c) => c.proconnect_client_id)
      .filter(Boolean) as string[]

    let mappings: MasterMappingRow[] = []
    let engagements: ProconnectEngagement[] = []
    const preparerMap = new Map<string, string>()

    if (clientIds.length > 0) {
      const [mappingRes, engagementsRes, profilesRes] = await Promise.all([
        supabase
          .from("master_client_mapping")
          .select(
            "internal_client_id, client_type, display_name, primary_email, karbon_client_id, ignition_client_id, proconnect_client_id, karbon_url, linked_systems, link_count",
          )
          .in("proconnect_client_id", clientIds),
        supabase
          .from("proconnect_engagements")
          .select(
            "id, engagement_id, proconnect_client_id, tax_year, return_type, form_type, status, efile_status, work_status, assignee_profile_id, raw_json, synced_at, updated_at",
          )
          .in("proconnect_client_id", clientIds),
        supabase
          .from("proconnect_profiles")
          .select("proconnect_profile_id, full_name, team_members(full_name)"),
      ])

      if (mappingRes.error) throw mappingRes.error
      if (engagementsRes.error) throw engagementsRes.error
      if (profilesRes.error) throw profilesRes.error

      mappings = (mappingRes.data || []) as MasterMappingRow[]
      engagements = (engagementsRes.data || []) as ProconnectEngagement[]

      for (const p of profilesRes.data || []) {
        const tm = p.team_members as { full_name?: string | null } | null
        const name = p.full_name || tm?.full_name || null
        if (name) preparerMap.set(p.proconnect_profile_id, name)
      }
    }

    const mappingByPc = new Map<string, MasterMappingRow>()
    for (const m of mappings) {
      if (m.proconnect_client_id) mappingByPc.set(m.proconnect_client_id, m)
    }

    type ClientReturnRollup = {
      total: number
      amendedCount: number
      latestActivity: string | null
      preparers: Set<string>
      forms: Array<{
        form: string
        count: number
        latestYear: number | null
        latestStatus: string | null
        latestEfile: string | null
        latestPreparer: string | null
        latestUpdatedAt: string | null
      }>
    }
    const rollupByPc = new Map<string, ClientReturnRollup>()

    for (const eng of engagements) {
      if (!eng.proconnect_client_id) continue

      const rollup =
        rollupByPc.get(eng.proconnect_client_id) ??
        (() => {
          const fresh: ClientReturnRollup = {
            total: 0,
            amendedCount: 0,
            latestActivity: null,
            preparers: new Set<string>(),
            forms: [],
          }
          rollupByPc.set(eng.proconnect_client_id!, fresh)
          return fresh
        })()

      rollup.total += 1

      const rawAssignee =
        (eng.raw_json as Record<string, unknown> | null)?.assignee
      const rawAssigneeProfileId =
        rawAssignee && typeof rawAssignee === "object"
          ? ((rawAssignee as Record<string, unknown>).profileId as
              | string
              | null
              | undefined)
          : null
      const preparerProfileId =
        eng.assignee_profile_id || rawAssigneeProfileId || null
      const preparerName = preparerProfileId
        ? preparerMap.get(preparerProfileId) || null
        : null
      if (preparerName) rollup.preparers.add(preparerName)

      if (eng.updated_at || eng.synced_at) {
        const timestamp = eng.updated_at || eng.synced_at
        if (
          !rollup.latestActivity ||
          Date.parse(timestamp!) > Date.parse(rollup.latestActivity)
        ) {
          rollup.latestActivity = timestamp!
        }
      }

      const rawJson = eng.raw_json as Record<string, unknown> | null
      const formFromJson = (rawJson?.type as string) || null
      const formType =
        formFromJson || eng.form_type || eng.return_type || "Unknown"
      const existingForm = rollup.forms.find((f) => f.form === formType)

      if (existingForm) {
        existingForm.count += 1
        if ((eng.tax_year ?? 0) > (existingForm.latestYear ?? 0)) {
          existingForm.latestYear = eng.tax_year
          existingForm.latestStatus = eng.status
          existingForm.latestEfile = eng.efile_status
          existingForm.latestUpdatedAt = eng.updated_at
          existingForm.latestPreparer = preparerName
        }
      } else {
        rollup.forms.push({
          form: formType,
          count: 1,
          latestYear: eng.tax_year,
          latestStatus: eng.status,
          latestEfile: eng.efile_status,
          latestPreparer: preparerName,
          latestUpdatedAt: eng.updated_at,
        })
      }
    }

    const enriched = clients.map((c) => {
      const m = c.proconnect_client_id
        ? mappingByPc.get(c.proconnect_client_id)
        : undefined
      const rollup = c.proconnect_client_id
        ? rollupByPc.get(c.proconnect_client_id)
        : undefined
      return {
        ...c,
        return_count: rollup?.total ?? 0,
        amended_count: rollup?.amendedCount ?? 0,
        last_activity_at: rollup?.latestActivity ?? null,
        preparers: rollup ? Array.from(rollup.preparers) : [],
        return_forms: rollup?.forms ?? [],
        mapping: m
          ? {
              internal_client_id: m.internal_client_id,
              karbon_client_id: m.karbon_client_id,
              ignition_client_id: m.ignition_client_id,
              karbon_url: m.karbon_url ?? null,
              linked_systems: m.linked_systems ?? [],
              link_count: m.link_count ?? 0,
            }
          : null,
      }
    })

    const stats = {
      totalClients,
      persons: personsRes.count ?? 0,
      organizations: orgsRes.count ?? 0,
      withReturns: withReturnsCount,
      withoutReturns: totalClients - withReturnsCount,
      totalReturns: totalReturnsRes.count ?? 0,
      totalAmended: 0, // amended detection requires status parsing; not currently exposed
      linkedToKarbon: linkedToKarbonRes.count ?? 0,
      linkedToIgnition: linkedToIgnitionRes.count ?? 0,
      unmappedToHub,
      byState,
      subEntities: subEntitiesCount,
    }

    return NextResponse.json({
      clients: enriched,
      stats,
      filters: {
        withReturns: withReturnsFilter,
      },
      pagination: {
        page,
        pageSize: TABLE_PAGE_SIZE,
        totalPages,
        totalRows: filteredTotal,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    })
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
