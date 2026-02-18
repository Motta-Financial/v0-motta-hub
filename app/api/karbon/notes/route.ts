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
    assignee_email: note.AssigneeEmailAddress || null,
    due_date: note.DueDate ? note.DueDate.split("T")[0] : null,
    todo_date: note.TodoDate ? note.TodoDate.split("T")[0] : null,
    timelines: note.Timelines || null,
    comments: note.Comments || null,
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

/**
 * GET /api/karbon/notes
 * 
 * IMPORTANT: Karbon API does NOT have a list endpoint for Notes.
 * GET /v3/Notes/{NoteID} fetches a single note by ID.
 * There is no GET /v3/Notes (list all).
 * 
 * Strategy:
 * - If noteKey param is provided: fetch single note from Karbon by key
 * - If source=supabase: return cached notes from Supabase (primary usage)
 * - Notes are populated via webhooks (Note webhook type) or created via POST
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const noteKey = searchParams.get("noteKey")
    const fromSupabase = searchParams.get("source") === "supabase"
    const workItemKey = searchParams.get("workItemKey")
    const contactKey = searchParams.get("contactKey")
    const importToSupabase = searchParams.get("import") === "true"
    const top = searchParams.get("top")

    // Return cached notes from Supabase
    if (fromSupabase || (!noteKey && !importToSupabase)) {
      const supabase = getSupabaseClient()
      if (!supabase) {
        return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })
      }

      let query = supabase.from("karbon_notes").select("*").order("karbon_created_at", { ascending: false })

      if (workItemKey) query = query.eq("karbon_work_item_key", workItemKey)
      if (contactKey) query = query.eq("karbon_contact_key", contactKey)
      if (top) query = query.limit(Number.parseInt(top, 10))

      const { data, error } = await query

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({
        notes: data || [],
        count: data?.length || 0,
        source: "supabase",
        notice: "Karbon API does not support listing notes. Notes are synced via webhooks and individual fetches.",
      })
    }

    // Fetch a single note by key from Karbon
    if (noteKey) {
      const credentials = getKarbonCredentials()
      if (!credentials) {
        return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
      }

      const { data: note, error } = await karbonFetch<any>(`/Notes/${noteKey}`, credentials)

      if (error) {
        return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
      }

      // Optionally save to Supabase
      if (importToSupabase && note) {
        const supabase = getSupabaseClient()
        if (supabase) {
          await supabase.from("karbon_notes").upsert(
            {
              ...mapKarbonNoteToSupabase(note),
              created_at: new Date().toISOString(),
            },
            { onConflict: "karbon_note_key", ignoreDuplicates: false }
          )
        }
      }

      return NextResponse.json({
        note: note ? {
          NoteKey: note.NoteKey,
          Subject: note.Subject,
          Body: note.Body,
          NoteType: note.NoteType,
          AuthorKey: note.AuthorKey,
          AuthorEmailAddress: note.AuthorEmailAddress,
          AssigneeEmailAddress: note.AssigneeEmailAddress,
          DueDate: note.DueDate,
          TodoDate: note.TodoDate,
          Timelines: note.Timelines,
          Comments: note.Comments,
          CreatedDate: note.CreatedDate,
        } : null,
        source: "karbon",
      })
    }

    // If import=true with no noteKey, explain limitation
    return NextResponse.json({
      notes: [],
      count: 0,
      source: "karbon",
      notice: "Karbon API does not support listing all notes. Use noteKey param to fetch individual notes, or rely on webhook-synced notes from Supabase (source=supabase).",
      importResult: { success: true, synced: 0, errors: 0, notice: "No list endpoint available" },
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
