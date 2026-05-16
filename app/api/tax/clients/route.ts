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
          "id, proconnect_client_id, proconnect_entity_id, top_level_entity_id, client_type, client_state, display_name, business_name, name_for_matching, first_name, last_name, email, phone, city, state, zip, tax_id, created_at, updated_at",
        )
        .order("display_name", { ascending: true }),
      supabase
        .from("master_client_mapping")
        .select(
          "internal_client_id, client_type, display_name, primary_email, karbon_client_id, ignition_client_id, proconnect_client_id, karbon_url, linked_systems, link_count",
        )
        .not("proconnect_client_id", "is", null),
      // Pull `updated_at` for each return alongside the rollup fields
      // so we can derive a per-client "last activity in ProConnect"
      // timestamp on the server. This is what powers the "Last
      // activity" column on the ProConnect Clients page.
      ...RETURN_TABLES.map(({ table }) =>
        supabase
          .from(table)
          .select(
            "proconnect_client_id, tax_year, return_status, efile_status, preparer, amended, updated_at",
          ),
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
    // render a badge strip. We additionally surface the latest
    // preparer, amended-count, and last-activity timestamp per
    // (client, form) so the ProConnect Clients page can show
    // workload distribution without a second round-trip.
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
    RETURN_TABLES.forEach((entry, idx) => {
      const res = returnCounts[idx]
      if (res.error) throw res.error
      const rows = (res.data || []) as Array<{
        proconnect_client_id: string | null
        tax_year: number | null
        return_status: string | null
        efile_status: string | null
        preparer: string | null
        amended: boolean | null
        updated_at: string | null
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
          latestPreparer: string | null
          latestUpdatedAt: string | null
          amendedCount: number
          preparers: Set<string>
        }
      >()
      for (const r of rows) {
        if (!r.proconnect_client_id) continue
        const existing = byPc.get(r.proconnect_client_id)
        if (existing) {
          existing.count += 1
          if (r.amended) existing.amendedCount += 1
          if (r.preparer) existing.preparers.add(r.preparer)
          if ((r.tax_year ?? 0) > (existing.latestYear ?? 0)) {
            existing.latestYear = r.tax_year
            existing.latestStatus = r.return_status
            existing.latestEfile = r.efile_status
            existing.latestPreparer = r.preparer
            existing.latestUpdatedAt = r.updated_at
          }
        } else {
          byPc.set(r.proconnect_client_id, {
            count: 1,
            latestYear: r.tax_year ?? null,
            latestStatus: r.return_status ?? null,
            latestEfile: r.efile_status ?? null,
            latestPreparer: r.preparer ?? null,
            latestUpdatedAt: r.updated_at ?? null,
            amendedCount: r.amended ? 1 : 0,
            preparers: new Set<string>(r.preparer ? [r.preparer] : []),
          })
        }
      }
      for (const [pcId, info] of byPc) {
        const rollup =
          rollupByPc.get(pcId) ??
          (() => {
            const fresh: ClientReturnRollup = {
              total: 0,
              amendedCount: 0,
              latestActivity: null,
              preparers: new Set<string>(),
              forms: [],
            }
            rollupByPc.set(pcId, fresh)
            return fresh
          })()
        rollup.total += info.count
        rollup.amendedCount += info.amendedCount
        // Carry max(updated_at) across forms as the client's last
        // activity in ProConnect — what powers the "Last activity"
        // column in the ProConnect Clients page.
        if (info.latestUpdatedAt) {
          if (
            !rollup.latestActivity ||
            Date.parse(info.latestUpdatedAt) >
              Date.parse(rollup.latestActivity)
          ) {
            rollup.latestActivity = info.latestUpdatedAt
          }
        }
        for (const p of info.preparers) rollup.preparers.add(p)
        rollup.forms.push({
          form: entry.form,
          count: info.count,
          latestYear: info.latestYear,
          latestStatus: info.latestStatus,
          latestEfile: info.latestEfile,
          latestPreparer: info.latestPreparer,
          latestUpdatedAt: info.latestUpdatedAt,
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

    // Aggregate stats — used by the Clients page KPI strip. Includes
    // a `byState` map keyed on `client_state` (ProConnect's workflow
    // lifecycle field — ACTIVE / ARCHIVED / etc.) so the page can
    // surface lifecycle distribution without re-scanning rows
    // client-side. Today every row is ACTIVE but we report the
    // breakdown defensively so an archived value would surface
    // immediately on next refresh.
    const byState: Record<string, number> = {}
    for (const c of enriched) {
      const key = c.client_state || "UNKNOWN"
      byState[key] = (byState[key] || 0) + 1
    }
    // How many ProConnect entities are sub-entities of a different
    // top-level entity — i.e. the row's own entity UUID differs from
    // its top_level_entity_id. This catches related-party groupings
    // (parent corp + subsidiaries, husband+wife joint filers, etc.)
    // that the table now hints at via the entity-ids hover.
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
