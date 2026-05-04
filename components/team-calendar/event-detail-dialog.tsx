"use client"

/**
 * <EventDetailDialog>
 * ────────────────────────────────────────────────────────────────────────
 * Expanded view for a single Calendly event. Three tabs:
 *
 *   • Overview — host, time, location/join link, invitees, booking Q&A
 *   • Tags     — clients, work items, and services attached to the
 *                meeting. Auto-matched contacts show up here as "auto"
 *                tags; users can add manual tags or remove anything.
 *   • Comments — thread of team-only comments on the meeting.
 *
 * The dialog is presentation-only — all DB writes go through the
 * /api/calendly/events/[uuid]/{tags,comments} routes.
 */

import { useEffect, useMemo, useState } from "react"
import {
  Building2,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Tag,
  Trash2,
  User,
  Users,
  Video,
  X,
  Briefcase,
  Sparkles,
} from "lucide-react"
import { formatInTz, formatRangeInTz } from "@/lib/calendar-tz"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ClientPicker, type ClientPickerValue } from "@/components/clients/client-picker"
import { WorkItemPicker, type WorkItemPickerValue } from "@/components/work-items/work-item-picker"
import { ServicePicker, type ServicePickerValue } from "@/components/services/service-picker"
import type { TeamCalendarEvent } from "./types"

interface ClientTag {
  id: string
  link_source: "auto" | "manual"
  match_method?: string | null
  contact?: { id: string; full_name: string | null; primary_email: string | null } | null
  organization?: { id: string; name: string | null } | null
}
interface WorkItemTag {
  id: string
  work_item: { id: string; title: string; client_name?: string | null; status?: string | null } | null
}
interface ServiceTag {
  id: string
  service: { id: string; name: string; category?: string | null } | null
}
interface Comment {
  id: string
  author_team_member_id: string | null
  author_name: string
  author_avatar_url: string | null
  content: string
  created_at: string
}

interface Props {
  event: TeamCalendarEvent | null
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Selected timezone for display. */
  timeZone: string
  /** The currently logged-in team member, used as the comment author. */
  currentUser: {
    id?: string | null
    fullName?: string | null
    avatarUrl?: string | null
  }
  /** Called after a tag/comment write so the parent can refresh counts. */
  onMutated?: () => void
}

export function EventDetailDialog({ event, open, onOpenChange, timeZone, currentUser, onMutated }: Props) {
  const [activeTab, setActiveTab] = useState<"overview" | "tags" | "comments">("overview")
  const [clients, setClients] = useState<ClientTag[]>([])
  const [workItems, setWorkItems] = useState<WorkItemTag[]>([])
  const [services, setServices] = useState<ServiceTag[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [loadingComments, setLoadingComments] = useState(false)
  const [savingTag, setSavingTag] = useState(false)
  const [savingComment, setSavingComment] = useState(false)
  const [pendingClient, setPendingClient] = useState<ClientPickerValue | null>(null)
  const [pendingWorkItem, setPendingWorkItem] = useState<WorkItemPickerValue | null>(null)
  const [pendingService, setPendingService] = useState<ServicePickerValue | null>(null)
  const [draft, setDraft] = useState("")

  // Reset transient state every time we open a different event so we
  // don't leak the previous meeting's draft comment or pending tag.
  useEffect(() => {
    if (!open) return
    setActiveTab("overview")
    setPendingClient(null)
    setPendingWorkItem(null)
    setPendingService(null)
    setDraft("")
  }, [open, event?.calendly_uuid])

  // Hydrate tags + comments when the dialog opens or the user switches
  // tabs. Comments load lazily because the list view doesn't need them.
  useEffect(() => {
    if (!open || !event) return
    void loadTags()
    if (activeTab === "comments") void loadComments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.calendly_uuid, activeTab])

  async function loadTags() {
    if (!event) return
    setLoadingTags(true)
    try {
      const res = await fetch(`/api/calendly/events/${event.calendly_uuid}/tags`)
      const json = await res.json()
      if (res.ok) {
        setClients(json.clients || [])
        setWorkItems(json.workItems || [])
        setServices(json.services || [])
      }
    } finally {
      setLoadingTags(false)
    }
  }

  async function loadComments() {
    if (!event) return
    setLoadingComments(true)
    try {
      const res = await fetch(`/api/calendly/events/${event.calendly_uuid}/comments`)
      const json = await res.json()
      if (res.ok) setComments(json.comments || [])
    } finally {
      setLoadingComments(false)
    }
  }

  async function addClientTag() {
    if (!event || !pendingClient) return
    setSavingTag(true)
    try {
      const body =
        pendingClient.kind === "organization"
          ? { kind: "client", organizationId: pendingClient.id, teamMemberId: currentUser.id ?? null }
          : { kind: "client", contactId: pendingClient.id, teamMemberId: currentUser.id ?? null }
      const res = await fetch(`/api/calendly/events/${event.calendly_uuid}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setPendingClient(null)
        await loadTags()
        onMutated?.()
      }
    } finally {
      setSavingTag(false)
    }
  }

  async function addWorkItemTag() {
    if (!event || !pendingWorkItem) return
    setSavingTag(true)
    try {
      const res = await fetch(`/api/calendly/events/${event.calendly_uuid}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "work_item",
          workItemId: pendingWorkItem.id,
          teamMemberId: currentUser.id ?? null,
        }),
      })
      if (res.ok) {
        setPendingWorkItem(null)
        await loadTags()
        onMutated?.()
      }
    } finally {
      setSavingTag(false)
    }
  }

  async function addServiceTag() {
    if (!event || !pendingService) return
    setSavingTag(true)
    try {
      const res = await fetch(`/api/calendly/events/${event.calendly_uuid}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "service",
          serviceId: pendingService.id,
          teamMemberId: currentUser.id ?? null,
        }),
      })
      if (res.ok) {
        setPendingService(null)
        await loadTags()
        onMutated?.()
      }
    } finally {
      setSavingTag(false)
    }
  }

  async function removeTag(kind: "client" | "work_item" | "service", id: string) {
    if (!event) return
    setSavingTag(true)
    try {
      const res = await fetch(
        `/api/calendly/events/${event.calendly_uuid}/tags?kind=${kind}&id=${id}`,
        { method: "DELETE" },
      )
      if (res.ok) {
        await loadTags()
        onMutated?.()
      }
    } finally {
      setSavingTag(false)
    }
  }

  async function postComment() {
    const content = draft.trim()
    if (!event || !content) return
    setSavingComment(true)
    try {
      const res = await fetch(`/api/calendly/events/${event.calendly_uuid}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          authorTeamMemberId: currentUser.id ?? null,
          authorName: currentUser.fullName ?? "Team member",
          authorAvatarUrl: currentUser.avatarUrl ?? null,
        }),
      })
      if (res.ok) {
        setDraft("")
        await loadComments()
        onMutated?.()
      }
    } finally {
      setSavingComment(false)
    }
  }

  async function deleteComment(id: string) {
    if (!event) return
    const res = await fetch(`/api/calendly/events/${event.calendly_uuid}/comments?id=${id}`, {
      method: "DELETE",
    })
    if (res.ok) {
      await loadComments()
      onMutated?.()
    }
  }

  const tagCount = clients.length + workItems.length + services.length

  const initials = (name: string | null | undefined) =>
    (name || "?")
      .split(" ")
      .map((n) => n[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")

  const locationIcon = useMemo(() => {
    const t = event?.location_type
    if (!t) return <Calendar className="h-4 w-4" />
    if (t === "physical") return <MapPin className="h-4 w-4" />
    if (t === "inbound_call" || t === "outbound_call") return <Phone className="h-4 w-4" />
    return <Video className="h-4 w-4" />
  }, [event?.location_type])

  if (!event) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{event.name}</DialogTitle>
          <DialogDescription>
            {formatRangeInTz(event.start_time, event.end_time, timeZone)}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tags" className="gap-2">
              Tags
              {tagCount > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {tagCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="comments" className="gap-2">
              Comments
              {comments.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {comments.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-4">
            {/* Host */}
            {event.team_members && (
              <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
                <Avatar>
                  <AvatarImage src={event.team_members.avatar_url || ""} alt={event.team_members.full_name || ""} />
                  <AvatarFallback>{initials(event.team_members.full_name)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">Hosted by {event.team_members.full_name}</p>
                  <p className="text-xs text-muted-foreground">{event.team_members.email}</p>
                </div>
              </div>
            )}

            {/* Time */}
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="text-sm">
                <p className="font-medium">{formatInTz(event.start_time, timeZone, { dateStyle: "full" })}</p>
                <p className="text-muted-foreground">
                  {formatInTz(event.start_time, timeZone, { timeStyle: "short" })} –{" "}
                  {formatInTz(event.end_time, timeZone, { timeStyle: "short" })} ({timeZone})
                </p>
              </div>
            </div>

            {/* Location */}
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-muted-foreground">{locationIcon}</span>
              <div className="flex-1 text-sm">
                <p className="font-medium capitalize">
                  {event.location_type ? event.location_type.replace(/_/g, " ") : "Meeting"}
                </p>
                {event.location && <p className="text-muted-foreground">{event.location}</p>}
                {event.join_url && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 gap-2"
                    onClick={() => window.open(event.join_url || "", "_blank")}
                  >
                    <Video className="h-4 w-4" />
                    Join meeting
                    <ExternalLink className="h-3 w-3 opacity-70" />
                  </Button>
                )}
              </div>
            </div>

            {/* Invitees */}
            {event.calendly_invitees && event.calendly_invitees.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4" />
                  Invitees ({event.calendly_invitees.length})
                </h4>
                <div className="space-y-2">
                  {event.calendly_invitees.map((inv) => (
                    <div key={inv.id} className="rounded-lg bg-muted p-3 text-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium">{inv.name || "Guest"}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {inv.email}
                          </p>
                          {inv.timezone && (
                            <p className="mt-0.5 text-xs text-muted-foreground">Their tz: {inv.timezone}</p>
                          )}
                        </div>
                        <Badge
                          variant={inv.status === "active" ? "default" : "destructive"}
                          className="text-xs"
                        >
                          {inv.status}
                        </Badge>
                      </div>
                      {Array.isArray(inv.questions_answers) && inv.questions_answers.length > 0 && (
                        <div className="mt-3 space-y-1.5 border-t pt-3">
                          <p className="text-xs font-medium text-muted-foreground">Booking questions</p>
                          {inv.questions_answers.map((qa: any, i: number) => (
                            <div key={i} className="text-xs">
                              <p className="text-muted-foreground">{qa.question}</p>
                              <p className="font-medium">{qa.answer}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* TAGS */}
          <TabsContent value="tags" className="space-y-5">
            {/* Clients */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <User className="h-4 w-4" />
                Clients
                {clients.some((c) => c.link_source === "auto") && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Sparkles className="h-3 w-3" />
                    auto-matched from invitee
                  </span>
                )}
              </h4>
              {loadingTags && clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No clients tagged yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {clients.map((c) => {
                    const label = c.contact?.full_name || c.organization?.name || "Unknown"
                    const Icon = c.organization ? Building2 : User
                    return (
                      <Badge
                        key={c.id}
                        variant={c.link_source === "auto" ? "default" : "secondary"}
                        className="gap-1.5 pr-1"
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                        {c.link_source === "auto" && <Sparkles className="h-3 w-3 opacity-70" />}
                        <button
                          type="button"
                          aria-label="Remove client tag"
                          onClick={() => removeTag("client", c.id)}
                          className="ml-1 rounded-full p-0.5 hover:bg-background/50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <ClientPicker
                  value={pendingClient}
                  onChange={setPendingClient}
                  placeholder="Tag a client…"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!pendingClient || savingTag}
                  onClick={addClientTag}
                  className="shrink-0"
                >
                  {savingTag ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </section>

            {/* Work items */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Briefcase className="h-4 w-4" />
                Work items
              </h4>
              {workItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No work items tagged yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {workItems.map((w) => (
                    <Badge key={w.id} variant="secondary" className="gap-1.5 pr-1">
                      <Briefcase className="h-3 w-3" />
                      {w.work_item?.title || "Untitled"}
                      <button
                        type="button"
                        aria-label="Remove work item tag"
                        onClick={() => removeTag("work_item", w.id)}
                        className="ml-1 rounded-full p-0.5 hover:bg-background/50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <WorkItemPicker value={pendingWorkItem} onChange={setPendingWorkItem} />
                <Button
                  type="button"
                  size="sm"
                  disabled={!pendingWorkItem || savingTag}
                  onClick={addWorkItemTag}
                  className="shrink-0"
                >
                  {savingTag ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </section>

            {/* Services */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Tag className="h-4 w-4" />
                Services
              </h4>
              {services.length === 0 ? (
                <p className="text-sm text-muted-foreground">No services tagged yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {services.map((s) => (
                    <Badge key={s.id} variant="secondary" className="gap-1.5 pr-1">
                      <Tag className="h-3 w-3" />
                      {s.service?.name || "Service"}
                      <button
                        type="button"
                        aria-label="Remove service tag"
                        onClick={() => removeTag("service", s.id)}
                        className="ml-1 rounded-full p-0.5 hover:bg-background/50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <ServicePicker value={pendingService} onChange={setPendingService} />
                <Button
                  type="button"
                  size="sm"
                  disabled={!pendingService || savingTag}
                  onClick={addServiceTag}
                  className="shrink-0"
                >
                  {savingTag ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </section>
          </TabsContent>

          {/* COMMENTS */}
          <TabsContent value="comments" className="space-y-4">
            {loadingComments && comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading comments…</p>
            ) : comments.length === 0 ? (
              <div className="rounded-lg border border-dashed py-8 text-center">
                <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No comments yet. Start the discussion below.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={c.author_avatar_url || ""} alt={c.author_name} />
                      <AvatarFallback className="text-xs">{initials(c.author_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 rounded-lg bg-muted p-3 text-sm">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="font-medium">{c.author_name}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {new Date(c.created_at).toLocaleString()}
                          </span>
                          {c.author_team_member_id === currentUser.id && (
                            <button
                              type="button"
                              aria-label="Delete comment"
                              onClick={() => deleteComment(c.id)}
                              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{c.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Leave a note for the team about this meeting…"
                rows={3}
                className="resize-none"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Visible to all teammates. Useful for prep notes, follow-ups, and context.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={!draft.trim() || savingComment}
                  onClick={postComment}
                  className="gap-2"
                >
                  {savingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Post
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// `Check` and the imported `cn` aren't used in this file; the icon is
// indirectly referenced via lucide-react bundling but only by name.
void Check
