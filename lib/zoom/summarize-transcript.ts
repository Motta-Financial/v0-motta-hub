/**
 * ALFRED meeting-transcript summarization.
 *
 * Turns an imported Zoom transcript (zoom_transcripts.text_content) into a
 * structured summary and writes it to the client's profile notes
 * (note_type='meeting_summary'). Driven by the meeting-summary-ingest cron,
 * with a manual "regenerate" path exposed in the UI.
 *
 * Flow per transcript:
 *   1. Guard: must have text_content and be in a summarizable status.
 *   2. Resolve the client (contact_id) via zoom_meeting_clients — the same
 *      auto/bridge/alfred link table the rest of the Hub uses. If no contact
 *      is linked yet, mark 'skipped' (the linkage layers run separately; we
 *      don't fabricate a contact — same rule as the triage code).
 *   3. generateObject over the transcript with a strict schema.
 *   4. Render a markdown note + upsert it into `notes`, linked to the
 *      contact. Re-runs update the SAME note (summary_note_id) instead of
 *      piling up duplicates.
 *   5. Stamp the transcript (summary_status='done', summary_note_id,
 *      summarized_at).
 *
 * This never throws to its caller — every transcript ends in a terminal
 * status ('done' | 'skipped' | 'failed') so the cron can make forward
 * progress and a single bad transcript can't wedge the batch.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { generateObject } from "ai"
import { z } from "zod"
import { getAIConfig, logAIUsage } from "@/lib/ai/config"

const MAX_TRANSCRIPT_CHARS = 120_000 // ~30k tokens; Sonnet handles this easily
const MAX_ATTEMPTS = 3

const summarySchema = z.object({
  overview: z
    .string()
    .describe("2-4 sentence plain-English summary of what the meeting covered."),
  keyPoints: z
    .array(z.string())
    .describe("The most important discussion points, decisions, and facts. 3-8 bullets."),
  actionItems: z
    .array(
      z.object({
        owner: z
          .string()
          .describe("Who owns it: 'Motta', 'Client', or a named person if clear."),
        item: z.string().describe("The concrete action to take."),
      }),
    )
    .describe("Follow-up tasks agreed in the meeting. Empty array if none."),
  followUpDate: z
    .string()
    .nullable()
    .describe("Any explicit follow-up / next-meeting date mentioned (ISO date) or null."),
  topics: z
    .array(z.string())
    .describe("Short topic tags, e.g. ['tax planning','S-corp election']. Max 6."),
  sentiment: z
    .enum(["positive", "neutral", "concerned", "at_risk"])
    .describe("Overall client sentiment inferred from the conversation."),
})

export type MeetingSummary = z.infer<typeof summarySchema>

export interface SummarizeResult {
  status: "done" | "skipped" | "skipped_no_client" | "failed"
  reason?: string
  noteId?: string
  contactId?: string
}

interface TranscriptRow {
  id: string
  zoom_meeting_id: number | string | null
  text_content: string | null
  summary_status: string
  summary_note_id: string | null
  summary_attempts: number
}

/**
 * Resolve the best client contact for a transcript's meeting.
 * Prefers the highest-confidence, non-needs_review link.
 */
async function resolveContactId(
  admin: SupabaseClient,
  zoomNumericId: number | string,
): Promise<{ contactId: string | null; meetingTopic: string | null; startTime: string | null }> {
  // Internal zoom_meetings PK + topic for context. NOTE: zoom_meeting_clients
  // keys on the INTERNAL zoom_meetings.id (uuid), not the numeric Zoom id —
  // so we resolve the uuid here first and link tags off that.
  const { data: zm } = await admin
    .from("zoom_meetings")
    .select("id, topic, start_time")
    .eq("zoom_meeting_id", zoomNumericId)
    .maybeSingle()

  if (!zm?.id) {
    return { contactId: null, meetingTopic: null, startTime: null }
  }

  const { data: links } = await admin
    .from("zoom_meeting_clients")
    .select("contact_id, confidence, needs_review, link_source")
    .eq("zoom_meeting_id", zm.id)
    .not("contact_id", "is", null)

  if (!links || links.length === 0) {
    return { contactId: null, meetingTopic: zm?.topic ?? null, startTime: zm?.start_time ?? null }
  }

  // Prefer confirmed links (not needs_review), then highest confidence.
  const sorted = [...links].sort((a, b) => {
    if (!!a.needs_review !== !!b.needs_review) return a.needs_review ? 1 : -1
    return (b.confidence ?? 0) - (a.confidence ?? 0)
  })

  return {
    contactId: sorted[0]?.contact_id ?? null,
    meetingTopic: zm?.topic ?? null,
    startTime: zm?.start_time ?? null,
  }
}

/** Render the structured summary as a markdown note body. */
function renderNote(summary: MeetingSummary, meetingTopic: string | null, startTime: string | null): string {
  const dateStr = startTime ? new Date(startTime).toLocaleDateString("en-US", { dateStyle: "medium" }) : null
  const lines: string[] = []
  lines.push(summary.overview)
  lines.push("")
  if (summary.keyPoints.length > 0) {
    lines.push("**Key points**")
    for (const p of summary.keyPoints) lines.push(`- ${p}`)
    lines.push("")
  }
  if (summary.actionItems.length > 0) {
    lines.push("**Action items**")
    for (const a of summary.actionItems) lines.push(`- ${a.owner ? `(${a.owner}) ` : ""}${a.item}`)
    lines.push("")
  }
  if (summary.followUpDate) {
    lines.push(`**Follow-up:** ${summary.followUpDate}`)
    lines.push("")
  }
  const footerBits: string[] = []
  footerBits.push(`Sentiment: ${summary.sentiment}`)
  if (dateStr) footerBits.push(`Meeting: ${dateStr}`)
  footerBits.push("Generated by ALFRED from the Zoom transcript")
  lines.push(`_${footerBits.join(" · ")}_`)
  return lines.join("\n").trim()
}

/**
 * Summarize a single transcript and write the result to client notes.
 * Always returns a terminal status; never throws.
 */
export async function summarizeTranscript(
  admin: SupabaseClient,
  transcript: TranscriptRow,
): Promise<SummarizeResult> {
  // Mark processing so concurrent crons don't double-pick it.
  await admin
    .from("zoom_transcripts")
    .update({ summary_status: "processing", summary_attempts: (transcript.summary_attempts ?? 0) + 1 })
    .eq("id", transcript.id)

  try {
    const text = (transcript.text_content ?? "").trim()
    if (!text) {
      await markTerminal(admin, transcript.id, "skipped")
      return { status: "skipped", reason: "empty transcript" }
    }
    if (transcript.zoom_meeting_id == null) {
      await markTerminal(admin, transcript.id, "skipped")
      return { status: "skipped", reason: "transcript not linked to a zoom meeting" }
    }

    const { contactId, meetingTopic, startTime } = await resolveContactId(
      admin,
      transcript.zoom_meeting_id,
    )

    if (!contactId) {
      // No client linked yet — use a RECOVERABLE status. The linkage layers
      // (participant sweep / Calendly bridge / ALFRED triage) may attach a
      // client later; a DB trigger on zoom_meeting_clients then flips this
      // row back to 'pending' so the next cron run summarizes it. We do NOT
      // use plain 'skipped' (that's reserved for permanently un-summarizable
      // transcripts: empty text or no zoom meeting at all).
      await markTerminal(admin, transcript.id, "skipped_no_client")
      return { status: "skipped_no_client", reason: "no client linked to meeting" }
    }

    const config = await getAIConfig("meeting_summary")
    if (!config.isActive) {
      await markTerminal(admin, transcript.id, "skipped")
      return { status: "skipped", reason: "meeting_summary use case disabled" }
    }

    const clipped = text.length > MAX_TRANSCRIPT_CHARS ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text

    const system =
      config.systemPrompt ??
      [
        "You are ALFRED, the assistant for a CPA / tax advisory firm.",
        "Summarize the following client meeting transcript for the firm's internal client record.",
        "Be precise and factual. Do NOT invent action items or dates that weren't discussed.",
        "Write in a neutral professional tone. Money figures, deadlines, and entity names matter — capture them exactly.",
      ].join(" ")

    const started = Date.now()
    const { object, usage } = await generateObject({
      model: config.model,
      system,
      schema: summarySchema,
      prompt: `Meeting topic: ${meetingTopic ?? "(unknown)"}\n\nTranscript:\n\n${clipped}`,
      temperature: 0,
    })
    const latencyMs = Date.now() - started

    void logAIUsage({
      useCase: "meeting_summary",
      model: config.model,
      promptTokens: usage?.inputTokens,
      completionTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      latencyMs,
      success: true,
      metadata: { transcriptId: transcript.id, contactId },
    })

    const body = renderNote(object, meetingTopic, startTime)
    const title = `Meeting summary${
      startTime ? ` — ${new Date(startTime).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""
    }`

    // Upsert the note: update the existing one on a re-run, else insert.
    let noteId = transcript.summary_note_id
    if (noteId) {
      const { error } = await admin
        .from("notes")
        .update({
          title,
          content: body,
          content_type: "markdown",
          note_type: "meeting_summary",
          tags: object.topics?.slice(0, 6) ?? [],
          updated_at: new Date().toISOString(),
        })
        .eq("id", noteId)
      if (error) throw new Error(`notes update: ${error.message}`)
    } else {
      const { data, error } = await admin
        .from("notes")
        .insert({
          contact_id: contactId,
          title,
          content: body,
          content_type: "markdown",
          note_type: "meeting_summary",
          is_pinned: false,
          tags: object.topics?.slice(0, 6) ?? [],
        })
        .select("id")
        .single()
      if (error) throw new Error(`notes insert: ${error.message}`)
      noteId = data.id
    }

    await admin
      .from("zoom_transcripts")
      .update({
        summary_status: "done",
        summary_note_id: noteId,
        summarized_at: new Date().toISOString(),
      })
      .eq("id", transcript.id)

    return { status: "done", noteId: noteId ?? undefined, contactId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    void logAIUsage({
      useCase: "meeting_summary",
      model: "unknown",
      success: false,
      errorMessage: message,
      metadata: { transcriptId: transcript.id },
    })
    // Exhausted attempts -> failed (terminal). Otherwise back to pending for retry.
    const attempts = (transcript.summary_attempts ?? 0) + 1
    await admin
      .from("zoom_transcripts")
      .update({ summary_status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" })
      .eq("id", transcript.id)
    return { status: "failed", reason: message }
  }
}

async function markTerminal(
  admin: SupabaseClient,
  id: string,
  status: "skipped" | "skipped_no_client" | "done",
) {
  await admin.from("zoom_transcripts").update({ summary_status: status }).eq("id", id)
}

/**
 * Batch entry point for the cron: find pending transcripts that have text
 * and summarize up to `limit` of them.
 */
export async function summarizePendingTranscripts(
  admin: SupabaseClient,
  limit = 10,
): Promise<{
  processed: number
  done: number
  skipped: number
  skippedNoClient: number
  failed: number
}> {
  const { data: rows, error } = await admin
    .from("zoom_transcripts")
    .select("id, zoom_meeting_id, text_content, summary_status, summary_note_id, summary_attempts")
    .eq("summary_status", "pending")
    .not("text_content", "is", null)
    .lt("summary_attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error(`fetch pending transcripts: ${error.message}`)

  let done = 0
  let skipped = 0
  let skippedNoClient = 0
  let failed = 0
  for (const row of rows ?? []) {
    const result = await summarizeTranscript(admin, row as TranscriptRow)
    if (result.status === "done") done++
    else if (result.status === "skipped") skipped++
    else if (result.status === "skipped_no_client") skippedNoClient++
    else failed++
  }

  return { processed: rows?.length ?? 0, done, skipped, skippedNoClient, failed }
}
