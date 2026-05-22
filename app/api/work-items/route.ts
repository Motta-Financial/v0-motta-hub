import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const assignee = searchParams.get("assignee")
    const clientId = searchParams.get("clientId")
    const workType = searchParams.get("workType")
    const search = searchParams.get("search")
    const active = searchParams.get("active")
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "100"), 5000)
    const offset = Number.parseInt(searchParams.get("offset") || "0")

    // For large requests (dashboards), use a leaner select from the base table
    // to avoid Supabase's 1000-row default and reduce payload size.
    // For normal requests, use work_items_enriched view which pre-joins
    // contacts, organizations, client_groups, and team_members.
    const isLargeRequest = limit > 1000

    // `includeDeleted=true` lets ops audit the 115+ rows Karbon has dropped.
    // Default behavior excludes them so every dashboard, search, and widget
    // gets a clean "live in Karbon" view automatically.
    const includeDeleted = searchParams.get("includeDeleted") === "true"

    let query = supabase
      .from(isLargeRequest ? "work_items" : "work_items_enriched")
      .select(
        isLargeRequest
          ? `id, karbon_work_item_key, title, client_name, karbon_client_key,
             client_group_name, status, primary_status, secondary_status,
             workflow_status, work_type, due_date, start_date, completed_date,
             assignee_name, priority, karbon_modified_at, karbon_url, description,
             deleted_in_karbon_at`
          : "*",
        { count: "exact" },
      )
      .order("due_date", { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (!includeDeleted) {
      query = query.is("deleted_in_karbon_at", null)
    }

    if (status) {
      query = query.eq("workflow_status", status)
    }
    if (assignee) {
      query = query.eq("assignee_key", assignee)
    }
    if (clientId) {
      query = query.or(`contact_id.eq.${clientId},organization_id.eq.${clientId}`)
    }
    if (workType) {
      query = query.eq("work_type", workType)
    }
    if (search) {
      // The work_items_enriched view has a GIN-indexed `search_vector`
      // that covers title, client_name, client_group_name, assignee_name,
      // work_type, karbon_work_item_key, user_defined_identifier — that
      // path is orders of magnitude faster than chained ILIKE OR.
      //
      // BUT websearch_to_tsquery only matches WHOLE tokens, so a
      // user typing a partial word (e.g. "Lund" while the title
      // contains "Lundholm") would get zero hits and assume the work
      // item didn't exist. That's exactly how the debrief work-item
      // picker silently swallowed real matches.
      //
      // Fix: build a prefix-friendly tsquery by lexing the input on
      // whitespace and appending `:*` to each token, then AND'ing
      // them. We still escape characters that would break to_tsquery
      // syntax. For very short or punctuation-only inputs we fall
      // back to ILIKE on title / client_name / Karbon key so a
      // 1–2 char hint still surfaces hits.
      const trimmed = search.trim()
      if (trimmed.length >= 2 && /[a-zA-Z0-9]/.test(trimmed)) {
        const tsTokens = trimmed
          .split(/\s+/)
          .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ""))
          .filter((t) => t.length > 0)
          .map((t) => `${t}:*`)
        if (tsTokens.length > 0) {
          // No `type` option => PostgREST uses `to_tsquery`, which is
          // the only variant that respects the `:*` prefix wildcard.
          // (`plainto_tsquery` strips operators; `websearch_to_tsquery`
          // doesn't recognise `:*` either.)
          query = query.textSearch("search_vector", tsTokens.join(" & "), {
            config: "simple",
          })
        } else {
          query = query.or(
            `title.ilike.%${trimmed}%,client_name.ilike.%${trimmed}%,karbon_work_item_key.ilike.%${trimmed}%`,
          )
        }
      } else {
        query = query.or(
          `title.ilike.%${trimmed}%,client_name.ilike.%${trimmed}%,karbon_work_item_key.ilike.%${trimmed}%`,
        )
      }
    }
    if (active === "true") {
      query = query
        .not("status", "ilike", "%completed%")
        .not("status", "ilike", "%cancelled%")
        .not("status", "ilike", "%canceled%")
    }

    const { data: workItems, error, count } = await query

    if (error) throw error

    // Transform to include client info using enriched view flat fields
    const formattedItems = (workItems || []).map((item: any) => ({
      ...item,
      client_name: item.client_name || item.contact_full_name || item.org_name || item.client_type,
      client_email: item.contact_email || item.org_email,
    }))

    return NextResponse.json({
      work_items: formattedItems,
      total: count || formattedItems.length,
      limit,
      offset,
    })
  } catch (error) {
    console.error("Error fetching work items:", error)
    return NextResponse.json({ error: "Failed to fetch work items" }, { status: 500 })
  }
}
