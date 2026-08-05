"use client"

/**
 * <RecordingsLibrary>
 * ────────────────────────────────────────────────────────────────────────
 * A browse-and-watch library of Zoom cloud recordings for ANY signed-in
 * teammate (not just admins). Rendered as the DEFAULT tab of the Zoom
 * dashboard (/meetings/zoom) — every firm meeting is recorded, so this is
 * the page's centerpiece.
 *
 * Each card plays the recording IN the Hub via the authenticated stream proxy
 * (/api/zoom/recordings/stream — Blob copy when archived, otherwise the Zoom
 * download_url proxied with the account S2S token; the token never reaches the
 * browser). Recordings are read from the DB-backed /api/zoom/recordings/library
 * endpoint; the expanded card lazy-loads transcript + participants + Zoom AI
 * summary from the per-meeting endpoint.
 *
 * Interactivity:
 *   • filters — host, date range, transcript-only (server-side)
 *   • click-to-seek transcript synced to the in-Hub player
 *   • transcript download as Markdown (/transcript?format=md)
 *   • participants with Hub-contact links, AI Companion summary
 *   • tagging delegated back to the parent's shared dialog via `onTag`
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Play,
  Search,
  Sparkles,
  Tag,
  Users,
  Video,
  X,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface RecordingFile {
  id?: string
  file_type?: string
  file_extension?: string
  recording_type?: string
  file_size?: number
  blob_pathname?: string | null
  playable?: boolean
}

interface LibraryRecording {
  id: string
  zoom_uuid: string | null
  zoom_meeting_id: number | null
  topic: string | null
  start_time: string | null
  duration: number | null
  total_size: number | null
  recording_count: number | null
  timezone?: string | null
  host?: { team_member_id: string | null; name: string | null; email: string | null }
  recording_files: RecordingFile[]
  clients: string[]
  has_transcript: boolean
  has_summary?: boolean
  participants_count?: number | null
}

interface TranscriptSegment {
  start: number
  end: number
  speaker: string | null
  text: string
}

interface TranscriptData {
  id: string
  status: string
  text_content: string | null
  segments: TranscriptSegment[] | null
}

interface MeetingParticipant {
  name: string | null
  email: string | null
  duration: number | null
  internal_user: boolean | null
  contact_id: string | null
  contact_name: string | null
}

interface MeetingSummary {
  summary_title: string | null
  summary_overview: string | null
  summary_details: Array<{ label?: string; summary?: string }> | null
  next_steps: string[] | null
}

/** Payload of the per-meeting detail endpoint, lazy-loaded on expand. */
interface MeetingDetail {
  transcript: TranscriptData | null
  participants: MeetingParticipant[]
  summary: MeetingSummary | null
}

interface Props {
  /** Search string from the parent dashboard's shared search box. */
  searchQuery?: string
  /** Tag counts keyed on the bigint Zoom meeting id (as string). */
  tagCounts?: Record<string, { clients: number; workItems: number; deals: number; projects: number }>
  /** Open the shared tag dialog for a recording. */
  onTag?: (recording: LibraryRecording) => void
  /** Bump to force a refetch (e.g. after an account-wide sync). */
  refreshKey?: number
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

function formatDateTime(value: string | null): string {
  if (!value) return ""
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

/** Pick the best playable file from a recording (prefer video, then audio). */
function pickPlayable(rec: LibraryRecording): { file: RecordingFile; kind: "video" | "audio" } | null {
  const files = rec.recording_files || []
  const video = files.find((f) => (f.file_type || "").toUpperCase() === "MP4" && f.playable && f.id)
  if (video) return { file: video, kind: "video" }
  const audio = files.find((f) => (f.file_type || "").toUpperCase() === "M4A" && f.playable && f.id)
  if (audio) return { file: audio, kind: "audio" }
  return null
}

const PAGE_SIZE = 30

export function RecordingsLibrary({ searchQuery = "", tagCounts = {}, onTag, refreshKey = 0 }: Props) {
  const [recordings, setRecordings] = useState<LibraryRecording[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [localQuery, setLocalQuery] = useState("")

  // Filters — all applied server-side by the library endpoint.
  const [hosts, setHosts] = useState<Array<{ id: string; name: string }>>([])
  const [hostId, setHostId] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>("")
  const [toDate, setToDate] = useState<string>("")
  const [transcriptOnly, setTranscriptOnly] = useState(false)

  // Debounce the search box (and honor the parent's shared search box too).
  const [debouncedLocal, setDebouncedLocal] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedLocal(localQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [localQuery])

  const effectiveQuery = (searchQuery || debouncedLocal).trim()

  const load = useCallback(
    async (opts: { append: boolean; offset: number }) => {
      if (opts.append) setLoadingMore(true)
      else setLoading(true)
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(opts.offset),
        })
        if (effectiveQuery) params.set("q", effectiveQuery)
        if (hostId) params.set("hostId", hostId)
        if (fromDate) params.set("from", fromDate)
        if (toDate) params.set("to", toDate)
        if (transcriptOnly) params.set("hasTranscript", "true")
        if (!opts.append) params.set("include", "hosts")
        const res = await fetch(`/api/zoom/recordings/library?${params.toString()}`)
        const json = res.ok ? await res.json() : { recordings: [], total: 0 }
        setTotal(json.total ?? 0)
        if (Array.isArray(json.hosts) && json.hosts.length > 0) setHosts(json.hosts)
        setRecordings((prev) =>
          opts.append ? [...prev, ...(json.recordings ?? [])] : json.recordings ?? [],
        )
      } catch {
        if (!opts.append) setRecordings([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [effectiveQuery, hostId, fromDate, toDate, transcriptOnly],
  )

  useEffect(() => {
    load({ append: false, offset: 0 })
  }, [load, refreshKey])

  const hasActiveFilters = !!(hostId || fromDate || toDate || transcriptOnly)

  return (
    <div className="space-y-4">
      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {!searchQuery && (
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              placeholder="Search recordings by topic..."
              className="pl-9"
            />
          </div>
        )}
        <Select value={hostId || "all"} onValueChange={(v) => setHostId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All hosts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All hosts</SelectItem>
            {hosts.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-36"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-36"
            aria-label="To date"
          />
        </div>
        <Button
          variant={transcriptOnly ? "secondary" : "outline"}
          size="sm"
          onClick={() => setTranscriptOnly((v) => !v)}
        >
          <FileText className="h-4 w-4 mr-1.5" />
          Transcript only
        </Button>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setHostId("")
              setFromDate("")
              setToDate("")
              setTranscriptOnly(false)
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : recordings.length === 0 ? (
        <Card className="p-8 text-center">
          <Video className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">
            {effectiveQuery || hasActiveFilters
              ? "No recordings match your search or filters."
              : "No recordings found."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {recordings.map((rec) => (
            <RecordingCard
              key={rec.id}
              rec={rec}
              tagged={isTagged(rec, tagCounts)}
              onTag={onTag}
            />
          ))}
        </div>
      )}

      {!loading && recordings.length < total && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => load({ append: true, offset: recordings.length })}
            disabled={loadingMore}
          >
            {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load more ({total - recordings.length} more)
          </Button>
        </div>
      )}
    </div>
  )
}

function isTagged(
  rec: LibraryRecording,
  tagCounts: Props["tagCounts"],
): boolean {
  if (rec.zoom_meeting_id == null || !tagCounts) return false
  const c = tagCounts[String(rec.zoom_meeting_id)]
  if (!c) return false
  return c.clients > 0 || c.workItems > 0 || c.deals > 0 || c.projects > 0
}

function RecordingCard({
  rec,
  tagged,
  onTag,
}: {
  rec: LibraryRecording
  tagged: boolean
  onTag?: (recording: LibraryRecording) => void
}) {
  const [playing, setPlaying] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [detail, setDetail] = useState<MeetingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  const pendingSeekRef = useRef<number | null>(null)

  const playable = pickPlayable(rec)
  const streamSrc = playable
    ? `/api/zoom/recordings/stream?recordingId=${encodeURIComponent(
        rec.id,
      )}&fileId=${encodeURIComponent(String(playable.file.id))}`
    : null

  const downloadFiles = (rec.recording_files || []).filter((f) => {
    const t = (f.file_type || "").toUpperCase()
    return (t === "MP4" || t === "M4A") && f.blob_pathname
  })

  // Lazy-load transcript + participants + AI summary in ONE round trip the
  // first time any expandable section opens.
  const loadDetail = useCallback(async () => {
    if (detail || detailLoading || rec.zoom_meeting_id == null) return
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/zoom/meetings/${rec.zoom_meeting_id}/recordings`)
      const json = res.ok ? await res.json() : null
      setDetail({
        transcript: json?.transcript ?? null,
        participants: Array.isArray(json?.participants) ? json.participants : [],
        summary: json?.summary ?? null,
      })
    } catch {
      setDetail({ transcript: null, participants: [], summary: null })
    } finally {
      setDetailLoading(false)
    }
  }, [detail, detailLoading, rec.zoom_meeting_id])

  function handleLoadedMetadata() {
    if (pendingSeekRef.current != null && mediaRef.current) {
      mediaRef.current.currentTime = pendingSeekRef.current
      void mediaRef.current.play().catch(() => {})
      pendingSeekRef.current = null
    }
  }

  function seekTo(seconds: number) {
    if (!playing) {
      pendingSeekRef.current = seconds
      setPlaying(true)
      return
    }
    const el = mediaRef.current
    if (el && Number.isFinite(el.duration)) {
      el.currentTime = seconds
      void el.play().catch(() => {})
    } else {
      pendingSeekRef.current = seconds
    }
  }

  const transcript = detail?.transcript ?? null
  const segments = transcript?.segments ?? []
  const participants = detail?.participants ?? []
  const summary = detail?.summary ?? null

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-pretty">{rec.topic || "Cloud recording"}</h3>
            {tagged ? (
              <Badge variant="secondary" className="gap-1">
                <Tag className="h-3 w-3" />
                Tagged
              </Badge>
            ) : null}
            {rec.has_transcript ? (
              <Badge variant="outline" className="gap-1">
                <FileText className="h-3 w-3" />
                Transcript
              </Badge>
            ) : null}
            {rec.has_summary ? (
              <Badge variant="outline" className="gap-1">
                <Sparkles className="h-3 w-3" />
                AI Summary
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(rec.start_time)}
            {rec.duration ? ` · ${rec.duration} min` : ""}
            {rec.total_size ? ` · ${formatBytes(rec.total_size)}` : ""}
            {rec.host?.name || rec.host?.email ? ` · Host: ${rec.host.name || rec.host.email}` : ""}
            {rec.participants_count ? ` · ${rec.participants_count} participants` : ""}
          </p>
          {rec.clients.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              {rec.clients.slice(0, 4).map((name) => (
                <Badge key={name} variant="outline" className="text-xs font-normal">
                  {name}
                </Badge>
              ))}
              {rec.clients.length > 4 && (
                <span className="text-xs text-muted-foreground">+{rec.clients.length - 4}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {playable && (
            <Button
              size="sm"
              variant={playing ? "secondary" : "default"}
              className="gap-1.5"
              onClick={() => setPlaying((v) => !v)}
            >
              <Play className="h-3.5 w-3.5" />
              {playing ? "Hide player" : "Play in Hub"}
            </Button>
          )}
          {onTag && (
            <Button size="sm" variant="outline" className="gap-1.5 bg-transparent" onClick={() => onTag(rec)}>
              <Tag className="h-3.5 w-3.5" />
              {tagged ? "Edit tags" : "Tag"}
            </Button>
          )}
        </div>
      </div>

      {/* In-Hub player */}
      {playing && streamSrc && playable ? (
        <div className="mt-3">
          {playable.kind === "video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={mediaRef}
              src={streamSrc}
              controls
              playsInline
              autoPlay
              onLoadedMetadata={handleLoadedMetadata}
              className="w-full rounded-md bg-black"
            />
          ) : (
            <audio
              ref={mediaRef as unknown as React.RefObject<HTMLAudioElement>}
              src={streamSrc}
              controls
              autoPlay
              onLoadedMetadata={handleLoadedMetadata}
              className="w-full"
            />
          )}
        </div>
      ) : null}

      {!playable && (
        <p className="mt-2 text-xs text-muted-foreground">
          This recording isn&apos;t playable in the Hub yet (no media file available).
        </p>
      )}

      {/* Downloads: Blob-backed media + transcript-as-Markdown */}
      {(downloadFiles.length > 0 || rec.has_transcript) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {downloadFiles.map((f, i) =>
            f.blob_pathname ? (
              <a
                key={f.id || i}
                href={`/api/zoom/recordings/file?pathname=${encodeURIComponent(
                  f.blob_pathname,
                )}&download=1`}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/70"
              >
                <Download className="h-3 w-3" />
                {(f.file_type || "file").toUpperCase()} {formatBytes(f.file_size)}
              </a>
            ) : null,
          )}
          {rec.has_transcript && rec.zoom_meeting_id != null && (
            <a
              href={`/api/zoom/meetings/${rec.zoom_meeting_id}/transcript?format=md`}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/70"
              title="Download the transcript as a Markdown file"
            >
              <Download className="h-3 w-3" />
              Transcript (.md)
            </a>
          )}
        </div>
      )}

      {/* AI Companion summary (lazy) */}
      {rec.has_summary && (
        <div className="mt-3 rounded-lg border">
          <button
            type="button"
            onClick={() => {
              setShowSummary((v) => !v)
              void loadDetail()
            }}
            className="flex w-full items-center gap-2 p-3 text-sm font-medium"
          >
            {showSummary ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Sparkles className="h-4 w-4" />
            AI Summary
            {detailLoading && showSummary && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
          </button>
          {showSummary && summary && (
            <div className="space-y-3 border-t p-3 text-sm">
              {summary.summary_overview && (
                <p className="whitespace-pre-wrap">{summary.summary_overview}</p>
              )}
              {(summary.summary_details ?? [])
                .filter((d) => d?.summary?.trim())
                .map((d, i) => (
                  <div key={i}>
                    {d.label && <p className="font-medium">{d.label}</p>}
                    <p className="whitespace-pre-wrap text-muted-foreground">{d.summary}</p>
                  </div>
                ))}
              {(summary.next_steps ?? []).length > 0 && (
                <div>
                  <p className="font-medium">Next steps</p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {summary.next_steps!.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Generated by Zoom AI Companion</p>
            </div>
          )}
        </div>
      )}

      {/* Participants (lazy) */}
      <div className="mt-3 rounded-lg border">
        <button
          type="button"
          onClick={() => {
            setShowParticipants((v) => !v)
            void loadDetail()
          }}
          className="flex w-full items-center gap-2 p-3 text-sm font-medium"
        >
          {showParticipants ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Users className="h-4 w-4" />
          Participants
          {rec.participants_count ? (
            <span className="text-xs font-normal text-muted-foreground">
              ({rec.participants_count})
            </span>
          ) : null}
          {detailLoading && showParticipants && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
        </button>
        {showParticipants && detail && (
          <div className="border-t p-3 text-sm">
            {participants.length === 0 ? (
              <p className="text-muted-foreground">
                No participant data synced yet for this meeting.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {participants.map((p, i) => {
                  const label = p.contact_name || p.name || p.email || "Unknown"
                  const mins = p.duration ? Math.round(p.duration / 60) : null
                  return p.contact_id ? (
                    <a
                      key={i}
                      href={`/clients/${p.contact_id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      title={p.email || undefined}
                    >
                      {label}
                      {mins ? <span className="text-muted-foreground">· {mins}m</span> : null}
                    </a>
                  ) : (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                        p.internal_user ? "text-muted-foreground" : ""
                      }`}
                      title={p.email || undefined}
                    >
                      {label}
                      {mins ? <span className="text-muted-foreground">· {mins}m</span> : null}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transcript (lazy) */}
      {rec.has_transcript && (
        <div className="mt-3 rounded-lg border">
          <button
            type="button"
            onClick={() => {
              setShowTranscript((v) => !v)
              void loadDetail()
            }}
            className="flex w-full items-center gap-2 p-3 text-sm font-medium"
          >
            {showTranscript ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <FileText className="h-4 w-4" />
            Transcript
            {detailLoading && showTranscript && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
          </button>
          {showTranscript && transcript && (
            <div className="max-h-80 space-y-2 overflow-y-auto border-t p-3 text-sm">
              {segments.length > 0 ? (
                segments.map((seg, i) =>
                  playable ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => seekTo(seg.start)}
                      className="flex w-full gap-3 rounded-md px-1 py-0.5 text-left hover:bg-muted/60"
                      title="Jump to this moment"
                    >
                      <span className="shrink-0 font-mono text-xs text-primary">
                        {formatTimecode(seg.start)}
                      </span>
                      <span className="min-w-0">
                        {seg.speaker && <span className="font-medium">{seg.speaker}: </span>}
                        {seg.text}
                      </span>
                    </button>
                  ) : (
                    <div key={i} className="flex gap-3">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {formatTimecode(seg.start)}
                      </span>
                      <p className="min-w-0">
                        {seg.speaker && <span className="font-medium">{seg.speaker}: </span>}
                        {seg.text}
                      </p>
                    </div>
                  ),
                )
              ) : (
                <p className="whitespace-pre-wrap text-muted-foreground">{transcript.text_content}</p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
