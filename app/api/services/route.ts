import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { escapeForOrFilter } from "@/lib/services/filter-services"

/**
 * GET /api/services — the firm's service catalog (Ignition price book).
 *
 * Drives the "Project Finance" services picker on the debrief form, which
 * is how selected services reach the proposal.
 *
 * ── Why the limit changed ────────────────────────────────────────────
 * The default was 100 and there are currently exactly 100 active
 * services. So the picker was showing the full catalog *by coincidence* —
 * the 101st service added would have silently vanished from the list with
 * no error anywhere. A truncated price book is the kind of bug that
 * surfaces as "why can't I find that service?" months later, so the cap
 * is now well clear of the catalog and `total`/`truncated` are reported
 * so a future overflow is visible instead of silent.
 */

/** Generous ceiling: ~100 services today, so this is 5x headroom. */
const DEFAULT_LIMIT = 500
const MAX_LIMIT = 2000

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const search = searchParams.get("search")
  const category = searchParams.get("category")
  // `state=all` returns archived services too — used by admin surfaces
  // that need to show a service a historical debrief referenced.
  const stateParam = searchParams.get("state") || "active"
  const requestedLimit = Number.parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT))
  const limit = Math.min(
    Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_LIMIT,
    MAX_LIMIT,
  )

  let query = supabase
    .from("services")
    .select("*", { count: "exact" })
    .order("category", { ascending: true })
    .order("name", { ascending: true })
    .limit(limit)

  if (stateParam !== "all") {
    query = query.eq("state", stateParam)
  }

  if (search) {
    const safe = escapeForOrFilter(search)
    if (safe.length > 0) {
      query = query.or(
        `name.ilike.%${safe}%,description.ilike.%${safe}%,category.ilike.%${safe}%`,
      )
    }
  }

  if (category) {
    query = query.eq("category", category)
  }

  const { data: services, error, count } = await query

  if (error) {
    console.error("Error fetching services:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const returned = services?.length ?? 0
  const total = count ?? returned
  // Surfaced so a caller can tell the difference between "that's the whole
  // catalog" and "you're seeing the first N of it".
  const truncated = total > returned
  if (truncated) {
    console.warn(
      `[api/services] returned ${returned} of ${total} — raise the limit or paginate`,
    )
  }

  return NextResponse.json({ services, total, returned, truncated })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()

  const { data: service, error } = await supabase.from("services").insert(body).select().single()

  if (error) {
    console.error("Error creating service:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ service })
}
