"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import {
  CalendarIcon,
  Check,
  ChevronsUpDown,
  Plus,
  Trash2,
  Users,
  Briefcase,
  Building2,
  User,
  X,
  Loader2,
  Send,
  FileText,
  DollarSign,
  ListTodo,
  Lightbulb,
  Bell,
  Star,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MentionTextarea } from "@/components/mentions/mention-textarea"

// Types
interface Client {
  id: string
  name: string
  full_name: string // Added full_name for searchability
  type: "contact" | "organization"
  karbon_key: string
  primary_email?: string
}

interface WorkItem {
  id: string
  title: string
  karbon_work_item_key: string
  work_type?: string
  client_name?: string
  status?: string
  // Fields used to derive the debrief's *primary contact* directly from the
  // Karbon work item. The work_items_enriched view exposes the owning
  // contact OR organization plus its UUID, type, name, and Karbon key,
  // which is everything we need to build a Client without a follow-up API
  // call. `client_type` is the Karbon-side string ("Contact" / "Organization").
  contact_id?: string | null
  organization_id?: string | null
  client_type?: string | null
  karbon_client_key?: string | null
  contact_full_name?: string | null
  org_name?: string | null
}

interface TeamMember {
  id: string
  full_name: string
  email: string
  role?: string
  karbon_user_key?: string
}

type Service = {
  id: string
  ignition_id: string
  name: string
  category: string | null
  subcategory: string | null
  price: number | null
  price_type: string | null
  description: string | null
}

interface ActionItem {
  id: string
  description: string
  assignee_id: string
  assignee_name: string
  due_date: Date | null
  priority: "low" | "medium" | "high"
  create_task: boolean
}

interface ResearchTopic {
  id: string
  topic: string
  notes: string
  priority: "low" | "medium" | "high"
}

// Updated FormData type
type FormData = {
  meeting_date: Date | null
  team_member_id: string
  team_member_name: string
  work_item_ids: string[]
  related_work_items: WorkItem[]
  // Canonical "this debrief is FOR this client" tag — auto-populated from the
  // first selected Karbon work item's owning contact/organization, manually
  // overridable. Drives every downstream filter: dashboard rows, email
  // subject, Karbon timeline attachment, and the persisted
  // debriefs.contact_id / debriefs.organization_id FKs.
  primary_contact: Client | null
  // Additional people this debrief should ALSO be tagged to (e.g. a spouse
  // for a 1040 meeting, or a related entity). Never includes the primary —
  // we de-dupe by id/karbon_key so the email and Karbon note don't render
  // the primary twice.
  client_ids: string[]
  related_clients: Client[]
  notes: string
  action_items: ActionItem[]
  services: Service[]
  fee_adjustment: string
  fee_adjustment_reason: string
  research_topics: string
  notify_team: boolean
  follow_up_date: Date | null // Added follow_up_date
  notification_recipients: string[] // Added notification_recipients
}

export function DebriefForm() {
  // Form state
  // Updated to use FormData type
  const [formData, setFormData] = useState<FormData>({
    meeting_date: new Date(),
    team_member_id: "",
    team_member_name: "",
    work_item_ids: [],
    related_work_items: [],
    primary_contact: null,
    client_ids: [],
    related_clients: [],
    notes: "",
    action_items: [],
    services: [],
    fee_adjustment: "",
    fee_adjustment_reason: "",
    research_topics: "",
    notify_team: true,
    follow_up_date: null, // Initialize follow_up_date
    notification_recipients: [], // Initialize notification_recipients
  })

  // Search states
  const [clientSearch, setClientSearch] = useState("")
  const [workItemSearch, setWorkItemSearch] = useState("")
  const [teamMemberSearch, setTeamMemberSearch] = useState("")
  // Updated service search state
  const [serviceSearch, setServiceSearch] = useState("")

  // Data states
  const [clients, setClients] = useState<Client[]>([])
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [services, setServices] = useState<Service[]>([])

  // Loading states
  const [loadingClients, setLoadingClients] = useState(false)
  const [loadingWorkItems, setLoadingWorkItems] = useState(false)
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false)
  // Loading state for services
  const [loadingServices, setLoadingServices] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Popover states
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false)
  // Separate popover state for the Primary Contact picker — needed because
  // the primary picker shares the same `clients` search results array as the
  // Related Clients picker. If we reused one open flag the two popovers
  // would fight over the search input.
  const [primaryPopoverOpen, setPrimaryPopoverOpen] = useState(false)
  const [workItemPopoverOpen, setWorkItemPopoverOpen] = useState(false)
  const [teamMemberPopoverOpen, setTeamMemberPopoverOpen] = useState(false)
  // Service popover open state
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false)
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const [followUpPopoverOpen, setFollowUpPopoverOpen] = useState(false)

  const fetchClients = useCallback(async (search: string) => {
    if (!search || search.length < 2) {
      setClients([])
      return
    }

    setLoadingClients(true)
    try {
      // Fetch from both contacts and organizations
      const [contactsRes, orgsRes] = await Promise.all([
        fetch(`/api/supabase/contacts?search=${encodeURIComponent(search)}&limit=20`),
        fetch(`/api/supabase/organizations?search=${encodeURIComponent(search)}&limit=20`),
      ])

      const contactsData = await contactsRes.json()
      const orgsData = await orgsRes.json()

      const contactClients: Client[] = (contactsData.contacts || []).map((c: any) => {
        // Build the best display name from all available fields
        const fullName =
          c.full_name ||
          `${c.first_name || ""} ${c.last_name || ""}`.trim() ||
          c.preferred_name ||
          c.primary_email ||
          "Unknown Contact"
        return {
          id: c.id,
          name: fullName,
          full_name: fullName,
          type: "contact" as const,
          karbon_key: c.karbon_contact_key,
          primary_email: c.primary_email,
        }
      })

      const orgClients: Client[] = (orgsData.organizations || []).map((o: any) => {
        const orgName = o.name || o.full_name || o.trading_name || o.legal_name || o.primary_email || "Unknown Organization"
        return {
          id: o.id,
          name: orgName,
          full_name: orgName,
          type: "organization" as const,
          karbon_key: o.karbon_organization_key,
          primary_email: o.primary_email,
        }
      })

      setClients([...contactClients, ...orgClients])
    } catch (error) {
      console.error("Error fetching clients:", error)
    } finally {
      setLoadingClients(false)
    }
  }, [])

  const fetchWorkItems = useCallback(async (search: string) => {
    if (!search || search.length < 2) {
      setWorkItems([])
      return
    }

    setLoadingWorkItems(true)
    try {
      const res = await fetch(`/api/work-items?search=${encodeURIComponent(search)}&limit=20&active=true`)
      const data = await res.json()
      setWorkItems(
        (data.work_items || []).map((w: any) => ({
          id: w.id,
          title: w.title,
          karbon_work_item_key: w.karbon_work_item_key,
          work_type: w.work_type,
          client_name: w.client_name,
          status: w.workflow_status,
          // The /api/work-items endpoint hits work_items_enriched, which
          // already exposes the owning client's UUID + name + type + Karbon
          // key. Forward them so addWorkItem can build the primary contact
          // directly with no extra round trip.
          contact_id: w.contact_id ?? null,
          organization_id: w.organization_id ?? null,
          client_type: w.client_type ?? null,
          karbon_client_key: w.karbon_client_key ?? null,
          contact_full_name: w.contact_full_name ?? null,
          org_name: w.org_name ?? null,
        })),
      )
    } catch (error) {
      console.error("Error fetching work items:", error)
    } finally {
      setLoadingWorkItems(false)
    }
  }, [])

  // Fetch team members
  const fetchTeamMembers = useCallback(async () => {
    setLoadingTeamMembers(true)
    try {
      const res = await fetch("/api/team-members")
      const data = await res.json()
      setTeamMembers(
        (data.team_members || []).map((t: any) => ({
          id: t.id,
          full_name: t.full_name,
          email: t.email,
          role: t.role,
          karbon_user_key: t.karbon_user_key,
        })),
      )
    } catch (error) {
      console.error("Error fetching team members:", error)
    } finally {
      setLoadingTeamMembers(false)
    }
  }, [])

  // Fetch service lines
  const fetchServices = useCallback(async (search?: string) => {
    setLoadingServices(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      params.set("limit", "100")

      const res = await fetch(`/api/services?${params.toString()}`)
      const data = await res.json()
      setServices(
        (data.services || []).map((s: any) => ({
          id: s.id,
          ignition_id: s.ignition_id,
          name: s.name,
          category: s.category,
          subcategory: s.subcategory,
          price: s.price,
          price_type: s.price_type,
          description: s.description,
        })),
      )
    } catch (error) {
      console.error("Error fetching services:", error)
    } finally {
      setLoadingServices(false)
    }
  }, [])

  // Initial data fetch
  useEffect(() => {
    fetchTeamMembers()
    fetchServices()
  }, [fetchTeamMembers, fetchServices])

  // Debounced search for clients
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchClients(clientSearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [clientSearch, fetchClients])

  // Debounced search for work items
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchWorkItems(workItemSearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [workItemSearch, fetchWorkItems])

  useEffect(() => {
    // Skip initial mount fetch since we already do it above
    if (serviceSearch === "") return

    const timer = setTimeout(() => {
      fetchServices(serviceSearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [serviceSearch, fetchServices])

  // Add client (to the "Other Related Clients" list — never to primary).
  // Silently no-ops when the picked client matches the current primary
  // contact, so the related list stays a true "additional people" list.
  const addClient = (client: Client) => {
    if (formData.primary_contact?.id === client.id) {
      setClientPopoverOpen(false)
      setClientSearch("")
      return
    }
    if (!formData.related_clients.find((c) => c.id === client.id)) {
      setFormData((prev) => ({
        ...prev,
        related_clients: [...prev.related_clients, client],
        client_ids: [...prev.client_ids, client.id],
      }))
    }
    setClientPopoverOpen(false)
    setClientSearch("")
  }

  // Remove client
  const removeClient = (clientId: string) => {
    setFormData((prev) => ({
      ...prev,
      related_clients: prev.related_clients.filter((c) => c.id !== clientId),
      client_ids: prev.client_ids.filter((id) => id !== clientId),
    }))
  }

  /**
   * Build a Client object representing the work item's owning contact or
   * organization. Returns null when the work item isn't yet linked to a
   * client in our enriched view (rare — usually means Karbon hadn't synced
   * the client when the work item was last pulled). The caller decides
   * what to do with a null result; here we just leave the primary contact
   * untouched.
   */
  const deriveWorkItemPrimaryContact = (workItem: WorkItem): Client | null => {
    // Karbon's `client_type` is "Organization" or "Contact" (capitalized).
    // The view also exposes `organization_id` / `contact_id` UUIDs that
    // come from joining work_items.karbon_client_key against the cached
    // contacts/organizations tables. Prefer the org branch first because
    // a work item tied to an organization is the primary tagging case
    // (S-corp 1120, partnership 1065, etc.).
    const isOrg =
      (workItem.client_type || "").toLowerCase().startsWith("org") ||
      !!workItem.organization_id
    if (isOrg && workItem.organization_id) {
      const name = workItem.org_name || workItem.client_name || "Organization"
      return {
        id: workItem.organization_id,
        name,
        full_name: name,
        type: "organization",
        karbon_key: workItem.karbon_client_key || "",
      }
    }
    if (workItem.contact_id) {
      const name =
        workItem.contact_full_name || workItem.client_name || "Contact"
      return {
        id: workItem.contact_id,
        name,
        full_name: name,
        type: "contact",
        karbon_key: workItem.karbon_client_key || "",
      }
    }
    return null
  }

  const addWorkItem = (workItem: WorkItem) => {
    if (!formData.related_work_items.find((w) => w.id === workItem.id)) {
      setFormData((prev) => {
        const next: FormData = {
          ...prev,
          related_work_items: [...prev.related_work_items, workItem],
          work_item_ids: [...prev.work_item_ids, workItem.id],
        }
        // Auto-set primary contact from the FIRST work item added.
        // Subsequent work items don't overwrite — the user explicitly
        // chose the first one's client as the primary, and silently
        // changing it on a later add would feel buggy. They can still
        // clear/reassign manually.
        if (!prev.primary_contact) {
          const derived = deriveWorkItemPrimaryContact(workItem)
          if (derived) {
            next.primary_contact = derived
            // Also strip this person from related_clients if they were
            // previously added there (avoid double-tagging).
            next.related_clients = prev.related_clients.filter(
              (c) => c.id !== derived.id,
            )
            next.client_ids = prev.client_ids.filter((id) => id !== derived.id)
          }
        }
        return next
      })
    }
    setWorkItemPopoverOpen(false)
    setWorkItemSearch("")
  }

  // Clear primary contact (used when the partner picks a work item but the
  // debrief is actually about a different client, e.g. a referral meeting).
  const clearPrimaryContact = () => {
    setFormData((prev) => ({ ...prev, primary_contact: null }))
  }

  // Manual override — used when the work item didn't auto-populate the
  // right person, or when there's no work item at all.
  const setPrimaryContact = (client: Client) => {
    setFormData((prev) => ({
      ...prev,
      primary_contact: client,
      // Keep the related list clean — primary is never also a "related".
      related_clients: prev.related_clients.filter((c) => c.id !== client.id),
      client_ids: prev.client_ids.filter((id) => id !== client.id),
    }))
  }

  // Remove work item
  const removeWorkItem = (workItemId: string) => {
    setFormData((prev) => ({
      ...prev,
      related_work_items: prev.related_work_items.filter((w) => w.id !== workItemId),
      work_item_ids: prev.work_item_ids.filter((id) => id !== workItemId),
    }))
  }

  // Select team member
  const selectTeamMember = (member: TeamMember) => {
    setFormData((prev) => ({
      ...prev,
      team_member_id: member.id,
      team_member_name: member.full_name,
    }))
    setTeamMemberPopoverOpen(false)
  }

  // Toggle service line
  const toggleService = (service: Service) => {
    setFormData((prev) => {
      const exists = prev.services.some((s) => s.id === service.id)
      return {
        ...prev,
        services: exists ? prev.services.filter((s) => s.id !== service.id) : [...prev.services, service],
      }
    })
  }

  // Add action item
  const addActionItem = () => {
    const newItem: ActionItem = {
      id: crypto.randomUUID(),
      description: "",
      assignee_id: "",
      assignee_name: "",
      due_date: null,
      priority: "medium",
      create_task: true,
    }
    setFormData((prev) => ({
      ...prev,
      action_items: [...prev.action_items, newItem],
    }))
  }

  // Update action item
  const updateActionItem = (id: string, updates: Partial<ActionItem>) => {
    setFormData((prev) => ({
      ...prev,
      action_items: prev.action_items.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    }))
  }

  // Remove action item
  const removeActionItem = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      action_items: prev.action_items.filter((item) => item.id !== id),
    }))
  }

  // Add research topic
  const addResearchTopic = () => {
    const newTopic: ResearchTopic = {
      id: crypto.randomUUID(),
      topic: "",
      notes: "",
      priority: "medium",
    }
    // This function seems to be intended for adding individual research topics,
    // but the formData.research_topics is a string. This might need adjustment
    // if individual topic management is desired. For now, it's not used.
    console.warn(
      "addResearchTopic called, but formData.research_topics is a string. Consider refactoring if individual topics are needed.",
    )
  }

  // Update research topic
  const updateResearchTopic = (id: string, updates: Partial<ResearchTopic>) => {
    // Similar to addResearchTopic, this function is not directly compatible
    // with formData.research_topics being a string.
    console.warn(
      "updateResearchTopic called, but formData.research_topics is a string. Consider refactoring if individual topics are needed.",
    )
  }

  // Remove research topic
  const removeResearchTopic = (id: string) => {
    // Similar to addResearchTopic, this function is not directly compatible
    // with formData.research_topics being a string.
    console.warn(
      "removeResearchTopic called, but formData.research_topics is a string. Consider refactoring if individual topics are needed.",
    )
  }

  // Submit form
  const handleSubmit = async () => {
    if (!formData.meeting_date || !formData.team_member_id) {
      alert("Please fill in required fields: Meeting Date and Team Member")
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch("/api/debriefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debrief_date: formData.meeting_date.toISOString().split("T")[0],
          notes: formData.notes,
          fee_adjustment: formData.fee_adjustment, // Changed from fee_adjustments
          fee_adjustment_reason: formData.fee_adjustment_reason, // Added new field
          follow_up_date: formData.follow_up_date?.toISOString().split("T")[0] || null,
          team_member: formData.team_member_name,
          created_by_id: formData.team_member_id,
          // Changed to use client_ids and work_item_ids
          client_ids: formData.client_ids,
          work_item_ids: formData.work_item_ids,
          // Primary contact drives debriefs.contact_id / organization_id
          // server-side. Sent as a flat object so the API can resolve
          // either kind without inspecting related_clients.
          primary_contact: formData.primary_contact
            ? {
                id: formData.primary_contact.id,
                type: formData.primary_contact.type,
                name: formData.primary_contact.name,
                karbon_key: formData.primary_contact.karbon_key,
              }
            : null,
          // karbon_work_url: formData.related_work_items[0]?.karbon_work_item_key // Changed to use related_work_items
          //   ? `https://app.karbonhq.com/work/${formData.related_work_items[0].karbon_work_item_key}`
          //   : null,
          action_items: formData.action_items.map((item) => ({
            // Map to include only relevant fields
            description: item.description,
            assignee_id: item.assignee_id,
            assignee_name: item.assignee_name,
            due_date: item.due_date?.toISOString().split("T")[0] || null,
            priority: item.priority,
            create_task: item.create_task,
          })),
          related_clients: formData.related_clients.map((c) => ({
            // Kept as is
            id: c.id,
            type: c.type,
            name: c.name,
            karbon_key: c.karbon_key,
          })),
          related_work_items: formData.related_work_items.map((w) => ({
            // Changed to use related_work_items
            id: w.id,
            title: w.title,
            karbon_key: w.karbon_work_item_key,
          })),
          services: formData.services.map((s) => s.name),
          research_topics: formData.research_topics, // Changed from research_topics array to string
          notify_team: formData.notify_team,
          notification_recipients: formData.notification_recipients,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || errorData.message || "Failed to create debrief")
      }

      const result = await response.json()

      // Create tasks for action items if enabled
      for (const item of formData.action_items) {
        if (item.create_task && item.description && item.assignee_id) {
          await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: item.description,
              assignee_id: item.assignee_id,
              due_date: item.due_date?.toISOString().split("T")[0] || null,
              priority: item.priority,
              // Changed to use work_item_ids and check if it's not empty
              work_item_id: formData.work_item_ids.length > 0 ? formData.work_item_ids[0] : null,
              notes: `Created from debrief on ${format(formData.meeting_date!, "PPP")}`,
              status: "pending",
            }),
          })
        }
      }

      // Note: Team notifications (in-app + email, preference-aware) are now
      // created server-side in POST /api/debriefs based on the notify_team
      // and notification_recipients fields included in the debrief payload above.
      // This avoids duplicate emails / duplicate in-app rows.

      alert("Debrief created successfully!")

      // Reset form
      setFormData({
        meeting_date: new Date(),
        team_member_id: "",
        team_member_name: "",
        work_item_ids: [],
        related_work_items: [],
        primary_contact: null,
        client_ids: [],
        related_clients: [],
        notes: "",
        action_items: [],
        services: [],
        fee_adjustment: "",
        fee_adjustment_reason: "",
        research_topics: "",
        notify_team: true,
        follow_up_date: null,
        notification_recipients: [],
      })
    } catch (error) {
      console.error("Error creating debrief:", error)
      alert(error instanceof Error ? error.message : "Failed to create debrief")
    } finally {
      setSubmitting(false)
    }
  }

  const filteredTeamMembers = teamMemberSearch
    ? teamMembers.filter((m) => m.full_name.toLowerCase().includes(teamMemberSearch.toLowerCase()))
    : teamMembers

  // Filtered services to use services state
  const filteredServices = services

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Meeting Debrief</h1>
          <p className="text-muted-foreground">Document meeting notes and follow-up items</p>
        </div>
        <Button onClick={handleSubmit} disabled={submitting} size="lg">
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Submit Debrief
            </>
          )}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Meeting Details
          </CardTitle>
          <CardDescription>Enter meeting information, related work items, clients, and notes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Date Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Meeting Date *</Label>
              <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.meeting_date && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.meeting_date ? format(formData.meeting_date, "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.meeting_date || undefined}
                    onSelect={(date) => {
                      setFormData((prev) => ({ ...prev, meeting_date: date || null }))
                      setDatePopoverOpen(false)
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Follow-up Date</Label>
              <Popover open={followUpPopoverOpen} onOpenChange={setFollowUpPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.follow_up_date && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.follow_up_date ? format(formData.follow_up_date, "PPP") : "Select follow-up date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.follow_up_date || undefined}
                    onSelect={(date) => {
                      setFormData((prev) => ({ ...prev, follow_up_date: date || null }))
                      setFollowUpPopoverOpen(false)
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Team Member */}
          <div className="space-y-2">
            <Label>Team Member Providing Notes *</Label>
            {/* `modal` keeps CommandInput keystrokes alive even when this
                form is rendered inside a Dialog/Sheet. Harmless on a normal
                page but required for the search field to be typeable when
                the form is mounted in a modal context. */}
            <Popover open={teamMemberPopoverOpen} onOpenChange={setTeamMemberPopoverOpen} modal>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between bg-transparent">
                  {formData.team_member_name || "Select team member..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Search team members..."
                    value={teamMemberSearch}
                    onValueChange={setTeamMemberSearch}
                  />
                  <CommandList>
                    <CommandEmpty>{loadingTeamMembers ? "Loading..." : "No team member found."}</CommandEmpty>
                    <CommandGroup>
                      {filteredTeamMembers.map((member) => (
                        <CommandItem key={member.id} value={member.full_name} onSelect={() => selectTeamMember(member)}>
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              formData.team_member_id === member.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <User className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span>{member.full_name}</span>
                          {member.role && <span className="ml-2 text-xs text-muted-foreground">({member.role})</span>}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Related Karbon Work Items
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Selecting a work item will auto-populate the related client
            </p>
            <Popover open={workItemPopoverOpen} onOpenChange={setWorkItemPopoverOpen} modal>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start bg-transparent">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Work Item...
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[500px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search by title, client, work type, status, or work item ID..."
                    value={workItemSearch}
                    onValueChange={setWorkItemSearch}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {loadingWorkItems
                        ? "Searching..."
                        : workItemSearch.length < 2
                          ? "Type at least 2 characters to search"
                          : "No active work item found."}
                    </CommandEmpty>
                    {workItems.length > 0 && (
                      <CommandGroup>
                        {workItems.map((item) => (
                          <CommandItem key={item.id} value={`wi-${item.id}`} onSelect={() => addWorkItem(item)}>
                            <Briefcase className="mr-2 h-4 w-4 text-orange-500" />
                            <div className="flex flex-col">
                              <span>{item.title}</span>
                              <span className="text-xs text-muted-foreground">
                                {item.client_name} • {item.work_type || "No type"} • {item.status || "No status"}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Selected work items */}
            {formData.related_work_items.length > 0 && ( // Changed to use related_work_items
              <div className="space-y-2 mt-2">
                {formData.related_work_items.map(
                  (
                    item, // Changed to use related_work_items
                  ) => (
                    <div key={item.id} className="flex items-center justify-between p-2 bg-muted rounded-md">
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-orange-500" />
                        <div>
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.client_name} • {item.work_type}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removeWorkItem(item.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* ─── Primary Contact ─────────────────────────────────────────
              Auto-filled from the first selected work item's owning
              contact/organization. Drives debriefs.contact_id /
              organization_id server-side, so dashboards, the email subject,
              and the Karbon timeline attachment all key off this single
              field. Manually overridable for edge cases (referral meetings,
              prospect intros without a Karbon work item yet, etc.). */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
              Primary Contact
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              The primary contact/organization this debrief is tagged to. Auto-populated from the
              Karbon work item above when available.
            </p>

            {formData.primary_contact ? (
              <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-md">
                <div className="flex items-center gap-2">
                  {formData.primary_contact.type === "organization" ? (
                    <Building2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <User className="h-4 w-4 text-blue-600" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{formData.primary_contact.full_name}</p>
                    {formData.primary_contact.primary_email && (
                      <p className="text-xs text-muted-foreground">
                        {formData.primary_contact.primary_email}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearPrimaryContact}
                  aria-label="Clear primary contact"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Popover open={primaryPopoverOpen} onOpenChange={setPrimaryPopoverOpen} modal>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start bg-transparent">
                    <Plus className="mr-2 h-4 w-4" />
                    Select primary contact...
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search by name or email..."
                      value={clientSearch}
                      onValueChange={setClientSearch}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {loadingClients
                          ? "Searching..."
                          : clientSearch.length < 2
                            ? "Type at least 2 characters to search"
                            : "No client found."}
                      </CommandEmpty>
                      {clients.filter((c) => c.type === "contact").length > 0 && (
                        <CommandGroup heading="Contacts">
                          {clients
                            .filter((c) => c.type === "contact")
                            .map((client) => (
                              <CommandItem
                                key={client.id}
                                value={`primary-contact-${client.id}`}
                                onSelect={() => {
                                  setPrimaryContact(client)
                                  setPrimaryPopoverOpen(false)
                                  setClientSearch("")
                                }}
                              >
                                <User className="mr-2 h-4 w-4 text-blue-500" />
                                <span>{client.full_name || client.name || "Unknown"}</span>
                                {client.primary_email && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {client.primary_email}
                                  </span>
                                )}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      )}
                      {clients.filter((c) => c.type === "organization").length > 0 && (
                        <CommandGroup heading="Organizations">
                          {clients
                            .filter((c) => c.type === "organization")
                            .map((client) => (
                              <CommandItem
                                key={client.id}
                                value={`primary-org-${client.id}`}
                                onSelect={() => {
                                  setPrimaryContact(client)
                                  setPrimaryPopoverOpen(false)
                                  setClientSearch("")
                                }}
                              >
                                <Building2 className="mr-2 h-4 w-4 text-green-500" />
                                <span>{client.full_name || client.name || "Unknown"}</span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Other Related Clients
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Additional people this debrief should also be tagged to (e.g., spouse, related
              entities). These appear alongside the primary contact in the email and on Karbon
              timelines, but the primary drives all dashboard filtering.
            </p>
            <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen} modal>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start bg-transparent">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Client...
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search by name or email..."
                    value={clientSearch}
                    onValueChange={setClientSearch}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {loadingClients
                        ? "Searching..."
                        : clientSearch.length < 2
                          ? "Type at least 2 characters to search"
                          : "No client found."}
                    </CommandEmpty>
                    {clients.filter((c) => c.type === "contact").length > 0 && (
                      <CommandGroup heading="Contacts">
                        {clients
                          .filter((c) => c.type === "contact")
                          .map((client) => (
                            <CommandItem key={client.id} value={`contact-${client.id}`} onSelect={() => addClient(client)}>
                              <User className="mr-2 h-4 w-4 text-blue-500" />
                              <span>{client.full_name || client.name || "Unknown"}</span>
                              {client.primary_email && (
                                <span className="ml-2 text-xs text-muted-foreground">{client.primary_email}</span>
                              )}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    )}
                    {clients.filter((c) => c.type === "organization").length > 0 && (
                      <CommandGroup heading="Organizations">
                        {clients
                          .filter((c) => c.type === "organization")
                          .map((client) => (
                            <CommandItem key={client.id} value={`org-${client.id}`} onSelect={() => addClient(client)}>
                              <Building2 className="mr-2 h-4 w-4 text-green-500" />
                              <span>{client.full_name || client.name || "Unknown"}</span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Selected clients */}
            {formData.related_clients.length > 0 && ( // Changed to use related_clients
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.related_clients.map(
                  (
                    client, // Changed to use related_clients
                  ) => (
                    <Badge key={client.id} variant="secondary" className="flex items-center gap-1 py-1 px-2">
                      {client.type === "contact" ? (
                        <User className="h-3 w-3 text-blue-500" />
                      ) : (
                        <Building2 className="h-3 w-3 text-green-500" />
                      )}
                      {client.full_name}
                      <button onClick={() => removeClient(client.id)} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ),
                )}
              </div>
            )}
          </div>

          {/* Meeting Notes */}
          <div className="space-y-2">
            <Label>Meeting Notes</Label>
            {/*
             * Meeting Notes get the @-mention picker so partners can
             * tag a teammate inline ("@Dat please confirm the AGI") and
             * the rendered debrief detail view will highlight the chip.
             * The other freeform fields below (fee adjustment / research
             * topics) intentionally use plain Textareas because they
             * don't render in surfaces where mention notifications make
             * sense.
             */}
            <MentionTextarea
              placeholder="Enter detailed notes from the meeting... Type @ to mention a teammate."
              value={formData.notes}
              onChange={(value) => setFormData((prev) => ({ ...prev, notes: value }))}
              className="min-h-[150px]"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            Action Items & Follow-ups
          </CardTitle>
          <CardDescription>
            Add tasks with assignees. Enable "Create Task" to automatically create a task in the system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formData.action_items.map((item, index) => (
            <div key={item.id} className="p-4 border rounded-lg space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Action Item {index + 1}</span>
                <Button variant="ghost" size="sm" onClick={() => removeActionItem(item.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              <Input
                placeholder="Describe the action item..."
                value={item.description}
                onChange={(e) => updateActionItem(item.id, { description: e.target.value })}
              />

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Assignee</Label>
                  <Select
                    value={item.assignee_id}
                    onValueChange={(value) => {
                      const member = teamMembers.find((m) => m.id === value)
                      updateActionItem(item.id, {
                        assignee_id: value,
                        assignee_name: member?.full_name || "",
                      })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teamMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Priority</Label>
                  <Select
                    value={item.priority}
                    onValueChange={(value: "low" | "medium" | "high") => updateActionItem(item.id, { priority: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Due Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !item.due_date && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-3 w-3" />
                        {item.due_date ? format(item.due_date, "MM/dd/yy") : "Set date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={item.due_date || undefined}
                        onSelect={(date) => updateActionItem(item.id, { due_date: date || null })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id={`create-task-${item.id}`}
                  checked={item.create_task}
                  onCheckedChange={(checked) => updateActionItem(item.id, { create_task: checked as boolean })}
                />
                <Label htmlFor={`create-task-${item.id}`} className="text-sm">
                  Create task and assign to team member
                </Label>
              </div>
            </div>
          ))}

          <Button variant="outline" onClick={addActionItem} className="w-full bg-transparent">
            <Plus className="mr-2 h-4 w-4" />
            Add Action Item
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Project Finance
          </CardTitle>
          <CardDescription>Select related services and document any pricing considerations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Related Services */}
          <div className="space-y-2">
            <Label>Related Services</Label>
            <Popover
              modal
              open={servicePopoverOpen}
              onOpenChange={(open) => {
                setServicePopoverOpen(open)
                if (open) {
                  setServiceSearch("")
                  fetchServices()
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between bg-transparent">
                  {formData.services.length > 0
                    ? `${formData.services.length} service(s) selected`
                    : "Select services..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[500px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search services by name..."
                    value={serviceSearch}
                    onValueChange={setServiceSearch}
                  />
                  <CommandList className="max-h-[300px]">
                    <CommandEmpty>{loadingServices ? "Loading services..." : "No services found."}</CommandEmpty>
                    <CommandGroup heading={`Services${services.length > 0 ? ` (${services.length})` : ""}`}>
                      {services.map((service) => (
                        <CommandItem
                          key={service.id}
                          value={service.id}
                          onSelect={() => toggleService(service)}
                        >
                          <Checkbox checked={formData.services.some((s) => s.id === service.id)} className="mr-2" />
                          <div className="flex flex-col flex-1">
                            <span>{service.name}</span>
                            {service.description && (
                              <span className="text-xs text-muted-foreground truncate max-w-[350px]">
                                {service.description}
                              </span>
                            )}
                          </div>
                          {service.category && (
                            <Badge variant="outline" className="ml-2 shrink-0">
                              {service.category}
                            </Badge>
                          )}
                          {service.price !== null && ( // Check for price not being null
                            <span className="ml-2 text-sm text-muted-foreground shrink-0">
                              ${service.price.toLocaleString()}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Selected Services Display */}
            {formData.services.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.services.map((service) => (
                  <Badge key={service.id} variant="secondary" className="flex items-center gap-1 py-1">
                    {service.name}
                    {service.price !== null && ( // Check for price not being null
                      <span className="text-xs opacity-70">(${service.price.toLocaleString()})</span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 ml-1"
                      onClick={() => toggleService(service)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Fee Adjustments */}
          <div className="space-y-2">
            <Label>Fee Adjustments</Label>
            <Textarea
              placeholder="Enter any fee adjustments or pricing discussions..."
              // Updated to use formData.fee_adjustment
              value={formData.fee_adjustment}
              onChange={(e) => setFormData((prev) => ({ ...prev, fee_adjustment: e.target.value }))}
              className="min-h-[100px]"
            />
          </div>
          {/* Added Fee Adjustment Reason */}
          <div className="space-y-2">
            <Label>Reason for Fee Adjustment</Label>
            <Textarea
              placeholder="Explain the reason for any fee adjustments..."
              value={formData.fee_adjustment_reason}
              onChange={(e) => setFormData((prev) => ({ ...prev, fee_adjustment_reason: e.target.value }))}
              className="min-h-[100px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Research Topics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Research Topics
          </CardTitle>
          <CardDescription>Document topics that require further research or follow-up</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Updated to handle research_topics as a string */}
          <div className="space-y-2">
            <Textarea
              placeholder="Enter topics that require further research or follow-up. Separate topics with a semicolon."
              value={formData.research_topics}
              onChange={(e) => setFormData((prev) => ({ ...prev, research_topics: e.target.value }))}
              className="min-h-[150px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
          <CardDescription>Notify team members about this debrief</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="notify-team"
              checked={formData.notify_team}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, notify_team: checked as boolean }))}
            />
            <Label htmlFor="notify-team">Send notification to team members</Label>
          </div>

          {formData.notify_team && (
            <div className="space-y-2">
              <Label>Notify specific team members (leave empty to notify all)</Label>
              <div className="flex flex-wrap gap-2">
                {teamMembers.map((member) => (
                  <Badge
                    key={member.id}
                    variant={formData.notification_recipients.includes(member.id) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => {
                      setFormData((prev) => {
                        const exists = prev.notification_recipients.includes(member.id)
                        return {
                          ...prev,
                          notification_recipients: exists
                            ? prev.notification_recipients.filter((id) => id !== member.id)
                            : [...prev.notification_recipients, member.id],
                        }
                      })
                    }}
                  >
                    {member.full_name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submit Button */}
      <div className="flex justify-end gap-4">
        <Button variant="outline" onClick={() => window.history.back()}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting} size="lg">
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Submit Debrief
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
