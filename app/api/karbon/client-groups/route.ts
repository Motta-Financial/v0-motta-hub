import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll } from "@/lib/karbon-api"
import { createClient } from "@supabase/supabase-js"

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseKey)
}

function mapKarbonClientGroupToSupabase(group: any) {
  return {
    karbon_client_group_key: group.ClientGroupKey,
    name: group.Name || `Group ${group.ClientGroupKey}`,
    description: group.Description || null,
    group_type: group.GroupType || null,
    primary_contact_key: group.PrimaryContactKey || null,
    primary_contact_name: group.PrimaryContactName || null,
    members: group.Members || [],
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/client-groups/${group.ClientGroupKey}`,
    karbon_created_at: group.CreatedDate || null,
    karbon_modified_at: group.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function GET(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const expand = searchParams.get("expand")
    const top = searchParams.get("top")
    const importToSupabase = searchParams.get("import") === "true"
    const incrementalSync = searchParams.get("incremental") === "true"

    const queryOptions: any = {
      count: true,
      orderby: "Name asc",
    }

    if (expand) {
      queryOptions.expand = expand.split(",")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    // Get last sync timestamp for incremental sync
    let lastSyncTimestamp: string | null = null
    if (incrementalSync && importToSupabase) {
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data: lastSync } = await supabase
          .from("client_groups")
          .select("karbon_modified_at")
          .not("karbon_modified_at", "is", null)
          .order("karbon_modified_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastSync?.karbon_modified_at) {
          lastSyncTimestamp = lastSync.karbon_modified_at
          queryOptions.filter = `LastModifiedDateTime gt ${lastSyncTimestamp}`
        }
      }
    }

    const { data: groups, error, totalCount } = await karbonFetchAll<any>("/ClientGroups", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    let importResult = null
    if (importToSupabase) {
      const supabase = getSupabaseClient()
      if (!supabase) {
        importResult = { error: "Supabase not configured" }
      } else {
        let synced = 0
        let errors = 0
        const errorDetails: string[] = []

        const mappedGroups = groups.map((group: any) => ({
          ...mapKarbonClientGroupToSupabase(group),
          created_at: new Date().toISOString(),
        }))

        const { error: upsertError } = await supabase.from("client_groups").upsert(mappedGroups, {
          onConflict: "karbon_client_group_key",
          ignoreDuplicates: false,
        })

        if (upsertError) {
          errors = mappedGroups.length
          errorDetails.push(upsertError.message)
        } else {
          synced = mappedGroups.length
        }

        importResult = {
          success: errors === 0,
          synced,
          errors,
          incrementalSync,
          lastSyncTimestamp,
          errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
        }
      }
    }

    const mappedGroups = groups.map((group: any) => ({
      ClientGroupKey: group.ClientGroupKey,
      Name: group.Name,
      Description: group.Description,
      GroupType: group.GroupType,
      Members: group.Members || [],
      PrimaryContact: group.PrimaryContactKey
        ? {
            ContactKey: group.PrimaryContactKey,
            Name: group.PrimaryContactName,
          }
        : null,
      CreatedDate: group.CreatedDate,
      ModifiedDate: group.LastModifiedDateTime,
    }))

    return NextResponse.json({
      clientGroups: mappedGroups,
      count: mappedGroups.length,
      totalCount: totalCount || mappedGroups.length,
      importResult,
    })
  } catch (error) {
    console.error("[v0] Error fetching client groups:", error)
    return NextResponse.json(
      { error: "Failed to fetch client groups", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
