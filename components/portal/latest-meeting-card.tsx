"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChevronRight, AlertTriangle } from "lucide-react"
import { format, parseISO } from "date-fns"
import { MOCK_MEETINGS, isOverdue } from "@/lib/mock/meetings"
import { TodoRow } from "@/components/portal/meeting-card"

const PRIMARY = "#6B745D"
const WARNING_BG = "#FEF3C7"
const WARNING_TEXT = "#92400E"

export function LatestMeetingCard() {
  const meeting = MOCK_MEETINGS[0]
  if (!meeting) return null

  const date = parseISO(meeting.startsAt)
  const overdueCount = meeting.clientTodos.filter((t) =>
    isOverdue(t.dueDate, t.completed),
  ).length
  const previewTodos = meeting.clientTodos.slice(0, 3)

  return (
    <Card className="shadow-sm border-0">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base font-semibold">
            Your last meeting — {format(date, "MMMM d")}
          </CardTitle>
          <p className="text-sm text-gray-600 mt-1 leading-snug">
            {meeting.recap}
          </p>
        </div>
        {overdueCount > 0 && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: WARNING_BG, color: WARNING_TEXT }}
          >
            <AlertTriangle className="h-3 w-3" />
            {overdueCount} item{overdueCount > 1 ? "s" : ""} overdue
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {previewTodos.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Your to-dos
            </p>
            <ul className="space-y-2">
              {previewTodos.map((item) => (
                <TodoRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        )}
        <a
          href="/client-portal/meetings"
          className="flex items-center gap-1 text-xs font-medium hover:underline"
          style={{ color: PRIMARY }}
        >
          View all meetings <ChevronRight className="h-3.5 w-3.5" />
        </a>
      </CardContent>
    </Card>
  )
}
