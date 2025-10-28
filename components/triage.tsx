"use client"

import { useState } from "react"
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
  Calendar,
  Flag,
  Star,
  Reply,
  Forward,
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

const mockTriageItems: TriageItem[] = [
  {
    id: "1",
    type: "email",
    subject: "Q4 Tax Planning Documents Required",
    from: "sarah.johnson@techcorp.com",
    client: "TechCorp Solutions",
    timestamp: "2 hours ago",
    priority: "high",
    isRead: false,
    isStarred: true,
    content: "Hi team, we need to finalize the Q4 tax planning documents for our review meeting next week...",
    assignee: "Michael Chen",
  },
  {
    id: "2",
    type: "notification",
    subject: "New client onboarding started",
    from: "Karbon System",
    client: "Green Valley Enterprises",
    timestamp: "4 hours ago",
    priority: "medium",
    isRead: false,
    isStarred: false,
    content: "Green Valley Enterprises has been added to the onboarding pipeline. Initial documents received.",
  },
  {
    id: "3",
    type: "work_item",
    subject: "Monthly bookkeeping review due",
    from: "Lisa Rodriguez",
    client: "Coastal Retail Group",
    timestamp: "6 hours ago",
    priority: "medium",
    isRead: true,
    isStarred: false,
    content: "Monthly reconciliation and financial statements need review before client meeting.",
    assignee: "David Park",
  },
  {
    id: "4",
    type: "email",
    subject: "Urgent: Payroll processing question",
    from: "hr@manufacturingplus.com",
    client: "Manufacturing Plus Inc",
    timestamp: "1 day ago",
    priority: "high",
    isRead: false,
    isStarred: false,
    content: "We have a question about the new employee payroll setup that needs immediate attention...",
  },
  {
    id: "5",
    type: "comment",
    subject: "Comment on Financial Advisory Project",
    from: "Jennifer Walsh",
    client: "Riverside Investments",
    timestamp: "1 day ago",
    priority: "low",
    isRead: true,
    isStarred: false,
    content: "Added notes to the investment portfolio analysis. Please review when convenient.",
    assignee: "Sarah Kim",
  },
]

export function Triage() {
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [filter, setFilter] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")

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

  const filteredItems = mockTriageItems.filter((item) => {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Triage</h1>
          <p className="text-gray-600">Centralized inbox for emails, notifications, and work items</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Archive className="h-4 w-4 mr-2" />
            Archive Selected
          </Button>
          <Button size="sm">
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
                placeholder="Search emails, notifications, and work items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Tabs value={filter} onValueChange={setFilter} className="w-auto">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unread">Unread</TabsTrigger>
                <TabsTrigger value="emails">Emails</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
                <TabsTrigger value="starred">Starred</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedItems.length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-emerald-800">
                {selectedItems.length} item{selectedItems.length > 1 ? "s" : ""} selected
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm">
                  <Archive className="h-4 w-4 mr-2" />
                  Archive
                </Button>
                <Button variant="outline" size="sm">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Assign
                </Button>
                <Button variant="outline" size="sm">
                  <Flag className="h-4 w-4 mr-2" />
                  Set Priority
                </Button>
                <Button variant="outline" size="sm">
                  <Calendar className="h-4 w-4 mr-2" />
                  Schedule
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Triage Items */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-4">
          <Checkbox
            checked={selectedItems.length === filteredItems.length && filteredItems.length > 0}
            onCheckedChange={handleSelectAll}
          />
          <span className="text-sm text-gray-600">
            {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
          </span>
        </div>

        {filteredItems.map((item) => (
          <Card
            key={item.id}
            className={`transition-all hover:shadow-md ${!item.isRead ? "border-l-4 border-l-emerald-500 bg-emerald-50/30" : ""}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Checkbox checked={selectedItems.includes(item.id)} onCheckedChange={() => handleSelectItem(item.id)} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(item.type)}
                      <Badge variant="outline" className={getPriorityColor(item.priority)}>
                        {item.priority}
                      </Badge>
                      <Badge variant="secondary" className="capitalize">
                        {item.type.replace("_", " ")}
                      </Badge>
                      {item.isStarred && <Star className="h-4 w-4 text-yellow-500 fill-current" />}
                    </div>
                    <span className="text-sm text-gray-500 ml-auto">{item.timestamp}</span>
                  </div>

                  <div className="space-y-1">
                    <h3 className={`font-medium ${!item.isRead ? "font-semibold" : ""}`}>{item.subject}</h3>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span>From: {item.from}</span>
                      {item.client && <span>Client: {item.client}</span>}
                      {item.assignee && <span>Assigned to: {item.assignee}</span>}
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">{item.content}</p>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <Reply className="h-4 w-4 mr-2" />
                      Reply
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Forward className="h-4 w-4 mr-2" />
                      Forward
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Assign
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Calendar className="h-4 w-4 mr-2" />
                      Add to Timeline
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Archive className="h-4 w-4 mr-2" />
                      Archive
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredItems.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Inbox className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No items found</h3>
            <p className="text-gray-600">
              {searchQuery ? "Try adjusting your search terms" : "Your triage inbox is empty"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
