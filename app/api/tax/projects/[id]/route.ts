import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { linkReturnsForHubClient } from "@/lib/tax/link-returns"

/**
 * GET /api/tax/projects/[id] — tax project detail with all returns.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    // Fetch project with client info
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select(
        `
        id, name, kind, status, description, contact_id, organization_id,
        owner_team_member_id, created_at, updated_at,
        contacts!projects_contact_id_fkey (id, display_name, full_name, primary_email),
        organizations!projects_organization_id_fkey (id, name),
        team_members!projects_owner_team_member_id_fkey (id, full_name)
      `,
      )
      .eq("id", id)
      .eq("kind", "tax_return")
      .maybeSingle()

    if (projErr) throw new Error(projErr.message)
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Fetch all return links for this project (enriched view)
    const { data: links, error: linkErr } = await supabase
      .from("tax_return_links_enriched")
      .select("*")
      .eq("project_id", id)
      .order("tax_year", { ascending: false })
      .order("return_type", { ascending: true })

    if (linkErr) throw new Error(linkErr.message)

    const contact = Array.isArray(project.contacts) ? project.contacts[0] : project.contacts
    const org = Array.isArray(project.organizations)
      ? project.organizations[0]
      : project.organizations
    const owner = Array.isArray(project.team_members)
      ? project.team_members[0]
      : project.team_members

    // Aggregate stats
    const stats = { total: 0, linked: 0, needsReview: 0, noMatch: 0 }
    for (const l of links ?? []) {
      stats.total++
      if (l.status === "linked") stats.linked++
      else if (l.status === "needs_review") stats.needsReview++
      else stats.noMatch++
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        description: project.description,
        contactId: project.contact_id,
        contactName: contact?.display_name ?? contact?.full_name ?? null,
        contactEmail: contact?.primary_email ?? null,
        organizationId: project.organization_id,
        organizationName: org?.name ?? null,
        ownerName: owner?.full_name ?? null,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      },
      returns: (links ?? []).map((l) => ({
        id: l.id,
        engagementId: l.engagement_id,
        taxYear: l.tax_year,
        returnType: l.return_type,
        status: l.status,
        // ProConnect data
        engagementName: l.engagement_name,
        proconnectStatus: l.proconnect_status,
        proconnectWorkStatus: l.proconnect_work_status,
        efileStatus: l.efile_status,
        // Work item link
        workItemId: l.work_item_id,
        workItemTitle: l.work_item_title,
        workItemTemplateName: l.work_template_name,
        workItemStatus: l.work_item_status,
        workItemKarbonUrl: l.work_item_karbon_url,
        workItemLinkSource: l.work_item_link_source,
        workItemConfidence: l.work_item_confidence,
        // Proposal link
        proposalServiceId: l.proposal_service_id,
        proposalServiceName: l.proposal_service_name,
        proposalAmount: l.proposal_amount,
        proposalCurrency: l.proposal_currency,
        proposalStatus: l.proposal_status,
        proposalTitle: l.proposal_title,
        proposalLinkSource: l.proposal_link_source,
      })),
      stats,
    })
  } catch (e) {
    console.error("[tax/projects/[id]] GET error:", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

/**
 * POST /api/tax/projects/[id]/relink — re-run the matcher for all returns.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    // Fetch project to get the client identity
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, contact_id, organization_id")
      .eq("id", id)
      .eq("kind", "tax_return")
      .maybeSingle()

    if (projErr) throw new Error(projErr.message)
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const result = await linkReturnsForHubClient({
      organizationId: project.organization_id,
      contactId: project.contact_id,
    })

    return NextResponse.json({ ok: true, result })
  } catch (e) {
    console.error("[tax/projects/[id]] POST relink error:", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
