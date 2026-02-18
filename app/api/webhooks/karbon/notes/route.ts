/**
 * Karbon Note Webhook Handler
 * Receives webhook events from Karbon when notes are created/updated.
 * 
 * This is the PRIMARY way to sync notes since the Karbon API does NOT have
 * a list endpoint for Notes (only GET /Notes/{NoteID}).
 * Notes can only be discovered through webhook events.
 */
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  verifyKarbonWebhookSignature,
  parseKarbonWebhookPayload,
  logWebhookEvent,
} from "@/lib/karbon-webhook"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const body = await request.text()
    const signature = request.headers.get("x-karbon-signature") || request.headers.get("x-webhook-signature")

    logWebhookEvent("Note", "received", {
      hasSignature: !!signature,
      bodyLength: body.length,
    })

    if (!verifyKarbonWebhookSignature(body, signature)) {
      logWebhookEvent("Note", "failed", { reason: "Invalid signature" })
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
    }

    const payload = parseKarbonWebhookPayload(body)
    if (!payload) {
      logWebhookEvent("Note", "failed", { reason: "Invalid payload" })
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 })
    }

    const { EventType, Data } = payload
    const noteKey = Data.NoteKey

    if (!noteKey) {
      logWebhookEvent("Note", "failed", { reason: "Missing NoteKey", eventType: EventType })
      return NextResponse.json({ error: "Missing NoteKey in webhook data" }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 })
    }

    const credentials = getKarbonCredentials()
    if (!credentials) {
      return NextResponse.json({ error: "Karbon API not configured" }, { status: 500 })
    }

    // Fetch the full note from Karbon API by ID
    // This is the only way to get note details - GET /v3/Notes/{NoteID}
    const { data: note, error: fetchError } = await karbonFetch<any>(`/Notes/${noteKey}`, credentials)

    if (fetchError || !note) {
      logWebhookEvent("Note", "failed", {
        reason: "Failed to fetch note from Karbon",
        error: fetchError,
      })
      return NextResponse.json({ error: "Failed to fetch note details" }, { status: 500 })
    }

    // Map the note to our karbon_notes table
    // Mirrors the full mapper in /api/karbon/notes/route.ts so that
    // webhook-synced rows are identical to cron-synced rows.
    const mappedNote = {
      karbon_note_key: note.NoteKey || noteKey,
      subject: note.Subject || null,
      body: note.Body || null,
      note_type: note.NoteType || null,
      is_pinned: note.IsPinned || false,
      author_key: note.AuthorKey || null,
      author_name: note.AuthorName || note.AuthorEmailAddress || null,
      assignee_email: note.AssigneeEmailAddress || null,
      due_date: note.DueDate ? note.DueDate.split("T")[0] : null,
      todo_date: note.TodoDate ? note.TodoDate.split("T")[0] : null,
      timelines: note.Timelines || null,
      comments: note.Comments || null,
      karbon_work_item_key: note.WorkItemKey || Data.WorkItemKey || null,
      work_item_title: note.WorkItemTitle || null,
      karbon_contact_key: note.ContactKey || Data.ContactKey || null,
      contact_name: note.ContactName || null,
      karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/notes/${noteKey}`,
      karbon_created_at: note.CreatedDate || new Date().toISOString(),
      karbon_modified_at: note.LastModifiedDateTime || new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { error: upsertError } = await supabase.from("karbon_notes").upsert(
      {
        ...mappedNote,
        created_at: new Date().toISOString(),
      },
      {
        onConflict: "karbon_note_key",
        ignoreDuplicates: false,
      }
    )

    if (upsertError) {
      logWebhookEvent("Note", "failed", {
        reason: "Database upsert failed",
        error: upsertError.message,
      })
      return NextResponse.json({ error: "Failed to sync note" }, { status: 500 })
    }

    // Also link to work_item if applicable
    if (mappedNote.karbon_work_item_key) {
      const { data: workItem } = await supabase
        .from("work_items")
        .select("id")
        .eq("karbon_work_item_key", mappedNote.karbon_work_item_key)
        .maybeSingle()

      if (workItem?.id) {
        await supabase
          .from("karbon_notes")
          .update({ work_item_id: workItem.id })
          .eq("karbon_note_key", noteKey)
      }
    }

    logWebhookEvent("Note", "processed", {
      eventType: EventType,
      noteKey,
      action: "upserted",
      hasWorkItem: !!mappedNote.karbon_work_item_key,
      hasContact: !!mappedNote.karbon_contact_key,
      durationMs: Date.now() - startTime,
    })

    return NextResponse.json({
      success: true,
      eventType: EventType,
      noteKey,
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    })
  } catch (error) {
    logWebhookEvent("Note", "failed", {
      reason: "Unexpected error",
      error: error instanceof Error ? error.message : "Unknown error",
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: "active",
    webhook: "karbon-notes",
    description: "Primary sync mechanism for Karbon notes (no list API available)",
    timestamp: new Date().toISOString(),
  })
}
