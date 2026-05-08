/**
 * Work Statuses endpoint.
 *
 *   GET                       — return cached statuses from Supabase
 *   GET ?source=karbon        — return live statuses from Karbon (no DB write)
 *   GET ?sync=true            — sync from Karbon to Supabase, then return
 *   PATCH { id, is_default_filter?, is_active? }
 *                             — admin tweak from /admin/work-statuses
 *
 * The sync path delegates to lib/karbon/sync-tenant-config.ts which uses
 * the up-to-date nested TenantSettings parser (the previous flat-shape
 * parser was broken — Karbon changed its response format).
 */
import { NextResponse } from "next/server"
import { karbonFetch, getKarbonCredentials } from "@/lib/karbon-api"
import { createAdminClient } from "@/lib/supabase/server"
import { syncWorkStatusesAndTypes } from "@/lib/karbon/sync-tenant-config"

interface KarbonChildStatus {
  Name: string
  Type: "Secondary"
  WorkStatusKey: string
}
interface KarbonPrimaryStatusGroup {
  Name: string
  Type: "Primary"
  Children: KarbonChildStatus[]
}
interface KarbonTenantSettings {
  WorkStatuses?: KarbonPrimaryStatusGroup[]
}

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const sync = searchParams.get("sync") === "true"
  const source = searchParams.get("source")

  // Default + ?source=supabase: return cached rows
  if (!sync && source !== "karbon") {
    const { data, error } = await supabase
      .from("work_status")
      .select("*")
      .order("display_order", { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ statuses: data, count: data?.length ?? 0, source: "supabase" })
  }

  // Need Karbon — verify creds
  const credentials = getKarbonCredentials()
  if (!credentials) {
    return NextResponse.json({ error: "Karbon credentials not configured" }, { status: 500 })
  }

  // ?sync=true: write through to Supabase via the shared sync lib
  if (sync) {
    const { workStatuses, workTypes } = await syncWorkStatusesAndTypes(credentials, supabase)
    if (!workStatuses.ok) {
      return NextResponse.json(
        { error: workStatuses.error || "sync failed", workStatuses, workTypes },
        { status: 500 },
      )
    }
    // Return the freshly-synced rows for convenience
    const { data } = await supabase
      .from("work_status")
      .select("*")
      .order("display_order", { ascending: true })
    return NextResponse.json({
      statuses: data,
      count: data?.length ?? 0,
      source: "karbon",
      synced: true,
      workStatuses,
      workTypes,
    })
  }

  // ?source=karbon (no sync): live preview without DB write
  const { data: tenant, error: fetchErr } = await karbonFetch<KarbonTenantSettings>("/TenantSettings", credentials)
  if (fetchErr || !tenant) {
    return NextResponse.json(
      { error: fetchErr || "Failed to fetch tenant settings from Karbon" },
      { status: 500 },
    )
  }

  // Flatten nested groups so the UI can render uniformly
  const flat = (tenant.WorkStatuses || []).flatMap((group) =>
    (group.Children || []).map((child) => ({
      WorkStatusKey: child.WorkStatusKey,
      PrimaryStatusName: group.Name,
      SecondaryStatusName: child.Name,
    })),
  )

  return NextResponse.json({
    statuses: flat,
    count: flat.length,
    source: "karbon",
  })
}

// PATCH - Update work status filter preferences (admin UI)
export async function PATCH(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { id, is_default_filter, is_active } = body

    if (!id) {
      return NextResponse.json({ error: "Status ID is required" }, { status: 400 })
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() }
    if (is_default_filter !== undefined) updateData.is_default_filter = is_default_filter
    if (is_active !== undefined) updateData.is_active = is_active

    const { data, error } = await supabase
      .from("work_status")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
