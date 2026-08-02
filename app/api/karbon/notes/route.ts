import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { mapKarbonNoteToSupabase } from "@/lib/karbon/mappers/note"

function getSupabaseClient() {
  return tryCreateAdminClient()
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
      // Always apply a limit to prevent unbounded queries
      query = query.limit(top ? Number.parseInt(top, 10) : 200)

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
          NoteKey: note.Id || note.NoteKey, // GET /Notes/{key} returns the key as "Id"
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
