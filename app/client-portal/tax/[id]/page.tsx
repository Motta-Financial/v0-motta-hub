"use client"

/**
 * Karbon-style task detail page.
 *
 * Drill-down from the Tax page's Active Projects list. Gives the client
 * one place to see a task's status and progress, discuss it with their
 * advisor, and exchange the documents that task needs.
 */

import useSWR from "swr"
import { useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  User2,
} from "lucide-react"
import { format, parseISO } from "date-fns"
import { TaskCommentThread, type TaskComment } from "@/components/portal/task-comment-thread"
import { TaskDocuments, type PortalDocument } from "@/components/portal/task-documents"

const DEEP_GREEN = "#6B745D"
const MID_GREEN = "#8E9B79"

interface TaskDetail {
  id: string
  title: string
  work_type_name: string | null
  statusDisplay: { label: string; color: string }
  assignee_name: string | null
  due_date: string | null
  start_date: string | null
  has_blocking_todos: boolean
  progressPct: number
  completed_todo_count: number
  todo_count: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ── Preview mock data ─────────────────────────────────────────────────────────

const PREVIEW_TASK: TaskDetail = {
  id: "wi-1",
  title: "2024 Individual Tax Return",
  work_type_name: "Tax Return",
  statusDisplay: { label: "In Progress", color: MID_GREEN },
  assignee_name: "Sarah Martinez",
  due_date: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
  start_date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  has_blocking_todos: true,
  progressPct: 45,
  completed_todo_count: 5,
  todo_count: 11,
}

const PREVIEW_COMMENTS: TaskComment[] = [
  {
    id: "c-1",
    author_role: "team",
    author_name: "Sarah Martinez",
    body: "Hi! I've started on your 2024 return. Could you upload your W-2 and the 1099-INT from your savings account when you get a chance?",
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "c-2",
    author_role: "client",
    author_name: "You",
    body: "Just uploaded the W-2. Still waiting on the 1099 from the bank — should have it next week.",
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "c-3",
    author_role: "team",
    author_name: "Sarah Martinez",
    body: "Perfect, thanks. No rush on the 1099 — we have until April. I'll keep working on everything else in the meantime.",
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

const PREVIEW_DOCUMENTS: PortalDocument[] = [
  {
    id: "d-1",
    name: "W-2 2024 — Acme Corp.pdf",
    file_type: "pdf",
    file_size_bytes: 248_000,
    storage_url: null,
    document_type: "W-2",
    status: "uploaded",
    uploaded_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    uploaded_by_role: "client",
  },
  {
    id: "d-2",
    name: "2024 Tax Organizer.pdf",
    file_type: "pdf",
    file_size_bytes: 1_340_000,
    storage_url: null,
    document_type: "Organizer",
    status: "uploaded",
    uploaded_at: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    uploaded_by_role: "team",
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ""

  const { data, isLoading } = useSWR<{ workItem: TaskDetail }>(
    id ? `/api/client-portal/work-items/${id}` : null,
    fetcher,
  )

  const task = data?.workItem ?? PREVIEW_TASK
  const isPreview = !data?.workItem

  return (
    <div className="max-w-3xl space-y-6">
      {/* Back link */}
      <a
        href="/client-portal/tax"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tax
      </a>

      {/* Header */}
      {isLoading && !task ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-balance text-gray-900">
              {task.title}
            </h1>
            {task.work_type_name && (
              <p className="mt-1 text-sm text-gray-500">{task.work_type_name}</p>
            )}
          </div>
          <span
            className="mt-1 inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold text-white"
            style={{ backgroundColor: task.statusDisplay.color }}
          >
            {task.statusDisplay.label}
          </span>
        </div>
      )}

      {/* Action needed banner */}
      {task.has_blocking_todos && (
        <div
          className="flex items-start gap-3 rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "#8E9B791A",
            borderColor: MID_GREEN,
            color: "#3F4635",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0"
            style={{ color: DEEP_GREEN }}
          />
          <div>
            <p className="font-medium">Action needed from you</p>
            <p className="mt-0.5 text-xs leading-relaxed">
              Your team is waiting on something before this can move forward.
              Upload the documents below or leave a comment if you have
              questions.
            </p>
          </div>
        </div>
      )}

      {/* Overview */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress */}
          {task.todo_count > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                <span>Progress</span>
                <span>
                  {task.completed_todo_count} / {task.todo_count} steps complete
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${task.progressPct}%`,
                    backgroundColor: DEEP_GREEN,
                  }}
                />
              </div>
            </div>
          )}

          {/* Meta grid */}
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {task.assignee_name && (
              <div className="flex items-center gap-2">
                <User2 className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">
                    Your preparer
                  </p>
                  <p className="font-medium text-gray-900">{task.assignee_name}</p>
                </div>
              </div>
            )}
            {task.due_date && (
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">
                    Due
                  </p>
                  <p className="font-medium text-gray-900">
                    {format(parseISO(task.due_date), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
            )}
            {task.start_date && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">
                    Started
                  </p>
                  <p className="font-medium text-gray-900">
                    {format(parseISO(task.start_date), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Documents for this task */}
      <TaskDocuments
        workItemId={id}
        previewDocuments={isPreview ? PREVIEW_DOCUMENTS : undefined}
      />

      {/* Per-task discussion */}
      <TaskCommentThread
        workItemId={id}
        previewComments={isPreview ? PREVIEW_COMMENTS : undefined}
      />
    </div>
  )
}
