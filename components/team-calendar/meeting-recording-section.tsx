"use client"

/**
 * <MeetingRecordingSection>
 * ────────────────────────────────────────────────────────────────────────
 * Shown in the meeting detail dialog for Zoom meetings. Fetches the cloud
 * recordings + parsed transcript for the meeting and renders:
 *   • a "Play on Zoom" link (share_url) + per-file download via the Blob proxy
 *   • a collapsible transcript with speaker-attributed segments
 *
 * Transcript text comes straight from the DB (zoom_transcripts.text_content /
 * segments), so display never depends on Blob access. Media playback uses the
 * Zoom share URL; the Blob copy is the permanent fallback download.
 */

import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Download, FileText, Loader2, Play, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface TranscriptSegment {
  start: number
  end: number
  speaker: string | null
  text: string
}

interface TranscriptData {
  id: string
  file_type: string | null
  status: string
  text_content: string | null
  segments: TranscriptSegment[] | null
  blob_pathname: string | null
  parsed_at: string | null
  error: string | null
}

interface RecordingFile {
  id?: string
  file_type?: string
  file_extension?: string
  recording_type?: string
  file_size?: number
  blob_pathname?: string | null
}

interface Recording {
  id: string
  zoom_uuid: string | null
  topic: string | null
  start_time: string | null
  duration: number | null
  total_size: number | null
  recording_count: number | null
  share_url: string | null
  recording_files: RecordingFile[]
}

interface Props {
  zoomMeetingId: number | string
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return ""
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
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

export function MeetingRecordingSection({ zoomMeetingId }: Props) {
  const [loading, setLoading] = useState(true)
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [transcript, setTranscript] = useState<TranscriptData | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/zoom/meetings/${zoomMeetingId}/recordings`)
      .then((r) => (r.ok ? r.json() : { recordings: [], transcript: null }))
      .then((json) => {
        if (cancelled) return
        setRecordings(json.recordings ?? [])
        setTranscript(json.transcript ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setRecordings([])
          setTranscript(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [zoomMeetingId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading recording &amp; transcript…
      </div>
    )
  }

  const hasRecordings = recordings.length > 0
  const hasTranscript = !!transcript && transcript.status === "parsed" && !!transcript.text_content

  if (!hasRecordings && !transcript) {
    return null
  }

  const segments = transcript?.segments ?? []

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Video className="h-4 w-4" />
        Recording &amp; Transcript
      </h4>

      {/* Recordings */}
      {hasRecordings ? (
        <div className="space-y-2">
          {recordings.map((rec) => {
            const mediaFiles = (rec.recording_files || []).filter((f) => {
              const t = (f.file_type || "").toUpperCase()
              return t === "MP4" || t === "M4A"
            })
            return (
              <div key={rec.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{rec.topic || "Cloud recording"}</p>
                    <p className="text-xs text-muted-foreground">
                      {rec.duration ? `${rec.duration} min` : null}
                      {rec.total_size ? ` · ${formatBytes(rec.total_size)}` : null}
                    </p>
                  </div>
                  {rec.share_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5 bg-transparent"
                      onClick={() => window.open(rec.share_url || "", "_blank")}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Play on Zoom
                    </Button>
                  )}
                </div>
                {mediaFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {mediaFiles.map((f, i) =>
                      f.blob_pathname ? (
                        <a
                          key={f.id || i}
                          href={`/api/zoom/recordings/file?pathname=${encodeURIComponent(f.blob_pathname)}`}
                          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/70"
                        >
                          <Download className="h-3 w-3" />
                          {(f.file_type || "file").toUpperCase()} {formatBytes(f.file_size)}
                        </a>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Transcript */}
      {transcript ? (
        hasTranscript ? (
          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="flex w-full items-center gap-2 p-3 text-sm font-medium"
            >
              {showTranscript ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <FileText className="h-4 w-4" />
              Transcript
              {segments.length > 0 && (
                <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-xs">
                  {segments.length} segments
                </Badge>
              )}
            </button>
            {showTranscript && (
              <div className="max-h-80 space-y-2 overflow-y-auto border-t p-3 text-sm">
                {segments.length > 0 ? (
                  segments.map((seg, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {formatTimecode(seg.start)}
                      </span>
                      <p className="min-w-0">
                        {seg.speaker && <span className="font-medium">{seg.speaker}: </span>}
                        {seg.text}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {transcript.text_content}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            {transcript.status === "expired"
              ? "Transcript download link expired before it could be saved. Re-run the recordings backfill to recover it."
              : transcript.status === "failed"
                ? `Transcript could not be processed${transcript.error ? `: ${transcript.error}` : "."}`
                : "Transcript is still processing."}
          </div>
        )
      ) : null}
    </div>
  )
}
