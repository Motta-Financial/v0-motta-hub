/**
 * GET  /api/deals   — list deals from the deals_enriched read model.
 * POST /api/deals   — manually create a deal for a contact/organization.
 *
 * A Deal is one sales opportunity per prospect/client (see migration
 * 337_deals_model.sql). The list view (and the /deals page) read the
 * enriched view so they get contact/org/owner names + meeting/debrief/
 * work-item aggregates in a single round trip.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { findOrCreateDeal, type DealSource } from "@/lib/deals/find-or-create-deal"

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const sp = request.nextUrl.searchParams

  const status = sp.get("status") // open | closed | all
  const stage = sp.get("stage")
  const search = sp.get("q")?.trim()
  const contactId = sp.get("contactId")
  const limit = Math.min(Number.parseInt(sp.get("limit") || "100"), 500)

  let query = supabase
    .from("deals_enriched")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (status && status !== "all") query = query.eq("status", status)
  if (stage) query = query.eq("stage", stage)
  if (contactId) query = query.eq("contact_id", contactId)
  if (search) query = query.ilike("contact_name", `%${search}%`)

  const { data, error } = await query
  if (error) {
    console.error("[v0] GET /api/deals error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deals: data ?? [] })
}

interface CreateDealBody {
  contact_id?: string | null
  organization_id?: string | null
  title?: string | null
  source?: DealSource
  owner_team_member_id?: string | null
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = (await request.json().catch(() => ({}))) as CreateDealBody

  if (!body.contact_id && !body.organization_id) {
    return NextResponse.json(
      { error: "contact_id or organization_id is required" },
      { status: 400 },
    )
  }

  // Derive a default title from the contact / org when none supplied.
  let title = body.title?.trim() || null
  if (!title && body.contact_id) {
    const { data: ct } = await supabase
      .from("contacts")
      .select("full_name, primary_email")
      .eq("id", body.contact_id)
      .maybeSingle()
    title = ct?.full_name || ct?.primary_email || null
  }
  if (!title && body.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", body.organization_id)
      .maybeSingle()
    title = org?.name || null
  }

  const result = await findOrCreateDeal(
    {
      contactId: body.contact_id ?? null,
      organizationId: body.organization_id ?? null,
      title,
      source: body.source ?? "manual",
      ownerTeamMemberId: body.owner_team_member_id ?? null,
    },
    { supabase },
  )

  if (!result.deal_id) {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }

  return NextResponse.json({ deal_id: result.deal_id, created: result.created })
}
