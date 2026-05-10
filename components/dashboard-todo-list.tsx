"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Search,
  User,
} from "lucide-react"
import { useUser } from "@/contexts/user-context"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ActionItem {
  id: string
  description: string
  assignee_name: string
  assignee_id?: string
  due_date: string | null
  priority: string
  is_completed?: boolean
  debrief_id: string
  debrief_date: string | null
  debrief_type: string | null
  organization_name: string | null
  contact_full_name: string | null
  created_by_name: string | null
}

interface DebriefWithItems {
  id: string
  debrief_date: string | null
  debrief_type: string | null
  organization_name: string | null
  organization_display_name: string | null
  contact_full_name: string | null
  action_items: { items?: Array<{
    description: string
    assignee_name: string
    assignee_id?: string
    due_date: string | null
    priority: string
    is_completed?: boolean
  }> } | null
  team_member_full_name: string | null
  created_by_full_name: string | null
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ""
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false
  const due = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}

function isDueToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  const due = new Date(dateStr)
  const today = new Date()
  return due.toDateString() === today.toDateString()
}

function isDueSoon(dateStr: string | null): boolean {
  if (!dateStr) return false
  const due = new Date(dateStr)
  const today = new Date()
  const threeDaysFromNow = new Date(today)
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)
  return due > today && due <= threeDaysFromNow
}

function getPriorityColor(priority: string) {
  switch (priority?.toLowerCase()) {
    case "high":
      return "bg-rose-100 text-rose-800 border-rose-200"
    case "medium":
      return "bg-amber-100 text-amber-800 border-amber-200"
    case "low":
      return "bg-emerald-100 text-emerald-800 border-emerald-200"
    default:
      return "bg-stone-100 text-stone-700 border-stone-200"
  }
}

export function DashboardTodoList() {
  const { teamMember } = useUser()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "mine" | "overdue">("mine")
  const [showCompleted, setShowCompleted] = useState(false)

  // Fetch debriefs that have action items
  const { data, isLoading, error, mutate } = useSWR<{ debriefs: DebriefWithItems[] }>(
    "/api/debriefs?has_action_items=true&limit=100",
    fetcher,
    { revalidateOnFocus: false }
  )

  // Transform debriefs into flat action items list
  const actionItems = useMemo(() => {
    if (!data?.debriefs) return []
    
    const items: ActionItem[] = []
    for (const debrief of data.debriefs) {
      const debriefItems = debrief.action_items?.items ?? []
      for (let i = 0; i < debriefItems.length; i++) {
        const item = debriefItems[i]
        items.push({
          id: `${debrief.id}-${i}`,
          description: item.description || "",
          assignee_name: item.assignee_name || "",
          assignee_id: item.assignee_id,
          due_date: item.due_date || null,
          priority: item.priority || "medium",
          is_completed: item.is_completed || false,
          debrief_id: debrief.id,
          debrief_date: debrief.debrief_date,
          debrief_type: debrief.debrief_type,
          organization_name: debrief.organization_display_name || debrief.organization_name,
          contact_full_name: debrief.contact_full_name,
          created_by_name: debrief.created_by_full_name || debrief.team_member_full_name,
        })
      }
    }
    return items
  }, [data])

  // Filter and sort action items
  const filteredItems = useMemo(() => {
    let items = actionItems

    // Filter by completion status
    if (!showCompleted) {
      items = items.filter((item) => !item.is_completed)
    }

    // Filter by assignment
    if (filter === "mine" && teamMember?.full_name) {
      items = items.filter((item) => 
        item.assignee_name?.toLowerCase() === teamMember.full_name?.toLowerCase()
      )
    } else if (filter === "overdue") {
      items = items.filter((item) => isOverdue(item.due_date) && !item.is_completed)
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((item) =>
        item.description?.toLowerCase().includes(q) ||
        item.assignee_name?.toLowerCase().includes(q) ||
        item.organization_name?.toLowerCase().includes(q) ||
        item.contact_full_name?.toLowerCase().includes(q)
      )
    }

    // Sort: overdue first, then by due date, then by priority
    return items.sort((a, b) => {
      // Completed items last
      if (a.is_completed !== b.is_completed) {
        return a.is_completed ? 1 : -1
      }
      // Overdue items first
      const aOverdue = isOverdue(a.due_date)
      const bOverdue = isOverdue(b.due_date)
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
      // Then by due date
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      }
      if (a.due_date) return -1
      if (b.due_date) return 1
      // Then by priority
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1) -
             (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1)
    })
  }, [actionItems, filter, search, showCompleted, teamMember])

  // Stats
  const stats = useMemo(() => {
    const myName = teamMember?.full_name?.toLowerCase()
    const myItems = myName 
      ? actionItems.filter((i) => i.assignee_name?.toLowerCase() === myName && !i.is_completed)
      : []
    const overdueItems = actionItems.filter((i) => isOverdue(i.due_date) && !i.is_completed)
    const dueTodayItems = actionItems.filter((i) => isDueToday(i.due_date) && !i.is_completed)
    
    return {
      total: actionItems.filter((i) => !i.is_completed).length,
      mine: myItems.length,
      overdue: overdueItems.length,
      dueToday: dueTodayItems.length,
    }
  }, [actionItems, teamMember])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="flex items-center gap-3 border-rose-200 bg-rose-50 p-4">
        <AlertCircle className="h-5 w-5 text-rose-600" />
        <p className="text-sm text-rose-800">Failed to load action items</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card 
          className={cn(
            "p-4 cursor-pointer transition-colors",
            filter === "mine" && "ring-2 ring-primary"
          )}
          onClick={() => setFilter("mine")}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="text-xs font-medium">My Tasks</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{stats.mine}</p>
        </Card>
        <Card 
          className={cn(
            "p-4 cursor-pointer transition-colors",
            filter === "overdue" && "ring-2 ring-primary"
          )}
          onClick={() => setFilter("overdue")}
        >
          <div className="flex items-center gap-2 text-rose-600">
            <AlertCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Overdue</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-rose-700">{stats.overdue}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-amber-600">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-medium">Due Today</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-amber-700">{stats.dueToday}</p>
        </Card>
        <Card 
          className={cn(
            "p-4 cursor-pointer transition-colors",
            filter === "all" && "ring-2 ring-primary"
          )}
          onClick={() => setFilter("all")}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span className="text-xs font-medium">All Open</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{stats.total}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">My Tasks</SelectItem>
              <SelectItem value="all">All Tasks</SelectItem>
              <SelectItem value="overdue">Overdue Only</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={showCompleted}
              onCheckedChange={(v) => setShowCompleted(!!v)}
            />
            Show completed
          </label>
        </div>
      </Card>

      {/* Action items list */}
      <div className="space-y-2">
        {filteredItems.length === 0 ? (
          <Card className="p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h3 className="mt-4 text-lg font-medium">All caught up!</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === "mine" 
                ? "You have no pending action items."
                : "No action items match your current filter."}
            </p>
          </Card>
        ) : (
          filteredItems.map((item) => (
            <Card
              key={item.id}
              className={cn(
                "p-4 transition-colors hover:bg-muted/30",
                item.is_completed && "opacity-60",
                isOverdue(item.due_date) && !item.is_completed && "border-l-4 border-l-rose-500"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="pt-0.5">
                  <Checkbox
                    checked={item.is_completed}
                    disabled
                    className={item.is_completed ? "opacity-60" : ""}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn(
                      "text-sm font-medium",
                      item.is_completed && "line-through text-muted-foreground"
                    )}>
                      {item.description || "Untitled task"}
                    </p>
                    <Badge 
                      variant="outline" 
                      className={cn("shrink-0 text-xs", getPriorityColor(item.priority))}
                    >
                      {item.priority}
                    </Badge>
                  </div>
                  
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {item.assignee_name && (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {item.assignee_name}
                      </span>
                    )}
                    {item.due_date && (
                      <span className={cn(
                        "flex items-center gap-1",
                        isOverdue(item.due_date) && !item.is_completed && "text-rose-600 font-medium",
                        isDueToday(item.due_date) && !item.is_completed && "text-amber-600 font-medium",
                        isDueSoon(item.due_date) && !item.is_completed && "text-amber-600"
                      )}>
                        <Calendar className="h-3 w-3" />
                        {isOverdue(item.due_date) && !item.is_completed ? "Overdue: " : ""}
                        {isDueToday(item.due_date) ? "Today" : formatDate(item.due_date)}
                      </span>
                    )}
                    {(item.organization_name || item.contact_full_name) && (
                      <span className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3" />
                        {item.organization_name || item.contact_full_name}
                      </span>
                    )}
                  </div>

                  {item.debrief_type && (
                    <div className="mt-2">
                      <Badge variant="secondary" className="text-xs">
                        {item.debrief_type.replace(/_/g, " ")}
                        {item.debrief_date && ` · ${formatDate(item.debrief_date)}`}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
