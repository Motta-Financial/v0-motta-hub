/**
 * Export a tax-return's full series map and persist a snapshot.
 *
 * GET  /api/proconnect/returns/[returnId]/data?clientId=...&persist=true
 * POST /api/proconnect/returns/[returnId]/data    (force a fresh fetch)
 *
 * Phase 1 endpoint:
 *   GET https://api.intuit.com/v2/clients/{clientId}/returns/{returnId}/data
 *
 * Persistence model (see scripts/130_proconnect_return_data.sql):
 *   - proconnect_return_snapshots stores one row per (client, return)
 *     and is updated in-place on each fetch. We track `version` and
 *     `series_versions` for OCC.
 *   - proconnect_return_field_cells stores the flattened leaf cells —
 *     one row per (return, series, prefix, code, suffix). We replace
 *     the entire set on each successful export to avoid stale rows.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { exportReturnData } from "@/lib/proconnect/data"
import { persistReturnSnapshot } from "@/lib/proconnect/snapshots"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

async function loadAndPersist(clientId: string, returnId: string) {
  const result = await exportReturnData(clientId, returnId)
  if (!result.ok) return result

  // Persist the snapshot + flattened cells (shared with the webhook
  // receiver and the import route's post-write refresh).
  await persistReturnSnapshot(admin(), clientId, returnId, result.data)

  return result
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    const { returnId } = await ctx.params
    const url = new URL(req.url)
    const clientId = url.searchParams.get("clientId")
    if (!clientId) {
      return NextResponse.json({ error: "clientId query param is required" }, { status: 400 })
    }

    // Fast path: return a cached snapshot if one exists and is fresh.
    // Caller can override with ?fresh=true.
    const fresh = url.searchParams.get("fresh") === "true"
    if (!fresh) {
      const sb = admin()
      const { data: cached } = await sb
        .from("proconnect_return_snapshots")
        .select("*")
        .eq("return_id", returnId)
        .maybeSingle()
      // Tombstoned snapshots (return deleted in ProConnect) must not be
      // served as a live cache hit — fall through to a fresh export,
      // which will 404 upstream if the return is really gone.
      if (cached && !cached.deleted_at) {
        // Stale-while-revalidate: return cached, kick off a background
        // refresh if older than 5 minutes. We don't await it.
        const age = Date.now() - new Date(cached.exported_at).getTime()
        if (age > 5 * 60_000) {
          loadAndPersist(clientId, returnId).catch((err) =>
            console.error("[v0] background return-data refresh failed", err),
          )
        }
        return NextResponse.json({ source: "cache", snapshot: cached })
      }
    }

    const result = await loadAndPersist(clientId, returnId)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, intuitTid: result.intuitTid },
        { status: result.error.status || 500 },
      )
    }
    return NextResponse.json({ source: "live", data: result.data, intuitTid: result.intuitTid })
  } catch (err) {
    console.error("[v0] GET /returns/[returnId]/data failed", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/** POST forces a fresh fetch + persistence. Same body as GET?fresh=true. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    const { returnId } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as { clientId?: string }
    const clientId = body.clientId
    if (!clientId) {
      return NextResponse.json({ error: "clientId is required in body" }, { status: 400 })
    }
    const result = await loadAndPersist(clientId, returnId)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, intuitTid: result.intuitTid },
        { status: result.error.status || 500 },
      )
    }
    return NextResponse.json({ source: "live", data: result.data, intuitTid: result.intuitTid })
  } catch (err) {
    console.error("[v0] POST /returns/[returnId]/data failed", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
