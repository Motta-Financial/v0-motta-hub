/**
 * Build a downloadable Markdown document from a parsed Zoom transcript.
 *
 * Consumed by GET /api/zoom/meetings/[zoomMeetingId]/transcript — the
 * "Download .md" button in the Recordings library. Consecutive cues from
 * the same speaker are merged into one block so the file reads like a
 * conversation rather than a caption dump.
 */

import type { TranscriptSegment } from "./parse-vtt"

export interface TranscriptMarkdownMeta {
  topic?: string | null
  startTime?: string | null
  timezone?: string | null
  durationMinutes?: number | null
  hostName?: string | null
  hostEmail?: string | null
  /** Display names of clients tagged to the meeting. */
  clients?: string[]
  /** Participant display names (deduped by the caller). */
  participants?: string[]
}

function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(sec).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Merge consecutive segments spoken by the same person into one block. */
function groupBySpeaker(
  segments: TranscriptSegment[],
): Array<{ speaker: string | null; start: number; text: string }> {
  const blocks: Array<{ speaker: string | null; start: number; parts: string[] }> = []
  for (const seg of segments) {
    const text = (seg.text || "").trim()
    if (!text) continue
    const last = blocks[blocks.length - 1]
    if (last && last.speaker === (seg.speaker ?? null)) {
      last.parts.push(text)
    } else {
      blocks.push({ speaker: seg.speaker ?? null, start: seg.start, parts: [text] })
    }
  }
  return blocks.map((b) => ({ speaker: b.speaker, start: b.start, text: b.parts.join(" ") }))
}

/**
 * Render the transcript as Markdown. Falls back to the flat text when no
 * structured segments exist (older rows parsed before segments landed).
 */
export function buildTranscriptMarkdown(args: {
  meta: TranscriptMarkdownMeta
  segments: TranscriptSegment[] | null
  textContent: string | null
}): string {
  const { meta, segments, textContent } = args
  const lines: string[] = []

  lines.push(`# ${meta.topic?.trim() || "Zoom meeting transcript"}`)
  lines.push("")

  const metaRows: string[] = []
  if (meta.startTime) {
    const when = new Date(meta.startTime)
    if (!Number.isNaN(when.getTime())) {
      metaRows.push(
        `**Date:** ${when.toLocaleString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: meta.timezone || undefined,
        })}${meta.timezone ? ` (${meta.timezone})` : ""}`,
      )
    }
  }
  if (meta.durationMinutes) metaRows.push(`**Duration:** ${meta.durationMinutes} min`)
  if (meta.hostName || meta.hostEmail) {
    metaRows.push(
      `**Host:** ${meta.hostName || ""}${meta.hostName && meta.hostEmail ? " " : ""}${
        meta.hostEmail ? `<${meta.hostEmail}>` : ""
      }`.trim(),
    )
  }
  if (meta.clients && meta.clients.length > 0) {
    metaRows.push(`**Clients:** ${meta.clients.join(", ")}`)
  }
  if (meta.participants && meta.participants.length > 0) {
    metaRows.push(`**Participants:** ${meta.participants.join(", ")}`)
  }
  if (metaRows.length > 0) {
    lines.push(...metaRows)
    lines.push("")
  }

  lines.push("---")
  lines.push("")
  lines.push("## Transcript")
  lines.push("")

  if (segments && segments.length > 0) {
    for (const block of groupBySpeaker(segments)) {
      const stamp = `[${formatTimecode(block.start)}]`
      if (block.speaker) {
        lines.push(`**${block.speaker}** ${stamp}:`)
      } else {
        lines.push(`${stamp}:`)
      }
      lines.push(block.text)
      lines.push("")
    }
  } else if (textContent?.trim()) {
    lines.push(textContent.trim())
    lines.push("")
  } else {
    lines.push("_No transcript content available._")
    lines.push("")
  }

  return lines.join("\n")
}

/** Safe filename for the downloaded markdown file. */
export function transcriptFilename(topic: string | null | undefined, startTime: string | null | undefined): string {
  const datePart = startTime ? new Date(startTime).toISOString().slice(0, 10) : "undated"
  const topicPart = (topic || "zoom-meeting")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "zoom-meeting"
  return `${datePart}-${topicPart}-transcript.md`
}
