import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll, karbonFetch } from "@/lib/karbon-api"

/**
 * GET /api/karbon/notes
 * Fetch notes from Karbon with optional filtering
 */
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
    })
  } catch (error) {
    console.error("[v0] Error fetching notes:", error)
    return NextResponse.json(
      { error: "Failed to fetch notes", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/karbon/notes
 * Create a new note
 */
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
