/**
 * GET /api/client-portal/documents
 *
 * Flat list of every document visible to the current portal user's
 * client, across all of their work items. Powers the portal's Documents
 * page. Each row carries the parent work item's title so the UI can
 * group files by the task they belong to.
 *
 * Scoping: we first resolve the client's work item ids, then fetch
 * documents restricted to that set. A client therefore only ever sees
 * files hanging off their own work.
 */

import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { applyPortalEntityFilter } from "@/lib/portal/entity-filter"
import { NextResponse } from "next/server"

export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  // Resolve this client's work items first — used both to scope the
  // document query and to label each file with its task title.
  const workItemsQuery = supabase.from("work_items").select("id, title, work_type")

  const { data: workItems, error: wiError } = await applyPortalEntityFilter(
    workItemsQuery,
    portalUser,
  )

  if (wiError) {
    return NextResponse.json({ error: wiError.message }, { status: 500 })
  }

  const workItemIds = (workItems ?? []).map((w) => w.id)
  if (workItemIds.length === 0) {
    return NextResponse.json({ documents: [] })
  }

  const titleById = new Map(
    (workItems ?? []).map((w) => [w.id, { title: w.title, type: w.work_type }]),
  )

  const { data: documents, error: docError } = await supabase
    .from("documents")
    .select(`
      id,
      name,
      file_type,
      mime_type,
      file_size_bytes,
      document_type,
      tax_year,
      status,
      uploaded_at,
      uploaded_by_role,
      work_item_id,
      created_at
    `)
    .in("work_item_id", workItemIds)
    .order("uploaded_at", { ascending: false, nullsFirst: false })

  if (docError) {
    return NextResponse.json({ error: docError.message }, { status: 500 })
  }

  const enriched = (documents ?? []).map((d) => ({
    ...d,
    work_item_title: titleById.get(d.work_item_id)?.title ?? null,
    work_item_type: titleById.get(d.work_item_id)?.type ?? null,
  }))

  return NextResponse.json({ documents: enriched })
}
