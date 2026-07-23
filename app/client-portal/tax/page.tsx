"use client"

import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { AlertTriangle, FileText, CheckCircle2, CalendarDays, User2, ChevronDown } from "lucide-react"
import { format, parseISO } from "date-fns"

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaxWorkItem {
  id: string
  title: string
  work_type_name: string | null
  statusDisplay: { label: string; color: string }
  assignee_name: string | null
  due_date: string | null
  has_blocking_todos: boolean
  progressPct: number
  completed_todo_count: number
  todo_count: number
}

interface TaxReturn {
  id: string
  tax_year: number | string
  form_type: string | null
  statusDisplay: { label: string; color: string }
  description: string | null
  last_updated_at: string | null
  assigned_user_name: string | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ── Preview mock data ─────────────────────────────────────────────────────────

const PREVIEW_WORK_ITEMS: TaxWorkItem[] = [
  {
    id: "wi-1",
    title: "2024 Individual Tax Return",
    work_type_name: "Tax Return",
    statusDisplay: { label: "In Progress", color: "#3B82F6" },
    assignee_name: "Sarah Martinez",
    due_date: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
    has_blocking_todos: true,
    progressPct: 45,
    completed_todo_count: 5,
    todo_count: 11,
  },
  {
    id: "wi-2",
    title: "2023 Amended Return (1040-X)",
    work_type_name: "Amended Return",
    statusDisplay: { label: "Under Review", color: "#8B5CF6" },
    assignee_name: "James Motta",
    due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    has_blocking_todos: false,
    progressPct: 85,
    completed_todo_count: 17,
    todo_count: 20,
  },
]

const PREVIEW_TAX_RETURNS: TaxReturn[] = [
  {
    id: "tr-1",
    tax_year: 2024,
    form_type: "1040",
    statusDisplay: { label: "In Progress", color: "#3B82F6" },
    description: "Individual income tax return — federal and state",
    last_updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    assigned_user_name: "Sarah Martinez",
  },
  {
    id: "tr-2",
    tax_year: 2023,
    form_type: "1040",
    statusDisplay: { label: "Complete", color: "#10B981" },
    description: "Federal and state filed — April 2024",
    last_updated_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    assigned_user_name: "Sarah Martinez",
  },
  {
    id: "tr-3",
    tax_year: 2022,
    form_type: "1040",
    statusDisplay: { label: "Complete", color: "#10B981" },
    description: "Federal and state filed — April 2023",
    last_updated_at: new Date(Date.now() - 450 * 24 * 60 * 60 * 1000).toISOString(),
    assigned_user_name: "James Motta",
  },
  {
    id: "tr-4",
    tax_year: 2021,
    form_type: "1040",
    statusDisplay: { label: "Complete", color: "#10B981" },
    description: "Federal and state filed",
    last_updated_at: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString(),
    assigned_user_name: "James Motta",
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TaxPage() {
  const { data } = useSWR<{
    taxWorkItems: TaxWorkItem[]
    taxReturns: TaxReturn[]
  }>("/api/client-portal/tax", fetcher)

  const isLoading = false
  const workItems = data?.taxWorkItems ?? PREVIEW_WORK_ITEMS
  const taxReturns = data?.taxReturns ?? PREVIEW_TAX_RETURNS

  const hasBlockingItems = workItems.some((w) => w.has_blocking_todos)

  // Split returns: current year vs. prior years
  const currentYear = new Date().getFullYear()
  const activeReturns = taxReturns.filter(
    (r) => Number(r.tax_year) >= currentYear - 1,
  )
  const pastReturns = taxReturns.filter(
    (r) => Number(r.tax_year) < currentYear - 1,
  )

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tax</h1>
        <p className="text-sm text-gray-500 mt-1">
          Your active tax projects and return history.
        </p>
      </div>

      {/* Action needed banner */}
      {!isLoading && hasBlockingItems && (
        <div
          className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: "#FEF3C7",
            borderColor: "#D97706",
            color: "#92400E",
          }}
        >
          <AlertTriangle
            className="h-5 w-5 mt-0.5 shrink-0"
            style={{ color: "#D97706" }}
          />
          <div>
            <p className="font-medium">Action needed from you</p>
            <p className="mt-0.5 text-xs">
              Your team is waiting on documents or information to continue.
              Please reach out to your advisor or{" "}
              <a
                href="/client-portal/messages"
                className="underline font-medium"
                style={{ color: "#92400E" }}
              >
                send a message
              </a>
              .
            </p>
          </div>
        </div>
      )}

      {/* Active work items */}
      <Card className="shadow-sm border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Active Projects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))
          ) : workItems.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-500">
                No active tax projects right now.
              </p>
            </div>
          ) : (
            workItems.map((item) => <WorkItemCard key={item.id} item={item} />)
          )}
        </CardContent>
      </Card>

      {/* Current tax returns */}
      {(isLoading || activeReturns.length > 0) && (
        <Card className="shadow-sm border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Tax Returns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))
            ) : (
              activeReturns.map((r) => <ReturnRow key={r.id} ret={r} />)
            )}

            {/* Past returns in collapsible */}
            {pastReturns.length > 0 && (
              <PastReturns returns={pastReturns} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state when no returns found */}
      {!isLoading && activeReturns.length === 0 && pastReturns.length === 0 && (
        <Card className="shadow-sm border-0">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <FileText className="h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">
              No tax returns on file yet. Your returns will appear here once
              they are set up in our system.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Work item card ────────────────────────────────────────────────────────────

function WorkItemCard({ item }: { item: TaxWorkItem }) {
  const progressWidth = `${item.progressPct}%`

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        item.has_blocking_todos
          ? "border-amber-200 bg-amber-50/40"
          : "border-gray-100 bg-gray-50/50"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {item.title}
          </p>
          {item.work_type_name && (
            <p className="text-xs text-gray-400 mt-0.5">{item.work_type_name}</p>
          )}
        </div>
        <span
          className="shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
          style={{ backgroundColor: item.statusDisplay.color }}
        >
          {item.statusDisplay.label}
        </span>
      </div>

      {/* Progress bar */}
      {item.todo_count > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>Progress</span>
            <span>
              {item.completed_todo_count} / {item.todo_count} steps
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: progressWidth,
                backgroundColor: "#6B745D",
              }}
            />
          </div>
        </div>
      )}

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        {item.assignee_name && (
          <span className="flex items-center gap-1">
            <User2 className="h-3.5 w-3.5" />
            {item.assignee_name}
          </span>
        )}
        {item.due_date && (
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            Due {format(parseISO(item.due_date), "MMM d, yyyy")}
          </span>
        )}
        {item.has_blocking_todos && (
          <span className="flex items-center gap-1 font-medium" style={{ color: "#D97706" }}>
            <AlertTriangle className="h-3.5 w-3.5" />
            Waiting on you
          </span>
        )}
      </div>
    </div>
  )
}

// ── Past returns collapsible ──────────────────────────────────────────────────

function PastReturns({ returns }: { returns: TaxReturn[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger asChild>
        <button
          className="flex w-full items-center gap-1.5 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          type="button"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
          View prior returns ({returns.length})
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1">
        {returns.map((r) => (
          <ReturnRow key={r.id} ret={r} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ── Return row ────────────────────────────────────────────────────────────────

function ReturnRow({ ret }: { ret: TaxReturn }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-4 py-3 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white text-xs font-bold"
          style={{ backgroundColor: "#6B745D" }}
        >
          {ret.tax_year}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {ret.form_type ?? "Tax Return"}{" "}
            <span className="text-gray-500 font-normal">— {ret.tax_year}</span>
          </p>
          {ret.assigned_user_name && (
            <p className="text-xs text-gray-400">
              Preparer: {ret.assigned_user_name}
            </p>
          )}
        </div>
      </div>
      <span
        className="shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
        style={{ backgroundColor: ret.statusDisplay.color }}
      >
        {ret.statusDisplay.label}
      </span>
    </div>
  )
}
