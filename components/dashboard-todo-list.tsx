"use client"

import { useMemo, useState, useCallback } from "react"
import useSWR from "swr"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  GripVertical,
  Plus,
  Search,
  Trash2,
  User,
} from "lucide-react"
import { useUser } from "@/contexts/user-context"
import { cn } from "@/lib/utils"
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface UserTask {
  id: string
  title: string
  description: string | null
  priority: string
  due_date: string | null
  is_completed: boolean
  completed_at: string | null
  assignee_id: string | null
  assignee_name: string | null
  sort_order: number
  contact_id: string | null
  contact_name: string | null
  organization_id: string | null
  organization_name: string | null
  intake_submission_id: string | null
  intake_name: string | null
  proposal_id: string | null
  proposal_name: string | null
  karbon_work_item_id: string | null
  created_at: string
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Sortable Task Item Component
// ─────────────────────────────────────────────────────────────────────────────

interface SortableTaskItemProps {
  task: UserTask
  onToggleComplete: (task: UserTask) => void
  onDelete: (taskId: string) => void
}

function SortableTaskItem({ task, onToggleComplete, onDelete }: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const linkedEntity = task.organization_name || task.contact_name || task.intake_name || task.proposal_name

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "p-4 transition-colors hover:bg-muted/30",
        task.is_completed && "opacity-60",
        isOverdue(task.due_date) && !task.is_completed && "border-l-4 border-l-rose-500",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <div className="flex items-start gap-3">
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="pt-0.5">
          <Checkbox
            checked={task.is_completed}
            onCheckedChange={() => onToggleComplete(task)}
            className={task.is_completed ? "opacity-60" : ""}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={cn(
              "text-sm font-medium",
              task.is_completed && "line-through text-muted-foreground"
            )}>
              {task.title || "Untitled task"}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Badge 
                variant="outline" 
                className={cn("text-xs", getPriorityColor(task.priority))}
              >
                {task.priority}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(task.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          
          {task.description && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {task.description}
            </p>
          )}
          
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {task.due_date && (
              <span className={cn(
                "flex items-center gap-1",
                isOverdue(task.due_date) && !task.is_completed && "text-rose-600 font-medium",
                isDueToday(task.due_date) && !task.is_completed && "text-amber-600 font-medium",
                isDueSoon(task.due_date) && !task.is_completed && "text-amber-600"
              )}>
                <Calendar className="h-3 w-3" />
                {isOverdue(task.due_date) && !task.is_completed ? "Overdue: " : ""}
                {isDueToday(task.due_date) ? "Today" : formatDate(task.due_date)}
              </span>
            )}
            {linkedEntity && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {linkedEntity}
              </span>
            )}
            {task.karbon_work_item_id && (
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {task.karbon_work_item_id}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardTodoList() {
  const { teamMember } = useUser()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "mine" | "overdue">("mine")
  const [showCompleted, setShowCompleted] = useState(false)
  const [activeTab, setActiveTab] = useState("my-tasks")

  // Fetch user-created tasks
  const { 
    data: tasksData, 
    isLoading: tasksLoading, 
    mutate: mutateTasks 
  } = useSWR<{ tasks: UserTask[] }>(
    `/api/tasks?include_completed=${showCompleted}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  // Fetch debriefs with action items
  const { data: debriefsData, isLoading: debriefsLoading } = useSWR<{ debriefs: DebriefWithItems[] }>(
    "/api/debriefs?has_action_items=true&limit=100",
    fetcher,
    { revalidateOnFocus: false }
  )

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Transform debriefs into flat action items list
  const actionItems = useMemo(() => {
    if (!debriefsData?.debriefs) return []
    
    const items: ActionItem[] = []
    for (const debrief of debriefsData.debriefs) {
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
  }, [debriefsData])

  // Filter user tasks
  const filteredTasks = useMemo(() => {
    let tasks = tasksData?.tasks || []

    if (!showCompleted) {
      tasks = tasks.filter((t) => !t.is_completed)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      tasks = tasks.filter((t) =>
        t.title?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.organization_name?.toLowerCase().includes(q) ||
        t.contact_name?.toLowerCase().includes(q)
      )
    }

    return tasks.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }, [tasksData, search, showCompleted])

  // Filter action items
  const filteredActionItems = useMemo(() => {
    let items = actionItems

    if (!showCompleted) {
      items = items.filter((item) => !item.is_completed)
    }

    if (filter === "mine" && teamMember?.full_name) {
      items = items.filter((item) => 
        item.assignee_name?.toLowerCase() === teamMember.full_name?.toLowerCase()
      )
    } else if (filter === "overdue") {
      items = items.filter((item) => isOverdue(item.due_date) && !item.is_completed)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((item) =>
        item.description?.toLowerCase().includes(q) ||
        item.assignee_name?.toLowerCase().includes(q) ||
        item.organization_name?.toLowerCase().includes(q) ||
        item.contact_full_name?.toLowerCase().includes(q)
      )
    }

    return items.sort((a, b) => {
      if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
      const aOverdue = isOverdue(a.due_date)
      const bOverdue = isOverdue(b.due_date)
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      }
      if (a.due_date) return -1
      if (b.due_date) return 1
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1) -
             (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1)
    })
  }, [actionItems, filter, search, showCompleted, teamMember])

  // Stats
  const stats = useMemo(() => {
    const myName = teamMember?.full_name?.toLowerCase()
    const myActionItems = myName 
      ? actionItems.filter((i) => i.assignee_name?.toLowerCase() === myName && !i.is_completed)
      : []
    const overdueItems = actionItems.filter((i) => isOverdue(i.due_date) && !i.is_completed)
    const userTasksOpen = (tasksData?.tasks || []).filter((t) => !t.is_completed).length
    
    return {
      userTasks: userTasksOpen,
      actionItems: myActionItems.length,
      overdue: overdueItems.length,
      total: myActionItems.length + userTasksOpen,
    }
  }, [actionItems, tasksData, teamMember])

  // Handle drag end for reordering
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = filteredTasks.findIndex((t) => t.id === active.id)
    const newIndex = filteredTasks.findIndex((t) => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(filteredTasks, oldIndex, newIndex)
    
    // Optimistically update local state
    mutateTasks(
      { tasks: reordered.map((t, i) => ({ ...t, sort_order: i })) },
      false
    )

    // Persist to server
    try {
      await fetch("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: reordered.map((t, i) => ({ id: t.id, sort_order: i }))
        }),
      })
    } catch (err) {
      console.error("Failed to reorder tasks:", err)
      mutateTasks()
    }
  }, [filteredTasks, mutateTasks])

  // Toggle task completion
  const handleToggleComplete = useCallback(async (task: UserTask) => {
    const newCompleted = !task.is_completed
    
    mutateTasks(
      (data) => ({
        tasks: (data?.tasks || []).map((t) =>
          t.id === task.id ? { ...t, is_completed: newCompleted } : t
        ),
      }),
      false
    )

    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_completed: newCompleted }),
      })
    } catch (err) {
      console.error("Failed to update task:", err)
      mutateTasks()
    }
  }, [mutateTasks])

  // Delete task
  const handleDeleteTask = useCallback(async (taskId: string) => {
    mutateTasks(
      (data) => ({
        tasks: (data?.tasks || []).filter((t) => t.id !== taskId),
      }),
      false
    )

    try {
      await fetch(`/api/tasks/${taskId}`, { method: "DELETE" })
    } catch (err) {
      console.error("Failed to delete task:", err)
      mutateTasks()
    }
  }, [mutateTasks])

  // Handle new task created
  const handleTaskCreated = useCallback(() => {
    mutateTasks()
  }, [mutateTasks])

  const isLoading = tasksLoading || debriefsLoading

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-medium">My Tasks</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{stats.userTasks}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span className="text-xs font-medium">From Debriefs</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{stats.actionItems}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-rose-600">
            <AlertCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Overdue</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-rose-700">{stats.overdue}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-primary">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-medium">Total Open</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{stats.total}</p>
        </Card>
      </div>

      {/* Tabs for My Tasks vs Debrief Action Items */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="my-tasks" className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              My Tasks
              {stats.userTasks > 0 && (
                <Badge variant="secondary" className="ml-1">{stats.userTasks}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="debrief-items" className="gap-2">
              <FileText className="h-4 w-4" />
              From Debriefs
              {stats.actionItems > 0 && (
                <Badge variant="secondary" className="ml-1">{stats.actionItems}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
          
          {activeTab === "my-tasks" && (
            <TaskCreateDialog 
              onTaskCreated={handleTaskCreated}
              defaultAssigneeId={teamMember?.id}
            />
          )}
        </div>

        {/* Filters */}
        <Card className="p-4 mt-4">
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
            {activeTab === "debrief-items" && (
              <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mine">Assigned to Me</SelectItem>
                  <SelectItem value="all">All Tasks</SelectItem>
                  <SelectItem value="overdue">Overdue Only</SelectItem>
                </SelectContent>
              </Select>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={showCompleted}
                onCheckedChange={(v) => setShowCompleted(!!v)}
              />
              Show completed
            </label>
          </div>
        </Card>

        {/* My Tasks Tab */}
        <TabsContent value="my-tasks" className="mt-4 space-y-2">
          {filteredTasks.length === 0 ? (
            <Card className="p-8 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="mt-4 text-lg font-medium">No tasks yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first task to get started.
              </p>
              <div className="mt-4">
                <TaskCreateDialog 
                  onTaskCreated={handleTaskCreated}
                  defaultAssigneeId={teamMember?.id}
                  trigger={
                    <Button className="gap-2">
                      <Plus className="h-4 w-4" />
                      Add Task
                    </Button>
                  }
                />
              </div>
            </Card>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filteredTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {filteredTasks.map((task) => (
                  <SortableTaskItem
                    key={task.id}
                    task={task}
                    onToggleComplete={handleToggleComplete}
                    onDelete={handleDeleteTask}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </TabsContent>

        {/* Debrief Action Items Tab */}
        <TabsContent value="debrief-items" className="mt-4 space-y-2">
          {filteredActionItems.length === 0 ? (
            <Card className="p-8 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="mt-4 text-lg font-medium">All caught up!</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {filter === "mine" 
                  ? "You have no pending action items from debriefs."
                  : "No action items match your current filter."}
              </p>
            </Card>
          ) : (
            filteredActionItems.map((item) => (
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
