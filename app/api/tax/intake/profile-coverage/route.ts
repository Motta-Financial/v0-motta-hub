import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { profileCoverageReport } from "@/lib/tax/intake/profile"

/**
 * Firm-wide client-profile coverage for the 1040 header fields.
 *
 *   GET /api/tax/intake/profile-coverage[?clientsOnly=1]
 *
 * "Which taxpayer details are we missing across the book?" — answered once
 * for the whole population rather than discovered one return at a time in
 * March. Returns counts only; no client identifiers and no field values.
 */
export async function GET(req: Request) {
  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const clientsOnly = new URL(req.url).searchParams.get("clientsOnly") === "1"

  try {
    // Counted with the admin client so the query is unaffected by whatever
    // column grants `authenticated` happens to hold. Only aggregates leave
    // this route — no identifiers, no values.
    const report = await profileCoverageReport(createAdminClient(), { clientsOnly })
    return NextResponse.json({
      ...report,
      scope: clientsOnly ? "contacts typed Client*" : "all contacts",
      gaps: report.perField
        .filter((f) => f.necessity !== "optional" && f.pct < 90)
        .sort((a, b) => a.pct - b.pct),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] [tax/intake] profile-coverage failed:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
