import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── ProConnect client roster with pagination ─────────────────────────
// Stat cards use count queries (no data transfer, works past 1000 rows).
// The table uses .range() pagination — 50 rows per page by default.

const PAGE_SIZE = 50

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

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()

    // Parse pagination params
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const search = searchParams.get("search")?.trim().toLowerCase() || ""
    const typeFilter = searchParams.get("type") || "all"
    const stateFilter = searchParams.get("state") || "all"

    // ── Stat card counts (head: true = no data, just count) ──────────
    // These run in parallel and each returns only a count, not rows.
    const [
      totalRes,
      personsRes,
      orgsRes,
      withReturnsRes,
      linkedToKarbonRes,
      unmappedRes,
    ] = await Promise.all([
      // Total clients
      supabase
        .from("proconnect_clients")
        .select("*", { count: "exact", head: true }),

      // Persons
      supabase
        .from("proconnect_clients")
        .select("*", { count: "exact", head: true })
        .eq("client_type", "PERSON"),

      // Organizations
      supabase
        .from("proconnect_clients")
        .select("*", { count: "exact", head: true })
        .eq("client_type", "ORGANIZATION"),

      // With returns on file (has at least one engagement)
      supabase
        .from("proconnect_engagements")
        .select("proconnect_client_id", { count: "exact", head: true }),

      // Linked to Karbon (exists in master_client_mapping with karbon_client_id)
      supabase
        .from("master_client_mapping")
        .select("*", { count: "exact", head: true })
        .not("proconnect_client_id", "is", null)
        .not("karbon_client_id", "is", null),

      // Unmapped to Hub (proconnect_client_id NOT IN master_client_mapping)
      // We count total - mapped to get unmapped
      supabase
        .from("master_client_mapping")
        .select("*", { count: "exact", head: true })
        .not("proconnect_client_id", "is", null),
    ])

    // Check for errors
    if (totalRes.error) throw totalRes.error
    if (personsRes.error) throw personsRes.error
    if (orgsRes.error) throw orgsRes.error
    if (withReturnsRes.error) throw withReturnsRes.error
    if (linkedToKarbonRes.error) throw linkedToKarbonRes.error
    if (unmappedRes.error) throw unmappedRes.error

    // Count unique clients with returns (the query above counts engagements)
    const { count: uniqueClientsWithReturns } = await supabase
      .from("proconnect_engagements")
      .select("proconnect_client_id", { count: "exact", head: true })
      // Unfortunately Supabase doesn't support COUNT(DISTINCT) in .select()
      // so we'll compute this from the data query below

    const totalClients = totalRes.count ?? 0
    const mappedCount = unmappedRes.count ?? 0
    const unmappedToHub = totalClients - mappedCount

    // ── Build filtered query for table data ──────────────────────────
    let query = supabase
      .from("proconnect_clients")
      .select(
        "id, proconnect_client_id, proconnect_entity_id, top_level_entity_id, client_type, client_state, display_name, business_name, name_for_matching, first_name, last_name, email, phone, city, state, zip, tax_id, created_at, updated_at",
        { count: "exact" }
      )
      .order("display_name", { ascending: true })

    // Apply filters
    if (typeFilter !== "all") {
      query = query.eq("client_type", typeFilter)
    }
    if (stateFilter !== "all") {
      query = query.eq("client_state", stateFilter)
    }
    if (search) {
      // Use ilike for case-insensitive search across multiple columns
      query = query.or(
        `display_name.ilike.%${search}%,email.ilike.%${search}%,proconnect_client_id.ilike.%${search}%,business_name.ilike.%${search}%,tax_id.ilike.%${search}%`
      )
    }

    // Get total count for filtered results (for pagination)
    const countQuery = query

    // Apply pagination
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    query = query.range(from, to)

    const clientsRes = await query

    if (clientsRes.error) throw clientsRes.error

    const clients = (clientsRes.data || []) as ProconnectClient[]
    const filteredTotal = clientsRes.count ?? 0
    const totalPages = Math.ceil(filteredTotal / PAGE_SIZE)

    // ── Get related data for the current page of clients ─────────────
    const clientIds = clients
      .map((c) => c.proconnect_client_id)
      .filter(Boolean) as string[]

    // Only fetch related data if we have clients
    let mappings: MasterMappingRow[] = []
    let engagements: ProconnectEngagement[] = []
    let preparerMap = new Map<string, string>()

    if (clientIds.length > 0) {
      const [mappingRes, engagementsRes, profilesRes] = await Promise.all([
        supabase
          .from("master_client_mapping")
          .select(
            "internal_client_id, client_type, display_name, primary_email, karbon_client_id, ignition_client_id, proconnect_client_id, karbon_url, linked_systems, link_count"
          )
          .in("proconnect_client_id", clientIds),
        supabase
          .from("proconnect_engagements")
          .select(
            "id, engagement_id, proconnect_client_id, tax_year, return_type, form_type, status, efile_status, work_status, assignee_profile_id, raw_json, synced_at, updated_at"
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

      // Build preparer map
      for (const p of profilesRes.data || []) {
        const tm = p.team_members as { full_name?: string | null } | null
        const name = p.full_name || tm?.full_name || null
        if (name) preparerMap.set(p.proconnect_profile_id, name)
      }
    }

    // Build lookup maps
    const mappingByPc = new Map<string, MasterMappingRow>()
    for (const m of mappings) {
      if (m.proconnect_client_id) mappingByPc.set(m.proconnect_client_id, m)
    }

    // Build per-client engagements rollup
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
          rollupByPc.set(eng.proconnect_client_id, fresh)
          return fresh
        })()

      rollup.total += 1

      const preparerProfileId =
        eng.assignee_profile_id ||
        ((eng.raw_json as Record<string, unknown> | null)?.assignee as Record<string, unknown> | null)?.profileId as
          | string
          | null
          | undefined ||
        null
      const preparerName = preparerProfileId ? preparerMap.get(preparerProfileId) || null : null
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
      const formType = formFromJson || eng.form_type || eng.return_type || "Unknown"
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

    // Enrich clients
    const enriched = clients.map((c) => {
      const m = c.proconnect_client_id
        ? mappingByPc.get(c.proconnect_client_id)
        : undefined
      const rollup =
        c.proconnect_client_id ? rollupByPc.get(c.proconnect_client_id) : undefined
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

    // Get count of clients with returns for stats (count distinct)
    const { count: engagementCount } = await supabase
      .from("proconnect_engagements")
      .select("proconnect_client_id", { count: "exact", head: true })

    // For withReturns, we need distinct client count. Use a raw count approach:
    const { data: distinctClientsData } = await supabase
      .from("proconnect_engagements")
      .select("proconnect_client_id")
    const withReturnsCount = new Set(
      (distinctClientsData || []).map((d: { proconnect_client_id: string }) => d.proconnect_client_id)
    ).size

    // Get total returns count
    const { count: totalReturns } = await supabase
      .from("proconnect_engagements")
      .select("*", { count: "exact", head: true })

    // Get linked to Ignition count
    const { count: linkedToIgnition } = await supabase
      .from("master_client_mapping")
      .select("*", { count: "exact", head: true })
      .not("proconnect_client_id", "is", null)
      .not("ignition_client_id", "is", null)

    // Get sub-entities count
    const { count: subEntities } = await supabase
      .from("proconnect_clients")
      .select("*", { count: "exact", head: true })
      .not("proconnect_entity_id", "is", null)
      .not("top_level_entity_id", "is", null)
      .neq("proconnect_entity_id", "top_level_entity_id" as never)

    // Note: The subEntities query above won't work correctly because we can't
    // compare two columns directly. We'll compute it differently.
    const { data: allClientsForSubEntity } = await supabase
      .from("proconnect_clients")
      .select("proconnect_entity_id, top_level_entity_id")
    const subEntitiesCount = (allClientsForSubEntity || []).filter(
      (c: { proconnect_entity_id: string | null; top_level_entity_id: string | null }) =>
        c.proconnect_entity_id &&
        c.top_level_entity_id &&
        c.proconnect_entity_id !== c.top_level_entity_id
    ).length

    const stats = {
      totalClients: totalRes.count ?? 0,
      persons: personsRes.count ?? 0,
      organizations: orgsRes.count ?? 0,
      withReturns: withReturnsCount,
      withoutReturns: (totalRes.count ?? 0) - withReturnsCount,
      totalReturns: totalReturns ?? 0,
      totalAmended: 0, // Would need separate query
      linkedToKarbon: linkedToKarbonRes.count ?? 0,
      linkedToIgnition: linkedToIgnition ?? 0,
      unmappedToHub,
      byState: {} as Record<string, number>, // Computed below
      subEntities: subEntitiesCount,
    }

    // Get byState counts
    const { data: stateData } = await supabase
      .from("proconnect_clients")
      .select("client_state")
    const byState: Record<string, number> = {}
    for (const row of stateData || []) {
      const key = (row as { client_state: string | null }).client_state || "UNKNOWN"
      byState[key] = (byState[key] || 0) + 1
    }
    stats.byState = byState

    return NextResponse.json({
      clients: enriched,
      stats,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
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
