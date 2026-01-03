import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll, karbonFetch } from "@/lib/karbon-api"
import { createClient } from "@supabase/supabase-js"

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseKey)
}

function mapKarbonNoteToSupabase(note: any) {
  return {
    karbon_note_key: note.NoteKey,
    subject: note.Subject || null,
    body: note.Body || null,
    note_type: note.NoteType || null,
    is_pinned: note.IsPinned || false,
    author_key: note.AuthorKey || null,
    author_name: note.AuthorName || null,
    karbon_work_item_key: note.WorkItemKey || null,
    work_item_title: note.WorkItemTitle || null,
    karbon_contact_key: note.ContactKey || null,
    contact_name: note.ContactName || null,
    karbon_url: note.NoteKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/notes/${note.NoteKey}` : null,
    karbon_created_at: note.CreatedDate || null,
    karbon_modified_at: note.LastModifiedDateTime || null,
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
    const contactKey = searchParams.get("contactKey")
    const workItemKey = searchParams.get("workItemKey")
    const authorKey = searchParams.get("authorKey")
    const createdAfter = searchParams.get("createdAfter")
    const top = searchParams.get("top")
    const importToSupabase = searchParams.get("import") === "true"
    const incrementalSync = searchParams.get("incremental") === "true"

    const filters: string[] = []

    if (contactKey) {
      filters.push(`ContactKey eq '${contactKey}'`)
    }

    if (workItemKey) {
      filters.push(`WorkItemKey eq '${workItemKey}'`)
    }

    if (authorKey) {
      filters.push(`AuthorKey eq '${authorKey}'`)
    }

    if (createdAfter) {
      filters.push(`CreatedDate ge ${createdAfter}`)
    }

    const queryOptions: any = {
      count: true,
      orderby: "CreatedDate desc",
    }

    // Get last sync timestamp for incremental sync
    let lastSyncTimestamp: string | null = null
    if (incrementalSync && importToSupabase) {
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data: lastSync } = await supabase
          .from("karbon_notes")
          .select("karbon_modified_at")
          .not("karbon_modified_at", "is", null)
          .order("karbon_modified_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastSync?.karbon_modified_at) {
          lastSyncTimestamp = lastSync.karbon_modified_at
          filters.push(`LastModifiedDateTime gt ${lastSyncTimestamp}`)
        }
      }
    }

    if (filters.length > 0) {
      queryOptions.filter = filters.join(" and ")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    const { data: notes, error, totalCount } = await karbonFetchAll<any>("/Notes", credentials, queryOptions)

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

        const batchSize = 50
        for (let i = 0; i < notes.length; i += batchSize) {
          const batch = notes.slice(i, i + batchSize)
          const mappedBatch = batch.map((note: any) => ({
            ...mapKarbonNoteToSupabase(note),
            created_at: new Date().toISOString(),
          }))

          const { error: upsertError } = await supabase.from("karbon_notes").upsert(mappedBatch, {
            onConflict: "karbon_note_key",
            ignoreDuplicates: false,
          })

          if (upsertError) {
            errors += batch.length
            errorDetails.push(upsertError.message)
          } else {
            synced += batch.length
          }
        }

        importResult = {
          success: errors === 0,
          synced,
          errors,
          incrementalSync,
          lastSyncTimestamp,
          errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 5) : undefined,
        }
      }
    }

    const mappedNotes = notes.map((note: any) => ({
      NoteKey: note.NoteKey,
      Subject: note.Subject,
      Body: note.Body,
      NoteType: note.NoteType,
      Author: note.AuthorName
        ? {
            FullName: note.AuthorName,
            UserKey: note.AuthorKey,
          }
        : null,
      Contact: note.ContactName
        ? {
            ContactKey: note.ContactKey,
            Name: note.ContactName,
          }
        : null,
      WorkItem: note.WorkItemTitle
        ? {
            WorkItemKey: note.WorkItemKey,
            Title: note.WorkItemTitle,
          }
        : null,
      CreatedDate: note.CreatedDate,
      ModifiedDate: note.LastModifiedDateTime,
      IsPinned: note.IsPinned,
    }))

    return NextResponse.json({
      notes: mappedNotes,
      count: mappedNotes.length,
      totalCount: totalCount || mappedNotes.length,
      importResult,
    })
  } catch (error) {
    console.error("[v0] Error fetching notes:", error)
    return NextResponse.json(
      { error: "Failed to fetch notes", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()

    const { data, error } = await karbonFetch<any>("/Notes", credentials, {
      method: "POST",
      body,
    })

    if (error) {
      return NextResponse.json({ error: `Failed to create note: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, note: data })
  } catch (error) {
    console.error("[v0] Error creating note:", error)
    return NextResponse.json(
      { error: "Failed to create note", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
