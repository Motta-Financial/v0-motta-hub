import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"
import { scanRelationships } from "@/lib/tax/relationships/scanner"

/**
 * POST /api/tax/relationships/scan
 *
 * Triggers a re-scan of the tax-client relationship graph. Body:
 *   { scope: "all" }
 *   { scope: "engagement", engagementId: "<uuid>" }
 *   { scope: "client", proconnectClientId: "..." }
 *
 * Returns the scan report (counts of inserts/updates/etc.). The
 * scanner is idempotent: re-running with the same scope does not
 * duplicate relationship rows.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      scope?: "all" | "engagement" | "client"
      engagementId?: string
      proconnectClientId?: string
    } | null

    const scope = body?.scope ?? "all"
    if (scope === "engagement" && !body?.engagementId) {
      return NextResponse.json(
        { error: "engagementId required when scope=engagement" },
        { status: 400 },
      )
    }
    if (scope === "client" && !body?.proconnectClientId) {
      return NextResponse.json(
        { error: "proconnectClientId required when scope=client" },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    const report = await scanRelationships(
      admin,
      scope === "engagement"
        ? { kind: "engagement", engagementId: body!.engagementId! }
        : scope === "client"
          ? { kind: "client", proconnectClientId: body!.proconnectClientId! }
          : { kind: "all" },
    )
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    console.error("[v0] /api/tax/relationships/scan failed", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "scan failed" },
      { status: 500 },
    )
  }
}
