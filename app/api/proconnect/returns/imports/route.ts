/**
 * Import history — list of every import attempt against any return,
 * with optional filters. Powers the audit-log dashboard.
 *
 * GET /api/proconnect/returns/imports?returnId=...&clientId=...&status=...&limit=50
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const returnId = url.searchParams.get("returnId")
    const clientId = url.searchParams.get("clientId")
    const status = url.searchParams.get("status")
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 500)

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    let q = sb
      .from("proconnect_import_jobs")
      .select(
        "id, return_id, proconnect_client_id, series_id, status, dry_run, entry_count_requested, imported_count, error_count, request_version, response_version, http_status, error_message, intuit_tid, triggered_by, trigger_context, started_at, completed_at",
      )
      .order("started_at", { ascending: false })
      .limit(limit)

    if (returnId) q = q.eq("return_id", returnId)
    if (clientId) q = q.eq("proconnect_client_id", clientId)
    if (status) q = q.eq("status", status)

    const { data, error } = await q
    if (error) throw error
    return NextResponse.json({ jobs: data || [] })
  } catch (err) {
    console.error("[v0] GET /returns/imports failed", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
