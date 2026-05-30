"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  Video,
  Phone,
  MapPin,
  MessageSquare,
  FileText,
  Sparkles,
  Plus,
  X,
  ExternalLink,
  CheckCircle2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Deal {
  id: string
  title: string | null
  stage: string | null
  status: string | null
  source: string | null
  contact_id: string | null
  organization_id: string | null
  contact_name: string | null
  organization_name: string | null
  owner_name: string | null
  owner_team_member_id: string | null
  notes: string | null
  created_at: string
}

interface Meeting {
  meeting_id: string
  title: string | null
  meeting_type: string | null
  status: string | null
  scheduled_start: string | null
  location_type: string | null
  has_zoom: boolean
  has_recording: boolean
  has_transcript: boolean
  summary_note_id: string | null
  calendly_uuid: string | null
  zoom_numeric_id: number | null
  has_debrief: boolean
  debrief_id: string | null
}

interface Debrief {
  id: string
  debrief_date: string | null
  debrief_type: string | null
  notes: string | null
  status: string | null
  created_at: string
  team_member_full_name: string | null
  meeting_id: string | null
}

interface WorkItem {
  // The detail API returns work_items_enriched rows keyed by `id` with
  // link_source merged in from the deal_work_items join table.
  id: string
  link_source: string | null
  title: string | null
  primary_status: string | null
  assignee_full_name: string | null
  karbon_url: string | null
}

interface DealDetail {
  deal: Deal
  meetings: Meeting[]
  debriefs: Debrief[]
  workItems: WorkItem[]
}

const STAGES = [
  { key: "new", label: "New" },
  { key: "meeting_scheduled", label: "Meeting Scheduled" },
  { key: "met", label: "Met" },
  { key: "debriefed", label: "Debriefed" },
  { key: "proposal", label: "Proposal" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
]

const STAGE_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  meeting_scheduled: "bg-indigo-100 text-indigo-800",
  met: "bg-amber-100 text-amber-800",
  debriefed: "bg-violet-100 text-violet-800",
  proposal: "bg-orange-100 text-orange-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-stone-200 text-stone-600",
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "No date"
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

/** Pick the icon that represents how the meeting happened. */
function meetingIcon(m: Meeting) {
  if (m.has_zoom || m.location_type === "virtual") return Video
  if (m.location_type === "phone") return Phone
  if (m.location_type === "physical" || m.location_type === "in_person") return MapPin
  return Calendar
}

export default function DealDetailView({ dealId }: { dealId: string }) {
  const router = useRouter()
  const { data, error, isLoading, mutate } = useSWR<DealDetail>(`/api/deals/${dealId}`, fetcher, {
    revalidateOnFocus: false,
  })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !data?.deal) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-stone-600">
          Deal not found.{" "}
          <Link href="/deals" className="font-medium text-stone-900 underline">
            Back to deals
          </Link>
        </CardContent>
      </Card>
    )
  }

  const { deal, meetings, debriefs, workItems } = data
  const clientName = deal.contact_name || deal.organization_name || "Unlinked prospect"
  const clientHref = deal.contact_id ? `/clients/${deal.contact_id}` : undefined

  async function updateStage(stage: string) {
    await fetch(`/api/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    })
    await mutate()
  }

  // Launch the existing DebriefForm prefilled with the deal's contact, the
  // tagged work items, and the deal_id so the debrief attaches to the deal.
  function runDebrief(meeting?: Meeting) {
    const params = new URLSearchParams()
    params.set("deal_id", deal.id)
    if (deal.contact_id) {
      params.set("contact_id", deal.contact_id)
      params.set("contact_type", "contact")
      params.set("contact_name", clientName)
    } else if (deal.organization_id) {
      params.set("contact_id", deal.organization_id)
      params.set("contact_type", "organization")
      params.set("contact_name", clientName)
    }
    if (meeting) {
      params.set("meeting_id", meeting.meeting_id)
      if (meeting.scheduled_start) params.set("meeting_date", meeting.scheduled_start.slice(0, 10))
      if (meeting.calendly_uuid) params.set("calendly_event_id", meeting.calendly_uuid)
    }
    router.push(`/debriefs/new?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Back */}
      <Link
        href="/deals"
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-stone-600 hover:text-stone-900"
      >
        <ArrowLeft className="h-4 w-4" />
        All deals
      </Link>

      {/* Header card */}
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold text-stone-900">
              <Briefcase className="h-5 w-5" />
              {deal.title || clientName}
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              {clientHref ? (
                <Link href={clientHref} className="font-medium text-stone-800 hover:underline">
                  {clientName}
                </Link>
              ) : (
                <span className="font-medium text-stone-800">{clientName}</span>
              )}
              {deal.owner_name ? <span className="text-stone-400">{" · "}Owner: {deal.owner_name}</span> : null}
              <span className="text-stone-400">{" · "}Opened {fmtDate(deal.created_at)}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Select value={deal.stage ?? "new"} onValueChange={updateStage}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge
              className={cn("text-xs", STAGE_COLORS[deal.stage ?? ""] ?? "bg-stone-100 text-stone-600")}
              variant="secondary"
            >
              {deal.status ?? "open"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: meetings + debriefs */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Meetings timeline */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                Meetings ({meetings.length})
              </CardTitle>
              <Button onClick={() => runDebrief()} size="sm" variant="outline">
                <MessageSquare className="h-4 w-4" />
                Run debrief
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {meetings.length === 0 ? (
                <p className="text-sm text-stone-500">
                  No meetings yet. When this prospect books a Zoom, phone, or in-person meeting it shows up here.
                </p>
              ) : (
                meetings.map((m) => {
                  const Icon = meetingIcon(m)
                  return (
                    <div
                      key={m.meeting_id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-stone-200 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-stone-500" />
                          <span className="truncate font-medium text-stone-900">{m.title || "Meeting"}</span>
                          <Badge variant="secondary" className="bg-stone-100 text-xs text-stone-600">
                            {m.status || "scheduled"}
                          </Badge>
                        </div>
                        <p className="mt-0.5 pl-6 text-sm text-stone-600">{fmtDateTime(m.scheduled_start)}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                          {m.has_recording ? <Chip icon={Video} label="Recording" /> : null}
                          {m.has_transcript ? <Chip icon={FileText} label="Transcript" /> : null}
                          {m.summary_note_id ? <Chip icon={Sparkles} label="Summary" /> : null}
                          {!m.has_zoom ? <Chip icon={Phone} label="No recording" muted /> : null}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {m.has_debrief ? (
                          <Badge variant="secondary" className="bg-emerald-100 text-xs text-emerald-700">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Debriefed
                          </Badge>
                        ) : (
                          <Button onClick={() => runDebrief(m)} size="sm" variant="ghost" className="h-7 text-xs">
                            <MessageSquare className="h-3 w-3" />
                            Debrief
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* Debriefs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-4 w-4" />
                Debriefs ({debriefs.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {debriefs.length === 0 ? (
                <p className="text-sm text-stone-500">No debriefs yet. Run one from a meeting above.</p>
              ) : (
                debriefs.map((db) => (
                  <div key={db.id} className="rounded-md border border-stone-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-stone-900">
                        {db.debrief_type || "Debrief"} · {fmtDate(db.debrief_date)}
                      </span>
                      <span className="text-xs text-stone-400">{db.team_member_full_name ?? ""}</span>
                    </div>
                    {db.notes ? (
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-stone-600">{db.notes}</p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: work items */}
        <div className="flex flex-col gap-6">
          <WorkItemsPanel
            dealId={dealId}
            contactId={deal.contact_id}
            workItems={workItems}
            onChanged={mutate}
          />
        </div>
      </div>
    </div>
  )
}

function Chip({ icon: Icon, label, muted }: { icon: typeof Video; label: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        muted ? "bg-stone-100 text-stone-400" : "bg-stone-900 text-white",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

interface SuggestItem {
  id: string
  title: string | null
  primary_status: string | null
  assignee_name: string | null
}

function WorkItemsPanel({
  dealId,
  contactId,
  workItems,
  onChanged,
}: {
  dealId: string
  contactId: string | null
  workItems: WorkItem[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState("")

  // Suggest the contact's work items (Karbon) so the partner can tag the
  // ones relevant to this deal. Falls back to a free search when typing.
  const suggestUrl = contactId
    ? `/api/work-items?clientId=${contactId}&limit=50`
    : search.trim()
      ? `/api/work-items?search=${encodeURIComponent(search.trim())}&limit=25`
      : null
  const { data: suggestData } = useSWR<{ work_items?: SuggestItem[] }>(
    adding ? suggestUrl : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const suggestions: SuggestItem[] = (suggestData?.work_items ?? []) as SuggestItem[]
  const taggedIds = new Set(workItems.map((w) => w.id))
  const filtered = suggestions
    .filter((s) => !taggedIds.has(s.id))
    .filter((s) => (search.trim() ? (s.title ?? "").toLowerCase().includes(search.trim().toLowerCase()) : true))
    .slice(0, 8)

  async function tag(workItemId: string) {
    await fetch(`/api/deals/${dealId}/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work_item_id: workItemId }),
    })
    await onChanged()
  }

  async function untag(workItemId: string) {
    await fetch(`/api/deals/${dealId}/work-items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work_item_id: workItemId }),
    })
    await onChanged()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Work Items ({workItems.length})
        </CardTitle>
        <Button onClick={() => setAdding((v) => !v)} size="sm" variant="ghost" className="h-7">
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? "Close" : "Tag"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-stone-500">
          Tag the client&apos;s Karbon work item(s) to this deal. The debrief you run on the deal posts back to these
          work items.
        </p>

        {/* Tag picker */}
        {adding ? (
          <div className="flex flex-col gap-2 rounded-md border border-stone-200 bg-stone-50 p-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search work items…"
              className="h-8 bg-white text-sm"
            />
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-1 py-2 text-xs text-stone-400">No matching work items.</p>
              ) : (
                filtered.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => tag(s.id)}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-stone-100"
                  >
                    <span className="min-w-0 flex-1 truncate text-stone-800">{s.title || "Untitled"}</span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}

        {/* Tagged list */}
        {workItems.length === 0 ? (
          <p className="text-sm text-stone-500">No work items tagged yet.</p>
        ) : (
          workItems.map((w) => (
            <div key={w.id} className="flex items-start justify-between gap-2 rounded-md border border-stone-200 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-stone-900">{w.title || "Untitled"}</span>
                  {w.karbon_url ? (
                    <a href={w.karbon_url} target="_blank" rel="noreferrer" className="shrink-0 text-stone-400 hover:text-stone-700">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  {w.primary_status || "—"}
                  {w.assignee_full_name ? ` · ${w.assignee_full_name}` : ""}
                  {w.link_source && w.link_source !== "manual" ? ` · ${w.link_source}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => untag(w.id)}
                className="shrink-0 text-stone-300 hover:text-rose-500"
                aria-label="Untag work item"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
