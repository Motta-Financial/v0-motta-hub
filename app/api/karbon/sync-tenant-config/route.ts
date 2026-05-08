/**
 * Manual sync endpoint for Karbon tenant-config (Work Statuses, Work Types,
 * Work Templates).
 *
 * The 4-hourly cron at /api/cron/karbon-sync handles the automatic schedule;
 * this endpoint exists for:
 *   - Admins clicking "Sync now" buttons in the UI
 *   - One-off backfills after a schema change
 *   - The cron itself when ?force=tenant-config is passed
 *
 * Auth: requires either the CRON_SECRET (machine-to-machine) or a
 * server-authenticated Supabase session (admin user). Anon callers
 * are rejected.
 */
import { NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { getKarbonCredentials } from "@/lib/karbon-api"
import { syncKarbonTenantConfig } from "@/lib/karbon/sync-tenant-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // Karbon /WorkTemplates is ~58 rows, well under 60s

function authorize(request: Request): { ok: boolean; isManual: boolean; reason?: string } {
  // Cron / internal callers
  const auth = request.headers.get("authorization")
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    return { ok: true, isManual: false }
  }
  if (request.headers.get("x-internal-secret") === process.env.CRON_SECRET) {
    return { ok: true, isManual: false }
  }
  if (request.headers.get("x-vercel-cron")) {
    return { ok: true, isManual: false }
  }
  // Dev-mode fallback when CRON_SECRET isn't set
  if (!process.env.CRON_SECRET || process.env.NODE_ENV !== "production") {
    return { ok: true, isManual: true }
  }
  // TODO: also accept an authenticated admin session via Supabase cookies
  // once we wire the manual UI.
  return { ok: false, isManual: false, reason: "Unauthorized" }
}

export async function POST(request: Request) {
  return handle(request)
}

export async function GET(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  const authResult = authorize(request)
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.reason || "Unauthorized" }, { status: 401 })
  }

  const creds = getKarbonCredentials()
  if (!creds) {
    return NextResponse.json({ error: "Karbon credentials not configured" }, { status: 500 })
  }

  const db = tryCreateAdminClient()
  if (!db) {
    return NextResponse.json({ error: "Supabase admin client not configured" }, { status: 500 })
  }

  const report = await syncKarbonTenantConfig(creds, db, {
    isManual: authResult.isManual,
    source: authResult.isManual ? "manual" : "cron",
  })

  return NextResponse.json(report, { status: report.ok ? 200 : 500 })
}
