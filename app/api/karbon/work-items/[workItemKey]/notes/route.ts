import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll, karbonFetch } from "@/lib/karbon-api"

/**
 * GET /api/karbon/work-items/[workItemKey]/notes
 * Fetch all notes for a specific work item
 */
export async function GET(request: NextRequest, { params }: { params: { workItemKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { workItemKey } = params

    const { data: notes, error } = await karbonFetchAll<any>(`/WorkItems/${workItemKey}/Notes`, credentials, {
      orderby: "CreatedDate desc",
    })

    if (error) {
      return NextResponse.json({ error: `Failed to fetch work item notes: ${error}` }, { status: 500 })
    }

    const mappedNotes = notes.map((note: any) => ({
      NoteKey: note.NoteKey,
      WorkItemNoteKey: note.WorkItemNoteKey,
      Subject: note.Subject,
      Body: note.Body,
      NoteType: note.NoteType,
      Author: note.AuthorName
        ? {
            FullName: note.AuthorName,
            UserKey: note.AuthorKey,
          }
        : null,
      CreatedDate: note.CreatedDate,
      ModifiedDate: note.LastModifiedDateTime,
      IsPinned: note.IsPinned,
    }))

    return NextResponse.json({
      notes: mappedNotes,
      count: mappedNotes.length,
      workItemKey,
    })
  } catch (error) {
    console.error("[v0] Error fetching work item notes:", error)
    return NextResponse.json(
      { error: "Failed to fetch work item notes", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/karbon/work-items/[workItemKey]/notes
 * Add a note to a work item
 */
export async function POST(request: NextRequest, { params }: { params: { workItemKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { workItemKey } = params
    const body = await request.json()

    const { data, error } = await karbonFetch<any>(`/WorkItems/${workItemKey}/Notes`, credentials, {
      method: "POST",
      body,
    })

    if (error) {
      return NextResponse.json({ error: `Failed to create work item note: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, note: data })
  } catch (error) {
    console.error("[v0] Error creating work item note:", error)
    return NextResponse.json(
      { error: "Failed to create work item note", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
