import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── ProConnect client roster ─────────────────────────────────────────
// Returns one row per row in proconnect_clients, enriched with:
//   1. the count of returns we have filed for that client (across all
//      5 form tables — one round trip per form table, fanned out in
//      parallel because each table is small),
//   2. the matching row from master_client_mapping (the unified view
//      we built earlier today), so the UI can deep-link out to the
//      Karbon / Ignition / Motta Hub identity for the same client.
//
// We keep the join logic on the server so the page component stays
// declarative and doesn't have to coordinate 6 separate queries.

type ProconnectClient = {
  id: string
  proconnect_client_id: string | null
  client_type: string | null
  client_state: string | null
  display_name: string | null
  business_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  zip: string | null
  tax_id: string | null
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
  linked_systems: string[] | null
  link_count: number | null
}

const RETURN_TABLES = [
  { form: "1040", table: "proconnect_1040_returns" },
  { form: "1065", table: "proconnect_1065_returns" },
  { form: "1120", table: "proconnect_1120_returns" },
  { form: "1120S", table: "proconnect_1120s_returns" },
  { form: "990", table: "proconnect_990_returns" },
] as const

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Run the client query, the mapping query, and one query per
    // return form in parallel. Five round trips total, all small.
    const [clientsRes, mappingRes, ...returnCounts] = await Promise.all([
      supabase
        .from("proconnect_clients")
        .select(
          "id, proconnect_client_id, client_type, client_state, display_name, business_name, first_name, last_name, email, phone, city, state, zip, tax_id, updated_at",
        )
        .order("display_name", { ascending: true }),
      supabase
        .from("master_client_mapping")
        .select(
          "internal_client_id, client_type, display_name, primary_email, karbon_client_id, ignition_client_id, proconnect_client_id, linked_systems, link_count",
        )
        .not("proconnect_client_id", "is", null),
      ...RETURN_TABLES.map(({ table }) =>
        supabase
          .from(table)
          .select("proconnect_client_id, tax_year, return_status, efile_status"),
      ),
    ])

    if (clientsRes.error) throw clientsRes.error
    if (mappingRes.error) throw mappingRes.error

    const clients = (clientsRes.data || []) as ProconnectClient[]
    const mappings = (mappingRes.data || []) as MasterMappingRow[]

    // Build a lookup of mapping rows keyed on proconnect_client_id.
    // The master view dedupes already so each PC id appears at most
    // once.
    const mappingByPc = new Map<string, MasterMappingRow>()
    for (const m of mappings) {
      if (m.proconnect_client_id) mappingByPc.set(m.proconnect_client_id, m)
    }

    // Build a per-client returns rollup. We track count + most recent
    // tax_year per form, plus a flat `forms` array so the UI can
    // render a badge strip.
    type ClientReturnRollup = {
      total: number
      forms: Array<{
        form: string
        count: number
        latestYear: number | null
        latestStatus: string | null
        latestEfile: string | null
      }>
    }
    const rollupByPc = new Map<string, ClientReturnRollup>()
    RETURN_TABLES.forEach((entry, idx) => {
      const res = returnCounts[idx]
      if (res.error) throw res.error
      const rows = (res.data || []) as Array<{
        proconnect_client_id: string | null
        tax_year: number | null
        return_status: string | null
        efile_status: string | null
      }>
      // Group by pc id within this form, then merge into the global
      // rollup. We keep the row with the highest tax_year as the
      // "latest" so the UI surfaces the most recent filing year per
      // (client, form).
      const byPc = new Map<
        string,
        {
          count: number
          latestYear: number | null
          latestStatus: string | null
          latestEfile: string | null
        }
      >()
      for (const r of rows) {
        if (!r.proconnect_client_id) continue
        const existing = byPc.get(r.proconnect_client_id)
        if (existing) {
          existing.count += 1
          if ((r.tax_year ?? 0) > (existing.latestYear ?? 0)) {
            existing.latestYear = r.tax_year
            existing.latestStatus = r.return_status
            existing.latestEfile = r.efile_status
          }
        } else {
          byPc.set(r.proconnect_client_id, {
            count: 1,
            latestYear: r.tax_year ?? null,
            latestStatus: r.return_status ?? null,
            latestEfile: r.efile_status ?? null,
          })
        }
      }
      for (const [pcId, info] of byPc) {
        const rollup =
          rollupByPc.get(pcId) ??
          (() => {
            const fresh: ClientReturnRollup = { total: 0, forms: [] }
            rollupByPc.set(pcId, fresh)
            return fresh
          })()
        rollup.total += info.count
        rollup.forms.push({
          form: entry.form,
          count: info.count,
          latestYear: info.latestYear,
          latestStatus: info.latestStatus,
          latestEfile: info.latestEfile,
        })
      }
    })

    const enriched = clients.map((c) => {
      const m = c.proconnect_client_id
        ? mappingByPc.get(c.proconnect_client_id)
        : undefined
      const rollup =
        c.proconnect_client_id ? rollupByPc.get(c.proconnect_client_id) : undefined
      return {
        ...c,
        return_count: rollup?.total ?? 0,
        return_forms: rollup?.forms ?? [],
        mapping: m
          ? {
              internal_client_id: m.internal_client_id,
              karbon_client_id: m.karbon_client_id,
              ignition_client_id: m.ignition_client_id,
              linked_systems: m.linked_systems ?? [],
              link_count: m.link_count ?? 0,
            }
          : null,
      }
    })

    // Aggregate stats — used by the Clients page KPI strip.
    const stats = {
      totalClients: enriched.length,
      persons: enriched.filter((c) => c.client_type === "PERSON").length,
      organizations: enriched.filter((c) => c.client_type === "ORGANIZATION")
        .length,
      withReturns: enriched.filter((c) => c.return_count > 0).length,
      withoutReturns: enriched.filter((c) => c.return_count === 0).length,
      linkedToKarbon: enriched.filter((c) => !!c.mapping?.karbon_client_id)
        .length,
      linkedToIgnition: enriched.filter(
        (c) => !!c.mapping?.ignition_client_id,
      ).length,
      unmappedToHub: enriched.filter((c) => !c.mapping).length,
    }

    return NextResponse.json({ clients: enriched, stats })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
