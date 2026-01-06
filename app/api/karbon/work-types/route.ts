import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const KARBON_API_BASE = "https://api.karbonhq.com/v3"

interface KarbonWorkType {
  WorkTypeKey: string
  Name: string
  PrimaryStatuses?: Array<{
    Name: string
    SecondaryStatusKeys?: string[]
  }>
}

interface KarbonTenantSettings {
  WorkTypes?: KarbonWorkType[]
  WorkStatuses?: Array<{
    WorkStatusKey: string
    Name: string
    StatusType: string
  }>
}

// GET - Fetch all work types from Karbon and optionally sync to Supabase
export async function GET(request: NextRequest) {
  try {
    const bearerToken = process.env.KARBON_BEARER_TOKEN
    const accessKey = process.env.KARBON_ACCESS_KEY

    if (!bearerToken || !accessKey) {
      return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const syncToSupabase = searchParams.get("sync") === "true"

    // Fetch TenantSettings from Karbon which contains WorkTypes
    const response = await fetch(`${KARBON_API_BASE}/TenantSettings`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        AccessKey: accessKey,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Karbon TenantSettings error:", response.status, errorText)
      return NextResponse.json(
        { error: `Karbon API error: ${response.status}`, details: errorText },
        { status: response.status },
      )
    }

    const tenantSettings: KarbonTenantSettings = await response.json()
    const workTypes = tenantSettings.WorkTypes || []

    console.log(`[v0] Fetched ${workTypes.length} work types from Karbon`)

    // If sync requested, upsert to Supabase
    if (syncToSupabase) {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

      if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json({ error: "Supabase credentials not configured" }, { status: 500 })
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey)

      // Map Karbon work types to Supabase schema
      const mappedWorkTypes = workTypes.map((wt) => ({
        karbon_work_type_key: wt.WorkTypeKey,
        name: wt.Name,
        code: wt.Name.toUpperCase()
          .replace(/[^A-Z0-9]/g, "_")
          .substring(0, 20),
        description: `Imported from Karbon: ${wt.Name}`,
        is_active: true,
        is_recurring:
          wt.Name.toLowerCase().includes("recurring") ||
          wt.Name.toLowerCase().includes("monthly") ||
          wt.Name.toLowerCase().includes("bookkeeping"),
        updated_at: new Date().toISOString(),
      }))

      // Upsert work types
      const { data: upsertedData, error: upsertError } = await supabase
        .from("work_types")
        .upsert(mappedWorkTypes, {
          onConflict: "karbon_work_type_key",
          ignoreDuplicates: false,
        })
        .select()

      if (upsertError) {
        console.error("[v0] Supabase upsert error:", upsertError)
        return NextResponse.json(
          { error: "Failed to sync work types to Supabase", details: upsertError },
          { status: 500 },
        )
      }

      console.log(`[v0] Synced ${mappedWorkTypes.length} work types to Supabase`)

      return NextResponse.json({
        success: true,
        message: `Synced ${mappedWorkTypes.length} work types from Karbon to Supabase`,
        workTypes: upsertedData || mappedWorkTypes,
        karbonWorkTypes: workTypes,
      })
    }

    // Return raw Karbon work types if no sync requested
    return NextResponse.json({
      success: true,
      count: workTypes.length,
      workTypes: workTypes.map((wt) => ({
        karbonWorkTypeKey: wt.WorkTypeKey,
        name: wt.Name,
        primaryStatuses: wt.PrimaryStatuses,
      })),
      // Also include work statuses if available
      workStatuses: tenantSettings.WorkStatuses || [],
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon work types:", error)
    return NextResponse.json({ error: "Internal server error", details: String(error) }, { status: 500 })
  }
}

// POST - Manually trigger sync of work types from Karbon to Supabase
export async function POST(request: NextRequest) {
  try {
    const bearerToken = process.env.KARBON_BEARER_TOKEN
    const accessKey = process.env.KARBON_ACCESS_KEY
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!bearerToken || !accessKey) {
      return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 500 })
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Supabase credentials not configured" }, { status: 500 })
    }

    // Fetch TenantSettings from Karbon
    const response = await fetch(`${KARBON_API_BASE}/TenantSettings`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        AccessKey: accessKey,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `Karbon API error: ${response.status}`, details: errorText },
        { status: response.status },
      )
    }

    const tenantSettings: KarbonTenantSettings = await response.json()
    const workTypes = tenantSettings.WorkTypes || []
    const workStatuses = tenantSettings.WorkStatuses || []

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Map and upsert work types
    const mappedWorkTypes = workTypes.map((wt) => ({
      karbon_work_type_key: wt.WorkTypeKey,
      name: wt.Name,
      code: wt.Name.toUpperCase()
        .replace(/[^A-Z0-9]/g, "_")
        .substring(0, 20),
      description: `Imported from Karbon: ${wt.Name}`,
      is_active: true,
      is_recurring:
        wt.Name.toLowerCase().includes("recurring") ||
        wt.Name.toLowerCase().includes("monthly") ||
        wt.Name.toLowerCase().includes("bookkeeping"),
      updated_at: new Date().toISOString(),
    }))

    const { data: workTypesData, error: workTypesError } = await supabase
      .from("work_types")
      .upsert(mappedWorkTypes, {
        onConflict: "karbon_work_type_key",
        ignoreDuplicates: false,
      })
      .select()

    if (workTypesError) {
      console.error("[v0] Work types upsert error:", workTypesError)
      return NextResponse.json({ error: "Failed to sync work types", details: workTypesError }, { status: 500 })
    }

    // Also sync work statuses if the table exists
    const mappedStatuses = workStatuses.map((ws) => ({
      karbon_status_key: ws.WorkStatusKey,
      name: ws.Name,
      status_type: ws.StatusType,
      is_active: true,
      updated_at: new Date().toISOString(),
    }))

    let statusesResult = null
    if (mappedStatuses.length > 0) {
      const { data: statusData, error: statusError } = await supabase
        .from("work_status")
        .upsert(mappedStatuses, {
          onConflict: "karbon_status_key",
          ignoreDuplicates: false,
        })
        .select()

      if (statusError) {
        console.error("[v0] Work statuses upsert error:", statusError)
        // Don't fail the whole request, just log the error
      } else {
        statusesResult = statusData
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${workTypes.length} work types and ${workStatuses.length} work statuses from Karbon`,
      workTypes: {
        count: workTypes.length,
        data: workTypesData || mappedWorkTypes,
      },
      workStatuses: {
        count: workStatuses.length,
        data: statusesResult || mappedStatuses,
      },
    })
  } catch (error) {
    console.error("[v0] Error syncing Karbon work types:", error)
    return NextResponse.json({ error: "Internal server error", details: String(error) }, { status: 500 })
  }
}
