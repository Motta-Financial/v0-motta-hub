"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import {
  Briefcase,
  Search,
  Video,
  MessageSquare,
  FileText,
  Calendar,
  ChevronRight,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** One row of the deals_enriched view. */
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
  meeting_count: number | null
  recorded_meeting_count: number | null
  debrief_count: number | null
  work_item_count: number | null
  last_meeting_at: string | null
  next_meeting_at: string | null
  created_at: string
}

interface DealsResponse {
  deals: Deal[]
  total: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Stage order matches the sales lifecycle defined in migration 337.
const STAGES = [
  { key: "all", label: "All" },
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

const SOURCE_LABELS: Record<string, string> = {
  prospect_form: "Prospect Form",
  calendly: "Calendly",
  intake_form: "Intake Form",
  manual: "Manual",
  unknown: "Unknown",
}

function stageLabel(stage: string | null): string {
  return STAGES.find((s) => s.key === stage)?.label ?? stage ?? "—"
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold text-stone-900">{value}</p>
        <p className="text-sm text-stone-600">{label}</p>
      </CardContent>
    </Card>
  )
}

export default function DealsListView() {
  const [stage, setStage] = useState("all")
  const [search, setSearch] = useState("")

  const qs = new URLSearchParams({ limit: "200" })
  if (stage !== "all") qs.set("stage", stage)
  if (search.trim()) qs.set("q", search.trim())

  const { data, error, isLoading } = useSWR<DealsResponse>(
    `/api/deals?${qs.toString()}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const deals = data?.deals ?? []

  const stats = useMemo(() => {
    return {
      total: data?.total ?? deals.length,
      open: deals.filter((d) => d.status === "open").length,
      needDebrief: deals.filter(
        (d) => (d.meeting_count ?? 0) > 0 && (d.debrief_count ?? 0) === 0,
      ).length,
      won: deals.filter((d) => d.stage === "won").length,
    }
  }, [deals, data?.total])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-stone-900">
            <Briefcase className="h-6 w-6" />
            Deals
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            One deal per prospect opportunity. Prospects arrive through intake forms, Calendly, or in person, then book
            meetings (Zoom, phone, or in person). Tag the client&apos;s work items to the deal and run the debrief here.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total deals" value={stats.total} />
        <StatCard label="Open" value={stats.open} />
        <StatCard label="Met, awaiting debrief" value={stats.needDebrief} />
        <StatCard label="Won" value={stats.won} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by deal or client…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {STAGES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStage(s.key)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                stage === s.key ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">Failed to load deals. Try again.</CardContent>
        </Card>
      ) : deals.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-stone-600">No deals match this filter.</CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {deals.map((d) => (
            <DealRow key={d.id} d={d} />
          ))}
        </div>
      )}
    </div>
  )
}

function DealRow({ d }: { d: Deal }) {
  const clientName = d.contact_name || d.organization_name || "Unlinked prospect"
  const needsDebrief = (d.meeting_count ?? 0) > 0 && (d.debrief_count ?? 0) === 0

  return (
    <Link href={`/deals/${d.id}`}>
      <Card className="transition-colors hover:border-stone-300 hover:bg-stone-50">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-medium text-stone-900">{d.title || clientName}</h3>
              <Badge className={cn("text-xs", STAGE_COLORS[d.stage ?? ""] ?? "bg-stone-100 text-stone-600")} variant="secondary">
                {stageLabel(d.stage)}
              </Badge>
              {needsDebrief ? (
                <Badge variant="secondary" className="bg-rose-100 text-xs text-rose-700">
                  Needs debrief
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-sm text-stone-600">
              {clientName}
              {d.owner_name ? <span className="text-stone-400">{" · "}Owner: {d.owner_name}</span> : null}
              {d.source ? <span className="text-stone-400">{" · "}{SOURCE_LABELS[d.source] ?? d.source}</span> : null}
            </p>
          </div>

          {/* Roll-up counts */}
          <div className="hidden shrink-0 items-center gap-4 text-sm text-stone-500 sm:flex">
            <span className="inline-flex items-center gap-1" title="Meetings">
              <Calendar className="h-4 w-4" />
              {d.meeting_count ?? 0}
            </span>
            <span className="inline-flex items-center gap-1" title="Recorded meetings">
              <Video className="h-4 w-4" />
              {d.recorded_meeting_count ?? 0}
            </span>
            <span className="inline-flex items-center gap-1" title="Debriefs">
              <MessageSquare className="h-4 w-4" />
              {d.debrief_count ?? 0}
            </span>
            <span className="inline-flex items-center gap-1" title="Tagged work items">
              <FileText className="h-4 w-4" />
              {d.work_item_count ?? 0}
            </span>
          </div>

          <div className="hidden shrink-0 text-right text-xs text-stone-400 md:block">
            <p>Last: {fmtDate(d.last_meeting_at)}</p>
          </div>

          <ChevronRight className="h-5 w-5 shrink-0 text-stone-300" />
        </CardContent>
      </Card>
    </Link>
  )
}
