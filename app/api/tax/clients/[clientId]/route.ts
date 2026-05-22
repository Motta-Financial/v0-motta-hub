import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/tax/clients/[clientId]
 *
 * Returns a detailed Tax Profile for a single ProConnect client, including:
 * - Client info (name, contact, TIN, entity relationships)
 * - All tax returns on file with full engagement details
 * - Return summaries by year and form type
 * - Associated preparers
 * - Hub linkage (Karbon, Ignition)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params

  try {
    const supabase = createAdminClient()

    // Fetch client, their engagements, and profile mappings in parallel
    const [clientRes, engagementsRes, mappingRes, profilesRes] = await Promise.all([
      supabase
        .from("proconnect_clients")
        .select("*")
        .eq("proconnect_client_id", clientId)
        .single(),
      supabase
        .from("proconnect_engagements_enriched")
        .select("*")
        .eq("proconnect_client_id", clientId)
        .order("tax_year", { ascending: false }),
      supabase
        .from("master_client_mapping")
        .select("*")
        .eq("proconnect_client_id", clientId)
        .maybeSingle(),
      supabase
        .from("proconnect_profiles")
        .select("profile_id, display_name, email, team_members(full_name, email)"),
    ])

    if (clientRes.error) {
      if (clientRes.error.code === "PGRST116") {
        return NextResponse.json({ error: "Client not found" }, { status: 404 })
      }
      throw clientRes.error
    }
    if (engagementsRes.error) throw engagementsRes.error

    const client = clientRes.data
    const engagements = engagementsRes.data || []
    const mapping = mappingRes.data

    // Build preparer lookup
    const preparerMap = new Map<string, { name: string; email: string | null }>()
    for (const p of profilesRes.data || []) {
      const tm = p.team_members as { full_name?: string; email?: string } | null
      const name = p.display_name || tm?.full_name || null
      if (name) {
        preparerMap.set(p.profile_id, { name, email: p.email || tm?.email || null })
      }
    }

    // Group engagements by tax year
    const byYear: Record<number, typeof engagements> = {}
    for (const eng of engagements) {
      const year = eng.tax_year || 0
      if (!byYear[year]) byYear[year] = []
      byYear[year].push(eng)
    }

    // Compute summary stats
    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a)
    const formCounts: Record<string, number> = {}
    const statusCounts: Record<string, number> = {}
    const efileCounts: Record<string, number> = {}
    const preparers = new Set<string>()

    for (const eng of engagements) {
      const form = eng.return_type || "Unknown"
      formCounts[form] = (formCounts[form] || 0) + 1

      const status = eng.custom_status_name || eng.engagement_state || "Unknown"
      statusCounts[status] = (statusCounts[status] || 0) + 1

      const efile = eng.efile_status || "(not filed)"
      efileCounts[efile] = (efileCounts[efile] || 0) + 1

      if (eng.preparer_name) preparers.add(eng.preparer_name)
    }

    // Enrich engagements with additional computed fields
    const enrichedEngagements = engagements.map((eng) => {
      const rawJson = eng.raw_json as Record<string, unknown> | null
      return {
        ...eng,
        // Determine if this is a 1040 (viewable in 1040 viewer)
        is1040: eng.return_type === "1040" || eng.return_type === "IND",
        // Extract key financial data from raw_json if available
        totalIncome: rawJson?.totalIncome as number | null,
        agi: rawJson?.agi as number | null,
        taxableIncome: rawJson?.taxableIncome as number | null,
        totalTax: rawJson?.totalTax as number | null,
        refundAmount: rawJson?.refundAmount as number | null,
        amountOwed: rawJson?.amountOwed as number | null,
      }
    })

    return NextResponse.json({
      client: {
        id: client.id,
        proconnectClientId: client.proconnect_client_id,
        proconnectEntityId: client.proconnect_entity_id,
        topLevelEntityId: client.top_level_entity_id,
        clientType: client.client_type,
        clientState: client.client_state,
        displayName: client.display_name,
        businessName: client.business_name,
        firstName: client.first_name,
        lastName: client.last_name,
        email: client.email,
        phone: client.phone,
        address: {
          city: client.city,
          state: client.state,
          zip: client.zip,
        },
        taxId: client.tax_id,
        createdAt: client.created_at,
        updatedAt: client.updated_at,
      },
      engagements: enrichedEngagements,
      summary: {
        totalReturns: engagements.length,
        years,
        byYear: Object.fromEntries(
          years.map((y) => [y, byYear[y].length])
        ),
        formCounts,
        statusCounts,
        efileCounts,
        preparers: Array.from(preparers),
      },
      hubLinkage: mapping
        ? {
            internalClientId: mapping.internal_client_id,
            karbonClientId: mapping.karbon_client_id,
            ignitionClientId: mapping.ignition_client_id,
            karbonUrl: mapping.karbon_url,
            linkedSystems: mapping.linked_systems || [],
          }
        : null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
