"use client"

/**
 * Feedback Submissions list — every Jotform "Feedback + Referral Form"
 * entry the firm has received from clients, with rating analytics on
 * top.
 *
 * Layout: page header → integration status card → KPI cards (avg
 * overall rating, promoter count, detractor count, referrals captured)
 * → triage tabs → segment + search filters → table → side sheet for
 * detail + triage actions.
 *
 * Data: SWR-fetched from `/api/jotform/feedback`. Mutations route
 * through `/api/jotform/feedback/[id]` (PATCH) and revalidate the list.
 *
 * Note on segments: we use a stricter scale than NPS because the
 * underlying question is 1-5, not 0-10. Promoter = 5, Passive = 4,
 * Detractor = 1-3. Anything below a 5 gets triaged.
 */

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  CalendarDays,
  Inbox,
  Link2,
  MessageSquareHeart,
  RefreshCw,
  Search,
  Star,
  ThumbsDown,
  Users,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { JotformStatusCard } from "@/components/intake/jotform-status-card"
import { FeedbackDetailSheet } from "./feedback-detail-sheet"

// ─────────────────────────────────────────────────────────────────────
// Row shape — must match `GET /api/jotform/feedback` projection
// ─────────────────────────────────────────────────────────────────────

export interface FeedbackRow {
  id: string
  jotform_submission_id: string
  jotform_created_at: string | null
  submitter_full_name: string | null
  submitter_first_name: string | null
  submitter_last_name: string | null
  submitter_email: string | null
  client_status: string | null
  rating_overall: number | null
  rating_service_quality: number | null
  rating_communication: number | null
  rating_responsiveness: number | null
  rating_friendliness: number | null
  feedback_comments: string | null
  permission_to_share: boolean | null
  has_referral_interest: boolean | null
  referral_count: number | null
  triage_status: string | null
  reviewed_by_id: string | null
  reviewed_at: string | null
  karbon_work_item_id: string | null
  karbon_work_item_title: string | null
  contact_id: string | null
  organization_id: string | null
  link_method: "auto_email" | "auto_name" | "manual" | null
  linked_at: string | null
  reviewedBy: { id: string; name: string; avatarUrl: string | null } | null
  // Resolved by /api/jotform/feedback — feedback submitters who
  // also exist as a contact/org in Karbon are deep-linked here.
  linkedClient: { type: "contact" | "organization"; id: string; name: string } | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─────────────────────────────────────────────────────────────────────
// Triage status presentation
// ─────────────────────────────────────────────────────────────────────

const STATUS_VALUES = ["new", "reviewed", "responded", "closed"] as const
type StatusValue = (typeof STATUS_VALUES)[number]

const STATUS_LABEL: Record<StatusValue, string> = {
  new: "New",
  reviewed: "Reviewed",
  responded: "Responded",
  closed: "Closed",
}

const STATUS_BADGE: Record<StatusValue, string> = {
  new: "bg-amber-50 text-amber-700 border-amber-200",
  reviewed: "bg-sky-50 text-sky-700 border-sky-200",
  responded: "bg-indigo-50 text-indigo-700 border-indigo-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
}

function statusBadge(value: string | null) {
  const v = (value ?? "new") as StatusValue
  const cls = STATUS_BADGE[v] ?? STATUS_BADGE.new
  return (
    <Badge variant="outline" className={cn("font-medium", cls)}>
      {STATUS_LABEL[v] ?? v}
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function initialsFor(row: FeedbackRow): string {
  const f = row.submitter_first_name?.[0] ?? ""
  const l = row.submitter_last_name?.[0] ?? ""
  const out = `${f}${l}`.trim()
  if (out) return out.toUpperCase()
  const name = row.submitter_full_name ?? "?"
  return name.slice(0, 2).toUpperCase()
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function formatRelative(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function isThisMonth(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

// 1-5 stars rendered with filled/outline glyphs. Used in the table
// (compact) and detail sheet (full). Returns null if rating is null
// so the row just shows "—".
function StarRating({ value, size = 14 }: { value: number | null; size?: number }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>
  const v = Math.max(0, Math.min(5, Math.round(value)))
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${v} of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={cn(
            i < v ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

const FEEDBACK_FORM_ID = "240915444941155"

export function FeedbackList() {
  const [statusTab, setStatusTab] = useState<"all" | StatusValue>("all")
  const [segment, setSegment] = useState<string>("all")
  const [withReferrals, setWithReferrals] = useState<boolean>(false)
  // Linked-client filter — same shape as the intake list. "no" is
  // the typical workflow when the auto-matcher misses a submitter
  // (e.g. they used a personal email Karbon doesn't have on file)
  // and a human needs to pin the right contact.
  const [linked, setLinked] = useState<"all" | "yes" | "no">("all")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const qs = new URLSearchParams()
  if (statusTab !== "all") qs.set("status", statusTab)
  if (segment !== "all") qs.set("segment", segment)
  if (withReferrals) qs.set("with_referrals", "1")
  if (linked !== "all") qs.set("linked", linked)
  if (search.trim()) qs.set("search", search.trim())

  const swrKey = `/api/jotform/feedback?${qs.toString()}`
  const { data, isLoading, mutate } = useSWR<{ rows: FeedbackRow[]; count: number }>(
    swrKey,
    fetcher,
    { revalidateOnFocus: false },
  )
  const rows = data?.rows ?? []

  // Headline metrics computed from the all-time set so KPIs don't
  // shrink when the user filters. Fetched once with a generous limit.
  const { data: totalsData } = useSWR<{ rows: FeedbackRow[]; count: number }>(
    "/api/jotform/feedback?limit=1000",
    fetcher,
    { revalidateOnFocus: false },
  )
  const allRows = totalsData?.rows ?? []

  const kpis = useMemo(() => {
    const total = allRows.length
    const ratings = allRows.map((r) => r.rating_overall).filter((n): n is number => typeof n === "number" && n > 0)
    const avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null
    const promoters = allRows.filter((r) => r.rating_overall === 5).length
    const detractors = allRows.filter(
      (r) => typeof r.rating_overall === "number" && r.rating_overall > 0 && r.rating_overall <= 3,
    ).length
    const referrals = allRows.reduce((acc, r) => acc + (r.referral_count ?? 0), 0)
    const thisMonth = allRows.filter((r) => isThisMonth(r.jotform_created_at)).length
    return { total, avg, promoters, detractors, referrals, thisMonth }
  }, [allRows])

  return (
    <div className="space-y-6">
      {/* ─────── Header ─────── */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Client Feedback</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
            Every response submitted via the Feedback &amp; Referral form. Rate-and-comment data flows
            in real time so we can route low ratings to a partner, capture referrals before they go
            cold, and surface testimonial-quality comments.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          className="gap-2 self-start md:self-auto"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {/* Webhook + form integration health, scoped to the feedback form */}
      <JotformStatusCard formId={FEEDBACK_FORM_ID} />

      {/* ─────── KPIs ─────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Avg overall rating"
          value={kpis.avg != null ? kpis.avg.toFixed(2) : "—"}
          suffix={kpis.avg != null ? "/ 5" : undefined}
          icon={Star}
          accent="text-amber-600"
        />
        <KpiCard
          label="5★ promoters"
          value={kpis.promoters}
          suffix={kpis.total > 0 ? `of ${kpis.total}` : undefined}
          icon={MessageSquareHeart}
          accent="text-emerald-600"
        />
        <KpiCard
          label="Detractors (≤3★)"
          value={kpis.detractors}
          icon={ThumbsDown}
          accent={kpis.detractors > 0 ? "text-rose-600" : "text-muted-foreground"}
        />
        <KpiCard
          label="Referrals captured"
          value={kpis.referrals}
          icon={Users}
          accent="text-sky-600"
        />
      </div>

      {/* ─────── Filters ─────── */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as typeof statusTab)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              {STATUS_VALUES.map((s) => (
                <TabsTrigger key={s} value={s}>
                  {STATUS_LABEL[s]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center md:justify-end">
            <Select value={segment} onValueChange={setSegment}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Segment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ratings</SelectItem>
                <SelectItem value="promoter">Promoters (5★)</SelectItem>
                <SelectItem value="passive">Passives (4★)</SelectItem>
                <SelectItem value="detractor">Detractors (≤3★)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={linked} onValueChange={(v) => setLinked(v as typeof linked)}>
              <SelectTrigger className="w-full md:w-[170px]">
                <SelectValue placeholder="Client link" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All submissions</SelectItem>
                <SelectItem value="yes">Linked to client</SelectItem>
                <SelectItem value="no">Unlinked</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant={withReferrals ? "default" : "outline"}
              size="sm"
              onClick={() => setWithReferrals((v) => !v)}
              className="gap-2"
            >
              <Users className="h-4 w-4" />
              With referrals
            </Button>

            <div className="relative w-full md:w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, comments…"
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─────── Table ─────── */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Submitter</th>
                <th className="px-4 py-3 font-medium">Linked client</th>
                <th className="px-4 py-3 font-medium">Overall</th>
                <th className="px-4 py-3 font-medium">Comment</th>
                <th className="px-4 py-3 font-medium">Referrals</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Reviewer</th>
                <th className="px-4 py-3 font-medium text-right">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    Loading feedback…
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    No feedback matches the current filters.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/40 last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-muted text-xs font-medium">
                          {initialsFor(row)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">
                          {row.submitter_full_name ?? "Unknown"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {row.submitter_email ?? "no email"}
                          {row.client_status && (
                            <span className="ml-1 text-muted-foreground/70">· {row.client_status}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.linkedClient ? (
                      <a
                        href={
                          row.linkedClient.type === "contact"
                            ? `/contacts/${row.linkedClient.id}`
                            : `/organizations/${row.linkedClient.id}`
                        }
                        // Stop the row click handler so clicking the
                        // chip jumps to the client profile instead of
                        // opening the side sheet.
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                        title={`Linked via ${row.link_method ?? "manual"}`}
                      >
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{row.linkedClient.name}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unlinked</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StarRating value={row.rating_overall} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.feedback_comments ? (
                      <span className="block max-w-[320px] truncate text-foreground">
                        {row.feedback_comments}
                      </span>
                    ) : (
                      <span className="italic">No comment</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(row.referral_count ?? 0) > 0 ? (
                      <Badge variant="secondary" className="font-normal">
                        <Users className="mr-1 h-3 w-3" />
                        {row.referral_count}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{statusBadge(row.triage_status)}</td>
                  <td className="px-4 py-3">
                    {row.reviewedBy ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          {row.reviewedBy.avatarUrl ? (
                            <AvatarImage src={row.reviewedBy.avatarUrl} alt={row.reviewedBy.name} />
                          ) : null}
                          <AvatarFallback className="bg-muted text-[10px]">
                            {row.reviewedBy.name
                              .split(" ")
                              .map((n) => n[0])
                              .filter(Boolean)
                              .slice(0, 2)
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{row.reviewedBy.name}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-sm text-foreground">{formatDate(row.jotform_created_at)}</div>
                    <div className="text-xs text-muted-foreground">{formatRelative(row.jotform_created_at)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─────── Detail sheet ─────── */}
      <FeedbackDetailSheet
        submissionId={selectedId}
        open={selectedId != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
        onChanged={() => mutate()}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// KPI card subcomponent (mirrors the intake list pattern)
// ─────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  suffix,
  icon: Icon,
  accent,
}: {
  label: string
  value: string | number
  suffix?: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md bg-muted", accent)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
            {suffix && <div className="text-xs text-muted-foreground">{suffix}</div>}
          </div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// Re-exported so tree-shake doesn't strip the icon imports above.
export { Inbox, CalendarDays }
