"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Inbox, FileText, Clock, ArrowRight, ExternalLink, AlertCircle } from "lucide-react"
import Link from "next/link"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"
import { ExpandableCard } from "@/components/ui/expandable-card"

interface WorkItem {
  WorkKey: string
  Title: string
  ClientName: string
  DueDate: string | null
  Priority: string
  PrimaryStatus: string
  AssignedTo: Array<{ FullName: string }>
  ModifiedDate: string
}

export function TriageSummary() {
  const [triageItems, setTriageItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchTriageItems() {
      try {
        const response = await fetch("/api/karbon/work-items")

        if (response.status === 401) {
          setError("Karbon API credentials not configured")
          setLoading(false)
          return
        }

        if (!response.ok) throw new Error("Failed to fetch work items")

        const data = await response.json()

        const now = new Date()
        const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

        const needsAttention = data.workItems.filter((item: WorkItem) => {
          const isDueSoon = item.DueDate && new Date(item.DueDate) <= threeDaysFromNow
          const isHighPriority = item.Priority === "High" || item.Priority === "Critical"
          const isInProgress = item.PrimaryStatus === "In Progress" || item.PrimaryStatus === "Ready To Start"

          return (isDueSoon || isHighPriority) && isInProgress
        })

        const sorted = needsAttention
          .sort((a: WorkItem, b: WorkItem) => {
            if (a.DueDate && b.DueDate) {
              return new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime()
            }
            if (a.DueDate) return -1
            if (b.DueDate) return 1

            const priorityOrder: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 }
            return (priorityOrder[a.Priority] || 2) - (priorityOrder[b.Priority] || 2)
          })
          .slice(0, 5)

        setTriageItems(sorted)
      } catch (err) {
        console.error("Error fetching triage items:", err)
        setError(err instanceof Error ? err.message : "Failed to fetch triage items")
      } finally {
        setLoading(false)
      }
    }

    fetchTriageItems()
  }, [])

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "Critical":
      case "High":
        return "bg-red-100 text-red-800 border-red-200"
      case "Normal":
        return "bg-yellow-100 text-yellow-800 border-yellow-200"
      case "Low":
        return "bg-green-100 text-green-800 border-green-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  const formatDueDate = (dueDate: string | null) => {
    if (!dueDate) return null

    const date = new Date(dueDate)
    const now = new Date()
    const diffTime = date.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 0) return { text: "Overdue", color: "text-red-600" }
    if (diffDays === 0) return { text: "Due today", color: "text-orange-600" }
    if (diffDays === 1) return { text: "Due tomorrow", color: "text-orange-600" }
    if (diffDays <= 3) return { text: `Due in ${diffDays} days`, color: "text-yellow-600" }

    return { text: date.toLocaleDateString(), color: "text-gray-600" }
  }

  if (loading) {
    return (
      <ExpandableCard
        title="Karbon Triage"
        icon={<Inbox className="h-5 w-5 text-emerald-600" />}
        description="Loading items that need attention..."
        defaultExpanded={true}
      >
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-16 bg-gray-100 rounded-lg"></div>
            </div>
          ))}
        </div>
      </ExpandableCard>
    )
  }

  if (error) {
    return (
      <ExpandableCard
        title="Karbon Triage"
        icon={<Inbox className="h-5 w-5 text-emerald-600" />}
        description="Items that need your attention"
        defaultExpanded={true}
      >
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </ExpandableCard>
    )
  }

  return (
    <ExpandableCard
      title="Karbon Triage"
      icon={<Inbox className="h-5 w-5 text-emerald-600" />}
      description="Items that need your attention"
      defaultExpanded={true}
      actions={
        <Link href="/triage">
          <Button variant="outline" size="sm">
            View All
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      }
    >
      {triageItems.length === 0 ? (
        <div className="text-center py-8">
          <Inbox className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">No urgent items at the moment</p>
          <p className="text-sm text-gray-500 mt-1">You're all caught up!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {triageItems.map((item) => {
            const dueDateInfo = formatDueDate(item.DueDate)

            return (
              <a
                key={item.WorkKey}
                href={getKarbonWorkItemUrl(item.WorkKey)}
                target="_blank"
                rel="noopener noreferrer"
                className="block border border-gray-200 rounded-lg p-3 hover:border-emerald-300 hover:bg-emerald-50/30 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-1">
                    <FileText className="h-4 w-4 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={getPriorityColor(item.Priority)}>
                        {item.Priority}
                      </Badge>
                      {dueDateInfo && (
                        <span className={`text-xs font-medium ${dueDateInfo.color} flex items-center gap-1`}>
                          <Clock className="h-3 w-3" />
                          {dueDateInfo.text}
                        </span>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {item.PrimaryStatus}
                      </Badge>
                    </div>
                    <h4 className="font-medium text-sm text-gray-900 line-clamp-1 flex items-center gap-2">
                      {item.Title}
                      <ExternalLink className="h-3 w-3 text-gray-400" />
                    </h4>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
                      <span>{item.ClientName}</span>
                      {item.AssignedTo.length > 0 && (
                        <>
                          <span>•</span>
                          <span>{item.AssignedTo[0].FullName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </ExpandableCard>
  )
}
