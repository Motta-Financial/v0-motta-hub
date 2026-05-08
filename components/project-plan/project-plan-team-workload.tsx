"use client"

import { useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ExpandableCard } from "@/components/ui/expandable-card"
import {
  bucketStatus,
  getAssigneeLabel,
  STATUS_BUCKETS,
  STATUS_COLORS,
  useAccountingWorkItems,
  type StatusBucket,
} from "./project-plan-shared"
import { useProjectPlanContext } from "./project-plan-context"
import { ChevronRight, Loader2, Users } from "lucide-react"

// Mirrors the "Team Workload" tab in the FY2026 project-plan workbook,
// scoped to ACCT work types. Each row = one team member, columns = the
// five Karbon status buckets, plus an "Active" total. Rows are clickable
// — they jump to the Kanban tab pre-filtered to that assignee, and each
// status cell jumps to the Roster pre-filtered to (assignee × status).
export function ProjectPlanTeamWorkload() {
  const { activeWorkItems, isLoading } = useAccountingWorkItems()
  const { jumpTo } = useProjectPlanContext()

  const rows = useMemo(() => {
    const byPerson = new Map<string, Record<StatusBucket, number> & { total: number }>()

    for (const item of activeWorkItems) {
      const assignee = getAssigneeLabel(item)
      const bucket = bucketStatus(item)

      if (!byPerson.has(assignee)) {
        byPerson.set(assignee, {
          "Not Started": 0,
          "To Do": 0,
          "In Progress": 0,
          Waiting: 0,
          Complete: 0,
          total: 0,
        })
      }
      const row = byPerson.get(assignee)!
      row[bucket] += 1
      row.total += 1
    }

    return Array.from(byPerson.entries())
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.total - a.total)
  }, [activeWorkItems])

  const totals = useMemo(() => {
    const t: Record<StatusBucket, number> & { total: number } = {
      "Not Started": 0,
      "To Do": 0,
      "In Progress": 0,
      Waiting: 0,
      Complete: 0,
      total: 0,
    }
    for (const r of rows) {
      for (const s of STATUS_BUCKETS) t[s] += r[s]
      t.total += r.total
    }
    return t
  }, [rows])

  if (isLoading && !rows.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />
          Loading team workload…
        </CardContent>
      </Card>
    )
  }

  const maxTotal = Math.max(...rows.map((r) => r.total), 1)

  return (
    <ExpandableCard
      title="Team Workload"
      description={`${rows.length} team member${rows.length === 1 ? "" : "s"} carrying ${totals.total} active ACCT work items — click a row to view their Kanban, click a number to drill into the Roster`}
      icon={<Users className="h-5 w-5 text-blue-600" />}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Team Member</th>
              {STATUS_BUCKETS.map((s) => (
                <th key={s} className="py-2 pr-4 font-medium text-right whitespace-nowrap">
                  {s}
                </th>
              ))}
              <th className="py-2 pr-4 font-medium text-right">Active</th>
              <th className="py-2 pl-4 font-medium w-1/3">Distribution</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                onClick={() => jumpTo("kanban", { assignee: r.name })}
                tabIndex={0}
                role="button"
                aria-label={`View ${r.name}'s Kanban (${r.total} active items)`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    jumpTo("kanban", { assignee: r.name })
                  }
                }}
              >
                <td className="py-2 pr-4 font-medium">
                  <div className="flex items-center gap-1.5">
                    <span>{r.name}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                  </div>
                </td>
                {STATUS_BUCKETS.map((s) => (
                  <td key={s} className="py-2 pr-4 text-right tabular-nums">
                    {r[s] === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      // Stop the row click from firing when a number is
                      // clicked directly: the number is a finer-grained
                      // drill-through to (assignee × status) in Roster.
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          jumpTo("roster", { assignee: r.name, status: s })
                        }}
                        className={`hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${STATUS_COLORS[s].text}`}
                        aria-label={`View ${r.name}'s ${s} items (${r[s]})`}
                      >
                        {r[s]}
                      </button>
                    )}
                  </td>
                ))}
                <td className="py-2 pr-4 text-right tabular-nums font-semibold">{r.total}</td>
                <td className="py-2 pl-4">
                  <Progress value={(r.total / maxTotal) * 100} className="h-1.5" />
                </td>
              </tr>
            ))}
            <tr className="border-t-2 font-semibold bg-muted/30">
              <td className="py-2 pr-4">TOTAL</td>
              {STATUS_BUCKETS.map((s) => (
                <td key={s} className="py-2 pr-4 text-right tabular-nums">
                  {totals[s]}
                </td>
              ))}
              <td className="py-2 pr-4 text-right tabular-nums">{totals.total}</td>
              <td className="py-2 pl-4" />
            </tr>
          </tbody>
        </table>
      </div>
    </ExpandableCard>
  )
}
