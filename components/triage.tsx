"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Mail,
  Bell,
  Clock,
  User,
  FileText,
  MoreHorizontal,
  Search,
  Archive,
  UserPlus,
  Star,
  Trash2,
  Inbox,
} from "lucide-react"

interface TriageItem {
  id: string
  type: "email" | "notification" | "work_item" | "timesheet" | "comment"
  subject: string
  from: string
  client?: string
  timestamp: string
  priority: "high" | "medium" | "low"
  isRead: boolean
  isStarred: boolean
  content: string
  assignee?: string
}

export function Triage() {
  const [items, setItems] = useState<TriageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [filter, setFilter] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    fetchTriageItems()
  }, [])

  const fetchTriageItems = async () => {
    try {
      const [notificationsRes, workItemsRes] = await Promise.all([
        fetch("/api/notifications"),
        fetch("/api/supabase/work-items?status=active&limit=20"),
      ])

      const notifications = notificationsRes.ok ? await notificationsRes.json() : []
      const workItems = workItemsRes.ok ? await workItemsRes.json() : { workItems: [] }

      // Map notifications to triage items
      const notificationItems: TriageItem[] =
        notifications.notifications?.map((n: any) => ({
          id: n.id,
          type: "notification" as const,
          subject: n.title,
          from: n.created_by || "System",
          timestamp: formatTimestamp(n.created_at),
          priority: n.priority || "medium",
          isRead: n.is_read,
          isStarred: false,
          content: n.message,
        })) || []

      // Map work items to triage items
      const workItemItems: TriageItem[] =
        workItems.workItems?.map((w: any) => ({
          id: w.id,
          type: "work_item" as const,
          subject: w.title,
          from: w.assigned_to_name || "Unassigned",
          client: w.client_name || w.organization_name,
          timestamp: formatTimestamp(w.created_at),
          priority: determinePriority(w.due_date, w.status),
          isRead: true,
          isStarred: false,
          content: w.description || w.notes || "",
          assignee: w.assigned_to_name,
        })) || []

      setItems([...notificationItems, ...workItemItems])
    } catch (error) {
      console.error("Error fetching triage items:", error)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const formatTimestamp = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffHours < 1) return "Just now"
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`
    if (diffDays === 1) return "1 day ago"
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  const determinePriority = (dueDate: string | null, status: string): "high" | "medium" | "low" => {
    if (!dueDate) return "medium"
    const due = new Date(dueDate)
    const now = new Date()
    const daysUntilDue = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    if (daysUntilDue < 0) return "high"
    if (daysUntilDue <= 3) return "high"
    if (daysUntilDue <= 7) return "medium"
    return "low"
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "email":
        return <Mail className="h-4 w-4" />
      case "notification":
        return <Bell className="h-4 w-4" />
      case "work_item":
        return <FileText className="h-4 w-4" />
      case "timesheet":
        return <Clock className="h-4 w-4" />
      case "comment":
        return <User className="h-4 w-4" />
      default:
        return <FileText className="h-4 w-4" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-red-100 text-red-800 border-red-200"
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-200"
      case "low":
        return "bg-green-100 text-green-800 border-green-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.client?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesFilter =
      filter === "all" ||
      (filter === "unread" && !item.isRead) ||
      (filter === "emails" && item.type === "email") ||
      (filter === "notifications" && item.type === "notification") ||
      (filter === "starred" && item.isStarred)

    return matchesSearch && matchesFilter
  })

  const handleSelectItem = (itemId: string) => {
    setSelectedItems((prev) => (prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]))
  }

  const handleSelectAll = () => {
    setSelectedItems(selectedItems.length === filteredItems.length ? [] : filteredItems.map((item) => item.id))
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Triage</h1>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Triage</h1>
          <p className="text-gray-600">Centralized inbox for notifications and work items</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={selectedItems.length === 0}>
            <Archive className="h-4 w-4 mr-2" />
            Archive Selected
          </Button>
          <Button size="sm" disabled={selectedItems.length === 0}>
            <UserPlus className="h-4 w-4 mr-2" />
            Assign
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search notifications and work items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unread">Unread</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
                <TabsTrigger value="starred">Starred</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Triage List */}
      <Card>
        <CardContent className="p-0">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <Inbox className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">No items found</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-4 hover:bg-gray-50 transition-colors ${!item.isRead ? "bg-blue-50/30" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedItems.includes(item.id)}
                      onCheckedChange={() => handleSelectItem(item.id)}
                      className="mt-1"
                    />
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100">
                      {getTypeIcon(item.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className={`font-medium text-sm ${!item.isRead ? "font-semibold" : ""}`}>{item.subject}</h4>
                        <Badge variant="outline" className={getPriorityColor(item.priority)}>
                          {item.priority}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        From: {item.from}
                        {item.client && ` • Client: ${item.client}`}
                        {item.assignee && ` • Assigned: ${item.assignee}`}
                      </p>
                      <p className="text-sm text-gray-500 line-clamp-1">{item.content}</p>
                      <p className="text-xs text-gray-400 mt-1">{item.timestamp}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Star className="h-4 w-4 mr-2" />
                          Star
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Archive className="h-4 w-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
