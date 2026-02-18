import { NextResponse } from "next/server"
import { karbonFetch, getKarbonCredentials } from "@/lib/karbon-api"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

interface KarbonWorkStatusFromTenant {
  WorkStatusKey: string
  PrimaryStatusName: string
  SecondaryStatusName: string
  WorkTypeKeys?: string[]
}

interface KarbonTenantSettings {
  WorkStatuses?: KarbonWorkStatusFromTenant[]
  WorkTypes?: Array<{
    WorkTypeKey: string
    Name: string
    AvailableStatuses?: string[]
  }>
  ContactTypes?: string[]
}

// GET - Fetch work statuses from Karbon TenantSettings and optionally sync to Supabase
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sync = searchParams.get("sync") === "true"
  const fromSupabase = searchParams.get("source") === "supabase"

  // If requesting from Supabase, return cached statuses
  if (fromSupabase) {
    const { data, error } = await supabase.from("work_status").select("*").order("display_order", { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      statuses: data,
      count: data.length,
      source: "supabase",
    })
  }

  // Fetch from Karbon API - correct endpoint is /TenantSettings
  const credentials = getKarbonCredentials()
  if (!credentials) {
    return NextResponse.json({ error: "Karbon credentials not configured" }, { status: 500 })
  }

  // The Karbon API exposes statuses under /TenantSettings, NOT /WorkStatuses
  const { data: tenantSettings, error } = await karbonFetch<KarbonTenantSettings>("/TenantSettings", credentials)

  if (error || !tenantSettings) {
    return NextResponse.json({ error: error || "Failed to fetch tenant settings from Karbon" }, { status: 500 })
  }

  const statuses = tenantSettings.WorkStatuses || []
  console.log(`[Karbon] Fetched ${statuses.length} work statuses from TenantSettings`)

  // If sync is requested, upsert to Supabase
  if (sync) {
    // Define which statuses should NOT be included in default "active" filter
    // These represent completed, cancelled, or inactive work items
    const inactiveStatuses = [
      "completed",
      "cancelled",
      "on hold",
      "archived",
      "closed",
      "deferred",
      "not applicable",
      "n/a",
      "deleted",
    ]

    // TenantSettings returns statuses with PrimaryStatusName + SecondaryStatusName
    // The combined name represents the full status (e.g. "In Progress" / "Waiting on Client")
    const statusRecords = statuses.map((status, index) => {
      const statusName = status.SecondaryStatusName
        ? `${status.PrimaryStatusName} - ${status.SecondaryStatusName}`
        : status.PrimaryStatusName
      const nameLower = statusName.toLowerCase()
      const isInactive = inactiveStatuses.some((s) => nameLower.includes(s))

      return {
        karbon_status_key: status.WorkStatusKey,
        name: statusName,
        description: status.SecondaryStatusName || null,
        status_type: status.PrimaryStatusName || null,
        primary_status_name: status.PrimaryStatusName || null,
        secondary_status_name: status.SecondaryStatusName || null,
        work_type_keys: status.WorkTypeKeys || null,
        display_order: index,
        is_active: !isInactive,
        is_default_filter: !isInactive,
        updated_at: new Date().toISOString(),
      }
    })

    const { data: upsertedData, error: upsertError } = await supabase
      .from("work_status")
      .upsert(statusRecords, {
        onConflict: "karbon_status_key",
        ignoreDuplicates: false,
      })
      .select()

    if (upsertError) {
      console.error("[Supabase] Error upserting work statuses:", upsertError)
      return NextResponse.json({
        statuses,
        count: statuses.length,
        source: "karbon",
        syncError: upsertError.message,
      })
    }

    console.log(`[Supabase] Synced ${statusRecords.length} work statuses`)

    return NextResponse.json({
      statuses: upsertedData || statusRecords,
      count: statuses.length,
      source: "karbon",
      synced: true,
    })
  }

  return NextResponse.json({
    statuses,
    count: statuses.length,
    source: "karbon",
  })
}

// PATCH - Update work status filter preferences
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { id, is_default_filter, is_active } = body

    if (!id) {
      return NextResponse.json({ error: "Status ID is required" }, { status: 400 })
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() }
    if (is_default_filter !== undefined) updateData.is_default_filter = is_default_filter
    if (is_active !== undefined) updateData.is_active = is_active

    const { data, error } = await supabase.from("work_status").update(updateData).eq("id", id).select().single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ status: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
