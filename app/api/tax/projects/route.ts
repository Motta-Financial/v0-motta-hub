import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

const PAGE_SIZE = 50

/**
 * GET /api/tax/projects — list tax_return projects (one per client).
 *
 * Query params:
 *   page      = 1-based page number
 *   search    = fuzzy search on client name
 *   status    = filter by link health: linked | needs_review | no_match
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
    const search = url.searchParams.get("search")?.trim().toLowerCase() || ""
    const statusFilter = url.searchParams.get("status") || ""

    const supabase = createAdminClient()
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    // Fetch projects with aggregated return counts
    let query = supabase
      .from("projects")
      .select(
        `
        id, name, kind, status, contact_id, organization_id,
        owner_team_member_id, created_at, updated_at,
        contacts!projects_contact_id_fkey (id, display_name, full_name, primary_email),
        organizations!projects_organization_id_fkey (id, name),
        team_members!projects_owner_team_member_id_fkey (id, full_name)
      `,
        { count: "exact" },
      )
      .eq("kind", "tax_return")
      .order("name", { ascending: true })

    if (search) {
      query = query.or(`name.ilike.%${search}%`)
    }

    query = query.range(from, to)

    const { data: projects, count, error } = await query
    if (error) throw new Error(error.message)

    // Batch-fetch return link stats for all project IDs
    const projectIds = (projects ?? []).map((p) => p.id)
    const { data: linkStats } = await supabase
      .from("tax_return_links")
      .select("project_id, status")
      .in("project_id", projectIds)

    // Aggregate per-project
    const statsMap = new Map<
      string,
      { total: number; linked: number; needsReview: number; noMatch: number }
    >()
    for (const row of linkStats ?? []) {
      const pid = row.project_id as string
      if (!statsMap.has(pid)) statsMap.set(pid, { total: 0, linked: 0, needsReview: 0, noMatch: 0 })
      const s = statsMap.get(pid)!
      s.total++
      if (row.status === "linked") s.linked++
      else if (row.status === "needs_review") s.needsReview++
      else s.noMatch++
    }

    // Build response rows
    let rows = (projects ?? []).map((p) => {
      const stats = statsMap.get(p.id) ?? { total: 0, linked: 0, needsReview: 0, noMatch: 0 }
      const contact = Array.isArray(p.contacts) ? p.contacts[0] : p.contacts
      const org = Array.isArray(p.organizations) ? p.organizations[0] : p.organizations
      const owner = Array.isArray(p.team_members) ? p.team_members[0] : p.team_members
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        contactId: p.contact_id,
        contactName: contact?.display_name ?? contact?.full_name ?? null,
        contactEmail: contact?.primary_email ?? null,
        organizationId: p.organization_id,
        organizationName: org?.name ?? null,
        ownerName: owner?.full_name ?? null,
        returnCount: stats.total,
        linkedCount: stats.linked,
        needsReviewCount: stats.needsReview,
        noMatchCount: stats.noMatch,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }
    })

    // Client-side status filter (apply after aggregates)
    if (statusFilter === "linked") {
      rows = rows.filter((r) => r.linkedCount > 0 && r.needsReviewCount === 0 && r.noMatchCount === 0)
    } else if (statusFilter === "needs_review") {
      rows = rows.filter((r) => r.needsReviewCount > 0)
    } else if (statusFilter === "no_match") {
      rows = rows.filter((r) => r.noMatchCount > 0)
    }

    const totalCount = count ?? 0
    const totalPages = Math.ceil(totalCount / PAGE_SIZE)

    // Global stats for the filter chips
    const { data: globalStats } = await supabase
      .from("tax_return_links")
      .select("status")
      .not("project_id", "is", null)

    const global = { total: 0, linked: 0, needsReview: 0, noMatch: 0 }
    for (const r of globalStats ?? []) {
      global.total++
      if (r.status === "linked") global.linked++
      else if (r.status === "needs_review") global.needsReview++
      else global.noMatch++
    }

    return NextResponse.json({
      projects: rows,
      stats: global,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    })
  } catch (e) {
    console.error("[tax/projects] GET error:", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
