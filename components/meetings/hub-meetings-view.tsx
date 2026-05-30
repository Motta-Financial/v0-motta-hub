"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import {
  Calendar,
  Video,
  MessageSquare,
  FileText,
  Sparkles,
  UserPlus,
  Search,
  RefreshCw,
  Link2,
  ChevronDown,
  ExternalLink,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/** One row of the hub_meetings_enriched view. */
interface HubMeeting {
  meeting_id: string
  title: string | null
  meeting_type: string | null
  status: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  location_type: string | null
  video_link: string | null
  contact_id: string | null
  client_name: string | null
  client_is_prospect: boolean | null
  organization_name: string | null
  host_name: string | null
  calendly_uuid: string | null
  calendly_name: string | null
  has_calendly: boolean
  zoom_numeric_id: number | null
  zoom_topic: string | null
  has_zoom: boolean
  has_recording: boolean
  transcript_id: string | null
  has_transcript: boolean
  summary_status: string | null
  summary_note_id: string | null
  debrief_id: string | null
  debrief_status: string | null
  has_debrief: boolean
  prospect_submission_id: string | null
  prospect_lead_status: string | null
  has_prospect: boolean
}

interface MeetingsResponse {
  meetings: HubMeeting[]
  total: number
  limit: number
  offset: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type LinkKey = "prospect" | "calendly" | "zoom" | "recording" | "transcript" | "summary" | "debrief"

const LINK_META: Record<LinkKey, { label: string; icon: typeof Calendar }> = {
  prospect: { label: "Prospect/Intake", icon: UserPlus },
  calendly: { label: "Calendly", icon: Calendar },
  zoom: { label: "Zoom", icon: Video },
  recording: { label: "Recording", icon: FileText },
  transcript: { label: "Transcript", icon: FileText },
  summary: { label: "Summary", icon: Sparkles },
  debrief: { label: "Debrief", icon: MessageSquare },
}

const FILTERS: { key: LinkKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "prospect", label: "Prospect/Intake" },
  { key: "calendly", label: "Calendly" },
  { key: "zoom", label: "Zoom" },
  { key: "recording", label: "Recording" },
  { key: "transcript", label: "Transcript" },
  { key: "summary", label: "Summary" },
  { key: "debrief", label: "Debrief" },
]

function presence(m: HubMeeting): Record<LinkKey, boolean> {
  return {
    prospect: !!m.has_prospect,
    calendly: !!m.has_calendly,
    zoom: !!m.has_zoom,
    recording: !!m.has_recording,
    transcript: !!m.has_transcript,
    summary: !!m.summary_note_id,
    debrief: !!m.has_debrief,
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "No date"
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold text-stone-900">{value}</p>
        <p className="text-sm text-stone-600">{label}</p>
        {hint ? <p className="text-xs text-stone-400 mt-0.5">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/** Present/absent chip for one linkable surface. */
function LinkChip({ kind, present, href }: { kind: LinkKey; present: boolean; href?: string }) {
  const { label, icon: Icon } = LINK_META[kind]
  const body = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        present
          ? "bg-stone-900 text-white"
          : "bg-stone-100 text-stone-400 line-through decoration-stone-300",
        present && href ? "hover:bg-stone-700" : "",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
      {present && href ? <ExternalLink className="h-2.5 w-2.5" /> : null}
    </span>
  )
  if (present && href) {
    return (
      <Link href={href} onClick={(e) => e.stopPropagation()}>
        {body}
      </Link>
    )
  }
  return body
}

export default function HubMeetingsView() {
  const [filter, setFilter] = useState<LinkKey | "all">("all")
  const [search, setSearch] = useState("")
  const [syncing, setSyncing] = useState(false)

  const qs = new URLSearchParams({ limit: "200" })
  if (filter !== "all") qs.set("has", filter)
  if (search.trim()) qs.set("q", search.trim())

  const { data, error, isLoading, mutate } = useSWR<MeetingsResponse>(
    `/api/meetings?${qs.toString()}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const meetings = data?.meetings ?? []

  const stats = useMemo(() => {
    const all = meetings
    return {
      total: data?.total ?? all.length,
      withClient: all.filter((m) => m.client_name).length,
      withRecording: all.filter((m) => m.has_recording).length,
      withSummary: all.filter((m) => m.summary_note_id).length,
    }
  }, [meetings, data?.total])

  async function runSync() {
    setSyncing(true)
    try {
      await fetch("/api/meetings/sync", { method: "POST" })
      await mutate()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-stone-900">
            <Link2 className="h-6 w-6" />
            Hub Meetings
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            One unified record per meeting. Each Hub Meeting ID ties together its Prospect/Intake, Calendly booking, Zoom
            recording + transcript, ALFRED summary, and Debrief.
          </p>
        </div>
        <Button onClick={runSync} disabled={syncing} variant="outline" size="sm">
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Hub Meetings" value={stats.total} />
        <StatCard label="Linked to a client" value={stats.withClient} />
        <StatCard label="With recording" value={stats.withRecording} />
        <StatCard label="ALFRED summarized" value={stats.withSummary} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or client…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                filter === f.key ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">Failed to load meetings. Try again.</CardContent>
        </Card>
      ) : meetings.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm text-stone-600">No meetings match this filter.</p>
            <Button onClick={runSync} disabled={syncing} variant="outline" size="sm" className="mt-3">
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              Sync meetings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {meetings.map((m) => (
            <MeetingRow key={m.meeting_id} m={m} onChanged={mutate} />
          ))}
        </div>
      )}
    </div>
  )
}

function MeetingRow({ m, onChanged }: { m: HubMeeting; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const p = presence(m)

  // Deep-link targets for each present chip.
  const clientHref = m.contact_id
    ? m.client_is_prospect && m.prospect_submission_id
      ? `/prospects/${m.prospect_submission_id}`
      : `/clients/${m.contact_id}`
    : undefined

  const hrefs: Partial<Record<LinkKey, string>> = {
    prospect: m.prospect_submission_id ? `/prospects/${m.prospect_submission_id}` : clientHref,
    calendly: "/meetings/calendly",
    zoom: "/meetings/zoom",
    recording: "/meetings/zoom",
    summary: clientHref,
    debrief: "/meetings/debriefs",
  }

  const statusColor =
    m.status === "completed"
      ? "bg-emerald-100 text-emerald-800"
      : m.status === "cancelled"
        ? "bg-stone-100 text-stone-500"
        : "bg-blue-100 text-blue-800"

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-medium text-stone-900">{m.title || "Untitled meeting"}</h3>
              <Badge className={cn("shrink-0 text-xs", statusColor)} variant="secondary">
                {m.status || "scheduled"}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-stone-600">
              {fmtDate(m.scheduled_start)}
              {m.client_name ? (
                <>
                  {" · "}
                  {clientHref ? (
                    <Link href={clientHref} className="font-medium text-stone-800 hover:underline">
                      {m.client_name}
                    </Link>
                  ) : (
                    <span className="font-medium text-stone-800">{m.client_name}</span>
                  )}
                </>
              ) : (
                <span className="text-stone-400"> · No client linked</span>
              )}
              {m.host_name ? <span className="text-stone-400">{" · "}Host: {m.host_name}</span> : null}
            </p>
          </div>
          <code className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
            {m.meeting_id.slice(0, 8)}
          </code>
        </div>

        {/* Link chips */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(Object.keys(LINK_META) as LinkKey[]).map((kind) => (
            <LinkChip key={kind} kind={kind} present={p[kind]} href={hrefs[kind]} />
          ))}
        </div>

        {/* Expander — summary + transcript preview when present */}
        {(p.summary || p.transcript) && (
          <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm font-medium text-stone-600 hover:text-stone-900"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
                {open ? "Hide details" : "View summary & transcript"}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              {open ? (
                <MeetingDetail
                  meetingId={m.meeting_id}
                  zoomNumericId={m.zoom_numeric_id}
                  onChanged={onChanged}
                />
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}

interface MeetingDetailResponse {
  transcript: { text_content: string | null; segments: { speaker: string | null; text: string }[] | null } | null
  summary: { content: string | null } | null
}

function MeetingDetail({
  meetingId,
  zoomNumericId,
  onChanged,
}: {
  meetingId: string
  zoomNumericId: number | null
  onChanged: () => void
}) {
  const { data, isLoading, mutate } = useSWR<MeetingDetailResponse>(
    `/api/meetings/${meetingId}`,
    fetcher,
    { revalidateOnFocus: false },
  )
  const [regenerating, setRegenerating] = useState(false)

  async function regenerate() {
    if (!zoomNumericId) return
    setRegenerating(true)
    try {
      await fetch(`/api/zoom/meetings/${zoomNumericId}/summarize`, { method: "POST" })
      await Promise.all([mutate(), onChanged()])
    } finally {
      setRegenerating(false)
    }
  }

  if (isLoading) return <Skeleton className="h-24 w-full" />

  const summary = data?.summary?.content
  const transcript = data?.transcript

  return (
    <div className="flex flex-col gap-3 rounded-md border border-stone-200 bg-stone-50 p-3">
      {summary ? (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
              <Sparkles className="h-3 w-3" />
              ALFRED Summary
            </p>
            {zoomNumericId ? (
              <Button onClick={regenerate} disabled={regenerating} variant="ghost" size="sm" className="h-6 text-xs">
                <RefreshCw className={cn("h-3 w-3", regenerating && "animate-spin")} />
                Regenerate
              </Button>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{summary}</p>
        </div>
      ) : (
        <p className="text-sm text-stone-500">No summary yet.</p>
      )}

      {transcript?.segments && transcript.segments.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Transcript</p>
          <div className="max-h-64 overflow-y-auto rounded border border-stone-200 bg-white p-2">
            {transcript.segments.map((seg, i) => (
              <p key={i} className="mb-1 text-sm leading-relaxed">
                {seg.speaker ? <span className="font-medium text-stone-900">{seg.speaker}: </span> : null}
                <span className="text-stone-700">{seg.text}</span>
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
