"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  FileText,
  MessageSquare,
  User,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Send,
  Tag,
  AlertCircle,
  Clock,
  Loader2,
  Bell,
  CheckCircle2,
  LinkIcon,
  RefreshCw,
} from "lucide-react"
import { useUser } from "@/contexts/user-context"
import { formatDistanceToNow } from "date-fns"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface ActionItem {
  id: string
  description: string
  assignee_id?: string
  assignee_name?: string
  due_date?: string
  status?: string
}

interface DebriefComment {
  id: string
  author_id: string
  author_name: string
  content: string
  created_at: string
}

interface Debrief {
  id: string
  debrief_date: string
  notes: string
  team_member: string
  created_by_id: string
  contact_id: string | null
  organization_id: string | null
  work_item_id: string | null
  organization_name: string | null
  karbon_client_key: string | null
  karbon_work_url: string | null
  status: string
  debrief_type: string
  action_items: {
    items?: ActionItem[]
    related_clients?: { id: string; name: string; type: string }[]
    related_work_items?: { id: string; title: string }[]
  } | null
  follow_up_date: string | null
  created_at: string
  // Joined data
  contact?: { full_name: string } | null
  organization?: { name: string } | null
  work_item?: { title: string } | null
  comments?: DebriefComment[]
}

interface Client {
  id: string
  name: string
  type: "contact" | "organization"
}

interface WorkItem {
  id: string
  title: string
  karbon_work_item_key: string
}

export function ClientServiceDebriefs() {
  const { teamMember } = useUser()
  const [debriefs, setDebriefs] = useState<Debrief[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [commentText, setCommentText] = useState<Record<string, string>>({})
  const [isSubmittingComment, setIsSubmittingComment] = useState<string | null>(null)

  // Tag dialog state
  const [tagDialogOpen, setTagDialogOpen] = useState<string | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [selectedClient, setSelectedClient] = useState<string>("")
  const [selectedWorkItem, setSelectedWorkItem] = useState<string>("")
  const [isTagging, setIsTagging] = useState(false)

  useEffect(() => {
    fetchDebriefs()
    fetchClientsAndWorkItems()
  }, [])

  async function fetchDebriefs() {
    setError(null)
    setIsLoading(true)
    try {
      const response = await fetch("/api/supabase/debriefs?limit=20")

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to fetch debriefs")
      }

      const { debriefs: data } = await response.json()

      // Add empty comments array (comments will be enabled after running migration)
      const debrifsWithComments =
        data?.map((d: Debrief) => ({
          ...d,
          comments: [],
        })) || []

      setDebriefs(debrifsWithComments)
    } catch (err) {
      console.error("Error fetching debriefs:", err)
      setError("Unable to load debriefs from database. Please check your connection and try again.")
    } finally {
      setIsLoading(false)
    }
  }

  async function fetchClientsAndWorkItems() {
    try {
      const response = await fetch("/api/supabase/clients")
      if (!response.ok) {
        throw new Error("Failed to fetch clients and work items")
      }
      const { clients: clientList, workItems: items } = await response.json()
      setClients(clientList || [])
      setWorkItems(items || [])
    } catch (error) {
      console.error("Error fetching clients/work items:", error)
    }
  }

  async function handleAddComment(debriefId: string) {
    const text = commentText[debriefId]?.trim()
    if (!text || !teamMember) return

    setIsSubmittingComment(debriefId)
    try {
      const response = await fetch("/api/debriefs/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debrief_id: debriefId,
          author_id: teamMember.id,
          author_name: teamMember.full_name || `${teamMember.first_name} ${teamMember.last_name}`,
          content: text,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 404) {
          alert(
            "Comments feature is not available yet. Please run the migration script: scripts/create-debrief-comments-table.sql",
          )
          return
        }
        throw new Error(data.error || "Failed to add comment")
      }

      // Update local state
      setDebriefs((prev) =>
        prev.map((d) => {
          if (d.id === debriefId) {
            return {
              ...d,
              comments: [...(d.comments || []), data],
            }
          }
          return d
        }),
      )

      setCommentText((prev) => ({ ...prev, [debriefId]: "" }))
    } catch (error) {
      console.error("Error adding comment:", error)
    } finally {
      setIsSubmittingComment(null)
    }
  }

  async function handleTagDebrief(debriefId: string) {
    if (!selectedClient && !selectedWorkItem) return

    setIsTagging(true)
    try {
      const client = clients.find((c) => c.id === selectedClient)

      const response = await fetch("/api/supabase/debriefs/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debriefId,
          contactId: client?.type === "contact" ? selectedClient : null,
          organizationId: client?.type === "organization" ? selectedClient : null,
          workItemId: selectedWorkItem || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to tag debrief")
      }

      // Refresh debriefs
      await fetchDebriefs()
      setTagDialogOpen(null)
      setSelectedClient("")
      setSelectedWorkItem("")
    } catch (error) {
      console.error("Error tagging debrief:", error)
    } finally {
      setIsTagging(false)
    }
  }

  function getInitials(name: string): string {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  function getClientName(debrief: Debrief): string {
    if (debrief.contact?.full_name) return debrief.contact.full_name
    if (debrief.organization?.name) return debrief.organization.name
    if (debrief.organization_name) return debrief.organization_name
    return "Untagged Client"
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Client Service Updates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Client Service Updates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error Loading Debriefs</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button variant="outline" className="mt-4 bg-transparent" onClick={fetchDebriefs}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Client Service Updates
            </CardTitle>
            <CardDescription>Recent debriefs and client interactions from your team</CardDescription>
          </div>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Bell className="h-3 w-3" />
            {debriefs.length} New
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {debriefs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p>No recent debriefs</p>
          </div>
        ) : (
          <div className="space-y-4">
            {debriefs.map((debrief) => (
              <div key={debrief.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-blue-100 text-blue-700">
                        {getInitials(debrief.team_member || "TM")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-gray-900">{debrief.team_member || "Team Member"}</p>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(debrief.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={debrief.status === "completed" ? "default" : "secondary"}
                      className={debrief.status === "completed" ? "bg-green-100 text-green-700" : ""}
                    >
                      {debrief.status}
                    </Badge>
                    <Badge variant="outline">{debrief.debrief_type || "meeting"}</Badge>
                  </div>
                </div>

                {/* Client & Work Item Tags */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {debrief.contact_id || debrief.organization_id ? (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {getClientName(debrief)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="flex items-center gap-1 text-orange-600 border-orange-200">
                      <AlertCircle className="h-3 w-3" />
                      No Client Tagged
                    </Badge>
                  )}

                  {debrief.work_item_id && debrief.work_item ? (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Briefcase className="h-3 w-3" />
                      {debrief.work_item.title}
                    </Badge>
                  ) : null}

                  {/* Tag Button */}
                  <Dialog
                    open={tagDialogOpen === debrief.id}
                    onOpenChange={(open) => setTagDialogOpen(open ? debrief.id : null)}
                  >
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                        <Tag className="h-3 w-3 mr-1" />
                        Tag
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Tag Debrief</DialogTitle>
                        <DialogDescription>Link this debrief to a client and/or work item</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Client</Label>
                          <Select value={selectedClient} onValueChange={setSelectedClient}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a client..." />
                            </SelectTrigger>
                            <SelectContent>
                              {clients.map((client) => (
                                <SelectItem key={client.id} value={client.id}>
                                  <div className="flex items-center gap-2">
                                    <User className="h-3 w-3" />
                                    {client.name}
                                    <Badge variant="outline" className="text-xs ml-1">
                                      {client.type}
                                    </Badge>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Work Item</Label>
                          <Select value={selectedWorkItem} onValueChange={setSelectedWorkItem}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a work item..." />
                            </SelectTrigger>
                            <SelectContent>
                              {workItems.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  <div className="flex items-center gap-2">
                                    <Briefcase className="h-3 w-3" />
                                    {item.title}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          className="w-full"
                          onClick={() => handleTagDebrief(debrief.id)}
                          disabled={isTagging || (!selectedClient && !selectedWorkItem)}
                        >
                          {isTagging ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <LinkIcon className="h-4 w-4 mr-2" />
                          )}
                          Save Tags
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>

                {/* Notes Preview */}
                <div className="mt-3">
                  <p className={`text-sm text-gray-700 ${expandedId !== debrief.id ? "line-clamp-2" : ""}`}>
                    {debrief.notes || "No notes recorded."}
                  </p>
                </div>

                {/* Action Items (if any) */}
                {debrief.action_items?.items && debrief.action_items.items.length > 0 && (
                  <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <p className="text-xs font-medium text-amber-800 flex items-center gap-1 mb-2">
                      <AlertCircle className="h-3 w-3" />
                      Action Items ({debrief.action_items.items.length})
                    </p>
                    <ul className="space-y-1">
                      {debrief.action_items.items
                        .slice(0, expandedId === debrief.id ? undefined : 2)
                        .map((item, idx) => (
                          <li key={item.id || idx} className="text-sm text-amber-900 flex items-start gap-2">
                            <CheckCircle2 className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <span>
                              {item.description}
                              {item.assignee_name && (
                                <span className="text-amber-600 ml-1">— {item.assignee_name}</span>
                              )}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {/* Expand/Collapse */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full text-gray-500"
                  onClick={() => setExpandedId(expandedId === debrief.id ? null : debrief.id)}
                >
                  {expandedId === debrief.id ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-1" /> Show Less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-1" /> Show More
                    </>
                  )}
                </Button>

                {/* Expanded Content */}
                {expandedId === debrief.id && (
                  <div className="mt-4 border-t pt-4 space-y-4">
                    {/* Comments Section */}
                    <div>
                      <p className="text-sm font-medium text-gray-700 flex items-center gap-1 mb-3">
                        <MessageSquare className="h-4 w-4" />
                        Comments ({debrief.comments?.length || 0})
                      </p>

                      {/* Existing Comments */}
                      {debrief.comments && debrief.comments.length > 0 ? (
                        <div className="space-y-3 mb-4">
                          {debrief.comments.map((comment) => (
                            <div key={comment.id} className="flex items-start gap-2 bg-gray-50 p-3 rounded-lg">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="text-xs">{getInitials(comment.author_name)}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium">{comment.author_name}</p>
                                  <span className="text-xs text-gray-400">
                                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-700 mt-1">{comment.content}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 mb-4">No comments yet. Be the first to comment!</p>
                      )}

                      {/* Add Comment */}
                      <div className="flex items-start gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-blue-100 text-blue-700">
                            {teamMember
                              ? getInitials(teamMember.full_name || `${teamMember.first_name} ${teamMember.last_name}`)
                              : "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 flex gap-2">
                          <Textarea
                            placeholder="Add a comment..."
                            value={commentText[debrief.id] || ""}
                            onChange={(e) => setCommentText((prev) => ({ ...prev, [debrief.id]: e.target.value }))}
                            className="min-h-[60px] text-sm"
                          />
                          <Button
                            size="sm"
                            onClick={() => handleAddComment(debrief.id)}
                            disabled={!commentText[debrief.id]?.trim() || isSubmittingComment === debrief.id}
                          >
                            {isSubmittingComment === debrief.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Follow-up Date */}
                    {debrief.follow_up_date && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-blue-600" />
                        <span className="text-gray-600">Follow-up:</span>
                        <span className="font-medium">{new Date(debrief.follow_up_date).toLocaleDateString()}</span>
                      </div>
                    )}

                    {/* Karbon Link */}
                    {debrief.karbon_work_url && (
                      <a
                        href={debrief.karbon_work_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                      >
                        <LinkIcon className="h-3 w-3" />
                        View in Karbon
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
