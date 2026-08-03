/**
 * Parse a Zoom WebVTT transcript into plain text + structured speaker segments.
 *
 * Zoom's transcript .vtt looks like:
 *
 *   WEBVTT
 *
 *   1
 *   00:00:03.120 --> 00:00:06.480
 *   John Doe: Thanks everyone for joining today.
 *
 *   2
 *   00:00:06.480 --> 00:00:09.000
 *   Jane Smith: Happy to be here.
 *
 * Closed-caption (CC) tracks use the same cue format but often omit the
 * "Speaker:" prefix. We parse defensively so both produce usable output.
 */

export interface TranscriptSegment {
  /** Cue start in seconds from meeting start. */
  start: number
  /** Cue end in seconds from meeting start. */
  end: number
  /** Speaker label if present (text before the first colon), else null. */
  speaker: string | null
  /** Spoken text for this cue. */
  text: string
}

export interface ParsedTranscript {
  segments: TranscriptSegment[]
  /** Human-readable transcript, one "Speaker: text" line per cue. */
  text: string
}

/** Convert a VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) to seconds. */
function timestampToSeconds(ts: string): number {
  const clean = ts.trim().replace(",", ".")
  const parts = clean.split(":")
  if (parts.length === 0) return 0
  let h = 0
  let m = 0
  let s = 0
  if (parts.length === 3) {
    h = Number.parseInt(parts[0], 10) || 0
    m = Number.parseInt(parts[1], 10) || 0
    s = Number.parseFloat(parts[2]) || 0
  } else if (parts.length === 2) {
    m = Number.parseInt(parts[0], 10) || 0
    s = Number.parseFloat(parts[1]) || 0
  } else {
    s = Number.parseFloat(parts[0]) || 0
  }
  return h * 3600 + m * 60 + s
}

const TIMING_RE = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/

/**
 * Parse raw VTT text into segments + a flattened transcript string.
 * Returns empty results (never throws) for malformed input.
 */
export function parseVtt(vtt: string): ParsedTranscript {
  const segments: TranscriptSegment[] = []
  if (!vtt || typeof vtt !== "string") return { segments, text: "" }

  // Split into cue blocks on blank lines. Normalize CRLF first.
  const blocks = vtt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n{2,}/)

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    if (lines[0].toUpperCase().startsWith("WEBVTT")) continue

    // Find the timing line within the block (cue id line is optional).
    const timingLineIdx = lines.findIndex((l) => TIMING_RE.test(l))
    if (timingLineIdx === -1) continue

    const match = lines[timingLineIdx].match(TIMING_RE)
    if (!match) continue

    const start = timestampToSeconds(match[1])
    const end = timestampToSeconds(match[2])

    // Everything after the timing line is the spoken text (may be multi-line).
    const textLines = lines.slice(timingLineIdx + 1)
    if (textLines.length === 0) continue
    const rawText = textLines.join(" ").trim()
    if (!rawText) continue

    // Split "Speaker: text" — only on the FIRST colon, and only when the
    // prefix looks like a name (short, no sentence punctuation).
    let speaker: string | null = null
    let text = rawText
    const colonIdx = rawText.indexOf(":")
    if (colonIdx > 0 && colonIdx <= 60) {
      const maybeSpeaker = rawText.slice(0, colonIdx).trim()
      if (maybeSpeaker && !/[.?!]/.test(maybeSpeaker)) {
        speaker = maybeSpeaker
        text = rawText.slice(colonIdx + 1).trim()
      }
    }

    segments.push({ start, end, speaker, text })
  }

  const text = segments
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join("\n")

  return { segments, text }
}
