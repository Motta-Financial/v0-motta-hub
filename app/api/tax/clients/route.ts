import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── ProConnect client roster ─────────────────────────────────────────
// Returns one row per row in proconnect_clients, enriched with:
//   1. the count of engagements (returns) we have synced for that client
//      from the proconnect_engagements table,
//   2. the matching row from master_client_mapping (the unified view
//      we built earlier today), so the UI can deep-link out to the
//      Karbon / Ignition / Motta Hub identity for the same client.
//
// We keep the join logic on the server so the page component stays
// declarative and doesn't have to coordinate multiple queries.

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
  raw_json: Record<string, unknown> | null
  synced_at: string | null
  updated_at: string | null
}

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Run the client query, the mapping query, and the engagements query in parallel
    const [clientsRes, mappingRes, engagementsRes] = await Promise.all([
      supabase
        .from("proconnect_clients")
        .select(
          "id, proconnect_client_id, proconnect_entity_id, top_level_entity_id, client_type, client_state, display_name, business_name, name_for_matching, first_name, last_name, email, phone, city, state, zip, tax_id, created_at, updated_at",
        )
        .order("display_name", { ascending: true }),
      supabase
        .from("master_client_mapping")
        .select(
          "internal_client_id, client_type, display_name, primary_email, karbon_client_id, ignition_client_id, proconnect_client_id, karbon_url, linked_systems, link_count",
        )
        .not("proconnect_client_id", "is", null),
      supabase
        .from("proconnect_engagements")
        .select(
          "id, engagement_id, proconnect_client_id, tax_year, return_type, form_type, status, efile_status, work_status, raw_json, synced_at, updated_at",
        ),
    ])

    if (clientsRes.error) throw clientsRes.error
    if (mappingRes.error) throw mappingRes.error
    if (engagementsRes.error) throw engagementsRes.error

    const clients = (clientsRes.data || []) as ProconnectClient[]
    const mappings = (mappingRes.data || []) as MasterMappingRow[]
    const engagements = (engagementsRes.data || []) as ProconnectEngagement[]

    // Build a lookup of mapping rows keyed on proconnect_client_id.
    const mappingByPc = new Map<string, MasterMappingRow>()
    for (const m of mappings) {
      if (m.proconnect_client_id) mappingByPc.set(m.proconnect_client_id, m)
    }

    // Build a per-client engagements rollup from the new proconnect_engagements table
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

    // Group engagements by client and form type
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

      // Extract preparer from raw_json if available
      const rawJson = eng.raw_json as Record<string, unknown> | null
      const assignee = rawJson?.assignee as Record<string, unknown> | null
      const modifiedBy = rawJson?.modifiedBy as Record<string, unknown> | null
      const preparerName =
        (rawJson?.name as string) ||
        (assignee?.profileId as string) ||
        (modifiedBy?.profileId as string) ||
        null
      if (preparerName) rollup.preparers.add(preparerName)

      // Track latest activity
      if (eng.updated_at || eng.synced_at) {
        const timestamp = eng.updated_at || eng.synced_at
        if (
          !rollup.latestActivity ||
          Date.parse(timestamp!) > Date.parse(rollup.latestActivity)
        ) {
          rollup.latestActivity = timestamp!
        }
      }

      // Group by form type (1040, 1065, 1120, 1120S, 990)
      // Extract from raw_json.type since form_type column may not be populated
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

    // Aggregate stats
    const byState: Record<string, number> = {}
    for (const c of enriched) {
      const key = c.client_state || "UNKNOWN"
      byState[key] = (byState[key] || 0) + 1
    }

    const subEntities = enriched.filter(
      (c) =>
        !!c.proconnect_entity_id &&
        !!c.top_level_entity_id &&
        c.proconnect_entity_id !== c.top_level_entity_id,
    ).length

    const stats = {
      totalClients: enriched.length,
      persons: enriched.filter((c) => c.client_type === "PERSON").length,
      organizations: enriched.filter((c) => c.client_type === "ORGANIZATION")
        .length,
      withReturns: enriched.filter((c) => c.return_count > 0).length,
      withoutReturns: enriched.filter((c) => c.return_count === 0).length,
      totalReturns: enriched.reduce((s, c) => s + c.return_count, 0),
      totalAmended: enriched.reduce((s, c) => s + c.amended_count, 0),
      linkedToKarbon: enriched.filter((c) => !!c.mapping?.karbon_client_id)
        .length,
      linkedToIgnition: enriched.filter(
        (c) => !!c.mapping?.ignition_client_id,
      ).length,
      unmappedToHub: enriched.filter((c) => !c.mapping).length,
      byState,
      subEntities,
    }

    return NextResponse.json({ clients: enriched, stats })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
