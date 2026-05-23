import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── ProConnect client roster ─────────────────────────────────────────
// Returns one row per row in proconnect_clients, enriched with the
// count of engagements (returns) we have synced for that client from
// the proconnect_engagements table.
//
// This route is intentionally ProConnect-only: cross-system identity
// (Karbon, Ignition, Hub contact id) is NOT joined here. The /tax
// dashboard surfaces what Intuit's API gives us and nothing else.

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

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Run the client query, the engagements query, and the profile
    // mapping query in parallel. Cross-system mapping queries
    // (master_client_mapping) were intentionally removed — this route
    // surfaces ProConnect-native data only.
    const [clientsRes, engagementsRes, profilesRes] = await Promise.all([
      supabase
        .from("proconnect_clients")
        .select(
          "id, proconnect_client_id, proconnect_entity_id, top_level_entity_id, client_type, client_state, display_name, business_name, name_for_matching, first_name, last_name, email, phone, city, state, zip, tax_id, created_at, updated_at",
        )
        .order("display_name", { ascending: true }),
      supabase
        .from("proconnect_engagements")
        .select(
          "id, engagement_id, proconnect_client_id, tax_year, return_type, form_type, status, efile_status, work_status, assignee_profile_id, raw_json, synced_at, updated_at",
        ),
      // Profile mapping: see scripts/120_proconnect_profiles_mapping.sql.
      // Falls back to team_members(full_name) when display_name is null.
      supabase
        .from("proconnect_profiles")
        .select("profile_id, display_name, team_members(full_name)"),
    ])

    if (clientsRes.error) throw clientsRes.error
    if (engagementsRes.error) throw engagementsRes.error
    if (profilesRes.error) throw profilesRes.error

    const clients = (clientsRes.data || []) as ProconnectClient[]
    const engagements = (engagementsRes.data || []) as ProconnectEngagement[]

    // profileId → human display name. Keep null when unmapped — never
    // leak the raw GUID to the dashboard. Once an admin fills in the
    // proconnect_profiles row (or links team_member_id), the next page
    // refresh starts showing the name with no code change.
    const preparerMap = new Map<string, string>()
    for (const p of profilesRes.data || []) {
      const tm = p.team_members as { full_name?: string | null } | null
      const name = p.display_name || tm?.full_name || null
      if (name) preparerMap.set(p.profile_id, name)
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

      // Resolve preparer profile_id → human name via the proconnect_profiles
      // map (falls back to linked team_members.full_name). If the profileId
      // hasn't been mapped yet, we just skip — never display a raw GUID.
      const preparerProfileId =
        eng.assignee_profile_id ||
        ((eng.raw_json as Record<string, unknown> | null)?.assignee as Record<string, unknown> | null)?.profileId as
          | string
          | null
          | undefined ||
        null
      const preparerName = preparerProfileId ? preparerMap.get(preparerProfileId) || null : null
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

    const enriched = clients.map((c) => {
      const rollup =
        c.proconnect_client_id ? rollupByPc.get(c.proconnect_client_id) : undefined
      return {
        ...c,
        return_count: rollup?.total ?? 0,
        amended_count: rollup?.amendedCount ?? 0,
        last_activity_at: rollup?.latestActivity ?? null,
        preparers: rollup ? Array.from(rollup.preparers) : [],
        return_forms: rollup?.forms ?? [],
      }
    })

    // Aggregate stats — ProConnect-only metrics. We dropped the
    // linkedToKarbon / linkedToIgnition / unmappedToHub counters
    // because those rely on master_client_mapping (a Hub artifact),
    // which is not part of the ProConnect API surface.
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
      byState,
      subEntities,
    }

    return NextResponse.json({ clients: enriched, stats })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
