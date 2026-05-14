/**
 * GET /api/contacts-and-orgs/search
 *
 * Unified case-insensitive search across `contacts` and `organizations` for
 * the manual-mapping picker in the Ignition admin (and any other surface
 * that needs to let an admin pick "any client" by name or email).
 *
 * Query params:
 *   - q:     required, min length 2. Substring match (case-insensitive) on
 *            contacts.full_name / primary_email / secondary_email and on
 *            organizations.name / primary_email.
 *   - limit: optional, default 8, max 20. Caps the *merged* result list so
 *            the picker stays scannable.
 *
 * Response shape:
 *   { results: Array<{ id, name, email | null, kind: "contact"|"organization" }> }
 *
 * Ranking: results that match on email (especially exact email) sort
 * above results that only matched on name. The dialog assumes the first
 * row is the "best guess" so the order matters.
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

export const runtime = "nodejs"

type Hit = {
  id: string
  name: string
  email: string | null
  kind: "contact" | "organization"
  // Internal-only ranking signal; stripped from the response.
  _rank: number
}

export async function GET(req: Request) {
  const supabase = await createClient()

  // Auth gate: this is an admin-only resolver. Anyone who can hit it can
  // enumerate the firm's entire client book by name, so a logged-in
  // session is required.
  const {
    data: { user },
  } = await getAuthenticatedUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")?.trim() ?? ""
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 8, 1), 20)

  if (q.length < 2) {
    // Match the picker's expectation: empty input → empty results, not a
    // 400. The dialog already gates the request on `q.length >= 2` but
    // we re-enforce here for defensive use by other callers.
    return NextResponse.json({ results: [] })
  }

  // Each table is queried with a slightly bigger budget than `limit` so
  // that, after merging and ranking, we still have enough rows to fill
  // the requested page even if (say) contacts dominates the hit set.
  const perTable = Math.min(limit * 2, 40)
  const qLower = q.toLowerCase()
  // Supabase .or() takes a comma-separated list of column.op.value
  // clauses. We escape any commas / parens in the user input to keep
  // the parser happy; the search input doesn't legitimately contain
  // either and stripping them is preferable to URL-encoding noise.
  const safe = q.replace(/[%,()*]/g, " ").trim()

  const [contactsRes, orgsRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, full_name, primary_email, secondary_email")
      .or(
        `full_name.ilike.%${safe}%,primary_email.ilike.%${safe}%,secondary_email.ilike.%${safe}%`,
      )
      .limit(perTable),
    supabase
      .from("organizations")
      .select("id, name, primary_email")
      .or(`name.ilike.%${safe}%,primary_email.ilike.%${safe}%`)
      .limit(perTable),
  ])

  if (contactsRes.error) {
    return NextResponse.json({ error: contactsRes.error.message }, { status: 500 })
  }
  if (orgsRes.error) {
    return NextResponse.json({ error: orgsRes.error.message }, { status: 500 })
  }

  // Rank: lower is better.
  //   0 = exact email match
  //   1 = email starts-with
  //   2 = email contains
  //   3 = name starts-with
  //   4 = name contains (fallback)
  // The picker shows ~8 rows; we want exact-email hits glued to the top
  // because that's the workflow that catches "I know the email, just
  // give me the matching person."
  const rankRow = (
    name: string,
    primary: string | null,
    secondary: string | null,
  ): number => {
    const nm = (name || "").toLowerCase()
    const pe = (primary || "").toLowerCase()
    const se = (secondary || "").toLowerCase()
    if (pe === qLower || se === qLower) return 0
    if (pe.startsWith(qLower) || se.startsWith(qLower)) return 1
    if (pe.includes(qLower) || se.includes(qLower)) return 2
    if (nm.startsWith(qLower)) return 3
    return 4
  }

  const hits: Hit[] = []
  for (const c of contactsRes.data ?? []) {
    hits.push({
      id: c.id as string,
      name: (c.full_name as string) || "(unnamed contact)",
      email: (c.primary_email as string) || (c.secondary_email as string) || null,
      kind: "contact",
      _rank: rankRow(c.full_name as string, c.primary_email as string, c.secondary_email as string),
    })
  }
  for (const o of orgsRes.data ?? []) {
    hits.push({
      id: o.id as string,
      name: (o.name as string) || "(unnamed organization)",
      email: (o.primary_email as string) || null,
      kind: "organization",
      _rank: rankRow(o.name as string, o.primary_email as string, null),
    })
  }

  hits.sort((a, b) => {
    if (a._rank !== b._rank) return a._rank - b._rank
    // Tie-break alphabetically so the ordering is stable across requests
    // for the same query, which makes the picker feel less jittery as
    // the user types.
    return a.name.localeCompare(b.name)
  })

  const results = hits.slice(0, limit).map(({ _rank, ...h }) => h)
  return NextResponse.json({ results })
}
