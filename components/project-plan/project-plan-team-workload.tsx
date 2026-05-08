"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useKarbonWorkItems } from "@/contexts/karbon-work-items-context"
import {
  bucketStatus,
  getAssigneeLabel,
  STATUS_BUCKETS,
  STATUS_COLORS,
  type StatusBucket,
} from "./project-plan-shared"
import { Loader2 } from "lucide-react"

// Mirrors the "Team Workload" tab in the FY2026 project-plan workbook:
// each row = one team member, columns = the five Karbon status buckets,
// plus an "Active" total (we already exclude completed items via the
// `activeWorkItems` selector on the context).
export function ProjectPlanTeamWorkload() {
  const { activeWorkItems, isLoading } = useKarbonWorkItems()

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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Team Workload</CardTitle>
        <CardDescription>
          {rows.length} team member{rows.length === 1 ? "" : "s"} carrying {totals.total} active
          work items
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                <tr key={r.name} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="py-2 pr-4 font-medium">{r.name}</td>
                  {STATUS_BUCKETS.map((s) => (
                    <td key={s} className="py-2 pr-4 text-right tabular-nums">
                      {r[s] === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={STATUS_COLORS[s].text}>{r[s]}</span>
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
      </CardContent>
    </Card>
  )
}
