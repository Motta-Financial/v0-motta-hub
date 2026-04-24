import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll } from "@/lib/karbon-api"
import { tryCreateAdminClient } from "@/lib/supabase/server"

function getSupabaseClient() {
  return tryCreateAdminClient()
}

/**
 * Maps a Karbon ClientGroup to the Supabase client_groups table.
 * 
 * Karbon API fields (GET /v3/ClientGroups/{key}?$expand=BusinessCard,ClientTeam):
 *   ClientGroupKey, FullName, ContactType, UserDefinedIdentifier,
 *   RestrictionLevel (Public/Private/Hidden), Members[], EntityDescription,
 *   ClientOwner (UserKey), ClientManager (UserKey), ClientTeam[]
 */
function mapKarbonClientGroupToSupabase(group: any) {
  // Karbon uses FullName for client groups, not Name
  const groupName = group.FullName || group.Name || `Group ${group.ClientGroupKey}`

  return {
    karbon_client_group_key: group.ClientGroupKey,
    name: groupName,
    description: group.EntityDescription || group.Description || null,
    group_type: group.ContactType || group.GroupType || null,
    contact_type: group.ContactType || null,
    primary_contact_key: group.PrimaryContactKey || null,
    primary_contact_name: group.PrimaryContactName || null,
    client_owner_key: group.ClientOwner || null,
    client_owner_name: group.ClientOwnerName || null,
    client_manager_key: group.ClientManager || null,
    client_manager_name: group.ClientManagerName || null,
    members: group.Members || [],
    restriction_level: group.RestrictionLevel || 'Public',
    user_defined_identifier: group.UserDefinedIdentifier || null,
    entity_description: group.EntityDescription || null,
    karbon_url: group.ClientGroupKey
      ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/client-groups/${group.ClientGroupKey}`
      : null,
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
      orderby: "FullName asc",
    }

    // Always expand BusinessCard and ClientTeam for full data
    if (expand) {
      queryOptions.expand = expand.split(",")
    } else {
      queryOptions.expand = ["BusinessCard", "ClientTeam"]
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
      FullName: group.FullName || group.Name,
      Description: group.EntityDescription || group.Description,
      ContactType: group.ContactType || group.GroupType,
      RestrictionLevel: group.RestrictionLevel,
      UserDefinedIdentifier: group.UserDefinedIdentifier,
      Members: group.Members || [],
      ClientOwner: group.ClientOwner,
      ClientManager: group.ClientManager,
      ClientTeam: group.ClientTeam || [],
      BusinessCard: group.BusinessCard || null,
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
