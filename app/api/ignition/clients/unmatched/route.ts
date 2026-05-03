/**
 * GET /api/ignition/clients/unmatched
 *
 * Lists Ignition clients that need a contact/organization link, ordered by
 * total proposal value DESC (highest-impact-first triage). Each row carries
 * its top auto-suggested candidate inline so the UI doesn't need a fan-out.
 *
 * Query params:
 *   - limit:  page size (default 50, max 200)
 *   - offset: pagination offset
 *   - search: case-insensitive substring on name / business_name / email
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const supabase = await createClient()

  // Auth gate: this is an admin endpoint, not a public listing.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200)
  const offset = Number(searchParams.get("offset")) || 0
  const search = searchParams.get("search")?.trim()

  let query = supabase
    .from("unmatched_ignition_clients")
    .select("*", { count: "exact" })
    .order("total_proposal_value", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (search) {
    query = query.or(
      `name.ilike.%${search}%,business_name.ilike.%${search}%,email.ilike.%${search}%`,
    )
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    clients: data || [],
    total: count ?? 0,
    limit,
    offset,
  })
}
