"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Circle, Clock, PlayCircle, Users, CalendarDays } from "lucide-react"
import { format, parseISO } from "date-fns"
import type { Meeting, MeetingTodo } from "@/lib/mock/meetings"
import { isOverdue } from "@/lib/mock/meetings"

// Exact palette from client-portal-layout.tsx — do not change independently
const PRIMARY = "#6B745D"
const BORDER = "#8E9B79"
const WARNING_BG = "#FEF3C7"
const WARNING_TEXT = "#92400E"

export function MeetingCard({ meeting }: { meeting: Meeting }) {
  const date = parseISO(meeting.startsAt)

  return (
    <Card className="shadow-sm border-0">
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">
              {meeting.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {format(date, "EEEE, MMMM d, yyyy 'at' h:mm a")}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {meeting.durationMinutes} min
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {meeting.firmAttendees.join(", ")}
              </span>
            </div>
          </div>

          {meeting.recordingUrl && (
            <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
              <a href={meeting.recordingUrl}>
                <PlayCircle className="h-4 w-4" style={{ color: PRIMARY }} />
                Watch recording
              </a>
            </Button>
          )}
        </div>

        {/* Recap */}
        <p className="text-sm text-gray-600 leading-relaxed">{meeting.recap}</p>

        {/* Two-column to-do lists */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
          <TodoColumn label="Your to-dos" items={meeting.clientTodos} />
          <TodoColumn label="What we're doing" items={meeting.firmTodos} />
        </div>
      </CardContent>
    </Card>
  )
}

function TodoColumn({ label, items }: { label: string; items: MeetingTodo[] }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">Nothing here.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <TodoRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function TodoRow({ item }: { item: MeetingTodo }) {
  const overdue = isOverdue(item.dueDate, item.completed)

  return (
    <li className="flex items-start gap-2">
      {item.completed ? (
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: PRIMARY }} />
      ) : (
        <Circle className="h-4 w-4 mt-0.5 shrink-0 text-gray-300" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm leading-snug ${
            item.completed ? "text-gray-400 line-through" : "text-gray-700"
          }`}
        >
          {item.text}
        </p>
        {item.dueDate && (
          <p
            className={`text-xs mt-0.5 font-medium ${overdue ? "" : "text-gray-400"}`}
            style={overdue ? { color: WARNING_TEXT } : undefined}
          >
            {overdue ? "Overdue — " : "Due "}
            {format(parseISO(item.dueDate), "MMM d")}
          </p>
        )}
      </div>
    </li>
  )
}

export { WARNING_BG, WARNING_TEXT, PRIMARY, BORDER }
