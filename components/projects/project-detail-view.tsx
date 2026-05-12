"use client"

/**
 * Project detail view.
 *
 * Top of page: project header (name + status + kind + dates + open work item count).
 * The "Background" section is pinned directly below the header per the brief —
 *   1. Client (org/contact info, link to client profile, link to Karbon)
 *   2. Client Systems  (QuickBooks, Stripe, Gusto, …)
 *   3. Related Services from Ignition  (the proposal-service rows for this client)
 * Tabs follow the background section so a user can drill into each artifact:
 *   • Work items  — the live-matched Karbon work items + period-grouped table
 *   • Intakes     — Jotform intake submissions for this client
 *   • Debriefs    — debrief notes + action items
 *   • Recordings  — Zoom meeting recordings tagged to this client
 *   • Meetings    — scheduled meetings (Calendly/Zoom)
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Copy,
  ExternalLink,
  FolderKanban,
  Inbox,
  Layers,
  Loader2,
  MessageSquare,
  Pencil,
  Phone,
  PlusCircle,
  Trash2,
  User,
  Video,
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────────────
type Project = {
  id: string
  name: string
  kind: string
  status: string
  description: string | null
  organization_id: string | null
  contact_id: string | null
  work_type_pattern: string | null
  work_template_pattern: string | null
  start_date: string | null
  end_date: string | null
  owner_team_member_id: string | null
  owner: { id: string; full_name: string; avatar_url: string | null } | null
  created_at: string
  updated_at: string
}

type Client = {
  kind: "organization" | "contact"
  id: string
  name: string | null
  karbon_key: string | null
  karbon_url: string | null
  email: string | null
  phone: string | null
  industry?: string | null
  entity_type?: string | null
  status?: string | null
}

type System = {
  id: string
  project_id: string
  name: string
  system_type: string | null
  url: string | null
  username: string | null
  notes: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

type WorkItem = {
  id: string
  karbon_work_item_key: string | null
  title: string | null
  work_type: string | null
  work_template_name: string | null
  status: string | null
  primary_status: string | null
  secondary_status: string | null
  workflow_status: string | null
  assignee_name: string | null
  due_date: string | null
  start_date: string | null
  completed_date: string | null
  period_start: string | null
  period_end: string | null
  karbon_url: string | null
  priority: string | null
  todo_count: number | null
  completed_todo_count: number | null
  has_blocking_todos: boolean | null
}

type RelatedService = {
  id: string
  service_name: string
  description: string | null
  billing_frequency: string | null
  billing_type: string | null
  unit_price: number | null
  total_amount: number | null
  currency: string | null
  status: string | null
  start_date: string | null
  end_date: string | null
  proposal_id: string
  proposal_title: string | null
  proposal_status: string | null
}

type Intake = {
  id: string
  jotform_submission_id: string
  jotform_created_at: string | null
  submitter_full_name: string | null
  submitter_email: string | null
  business_name: string | null
  service_focus: string | null
  services_requested: string[] | null
  lead_status: string | null
  link_method: string | null
  karbon_work_item_url: string | null
}

type Debrief = {
  id: string
  debrief_date: string | null
  debrief_type: string | null
  status: string | null
  follow_up_date: string | null
  notes: string | null
  action_items: unknown
  work_item_id: string | null
  work_item_title: string | null
  work_item_karbon_url: string | null
  team_member_full_name: string | null
  created_at: string
}

type Meeting = {
  id: string
  title: string | null
  meeting_type: string | null
  status: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  duration_minutes: number | null
  video_link: string | null
  zoom_meeting_id: string | null
}

type Recording = {
  zoom_meeting_id: number | string | null
  topic: string | null
  start_time: string | null
  duration: number | null
  status: string | null
  join_url: string | null
}

type ProjectResponse = {
  project: Project
  client: Client | null
  systems: System[]
  work_items: {
    all: WorkItem[]
    open: WorkItem[]
    completed: WorkItem[]
    total: number
    open_count: number
    completed_count: number
  }
  proposals: any[]
  related_services: RelatedService[]
  intakes: Intake[]
  debriefs: Debrief[]
  meetings: Meeting[]
  recordings: Recording[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const KIND_LABELS: Record<string, string> = {
  monthly_bookkeeping: "Monthly Bookkeeping",
  quarterly_bookkeeping: "Quarterly Bookkeeping",
  tax_return: "Tax Return",
  payroll: "Payroll",
  advisory: "Advisory",
  onboarding: "Onboarding",
  custom: "Custom",
}
function kindLabel(k: string) {
  return KIND_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

const SYSTEM_TYPES = [
  { value: "accounting", label: "Accounting" },
  { value: "payroll", label: "Payroll" },
  { value: "payments", label: "Payments" },
  { value: "banking", label: "Banking" },
  { value: "crm", label: "CRM" },
  { value: "tax", label: "Tax" },
  { value: "document_storage", label: "Document storage" },
  { value: "other", label: "Other" },
]

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}
function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(0)}`
  }
}
function statusBadgeClasses(status: string | null): string {
  const s = (status || "").toLowerCase()
  if (s.includes("complete")) return "border-blue-200 bg-blue-50 text-blue-700"
  if (s.includes("cancel") || s.includes("archived") || s.includes("lost"))
    return "border-muted bg-muted text-muted-foreground"
  if (s.includes("active") || s.includes("ready") || s.includes("in progress") || s.includes("accepted"))
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (s.includes("paused") || s.includes("waiting") || s.includes("draft") || s.includes("sent"))
    return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-muted bg-muted text-muted-foreground"
}

function isCompleted(w: WorkItem): boolean {
  const s = String(w.status || w.primary_status || "").toLowerCase()
  return s.includes("complete") || s.includes("cancel")
}

// Group work items by year-month from their period_start or start_date.
function groupByMonth(items: WorkItem[]): Array<{ key: string; label: string; items: WorkItem[] }> {
  const m = new Map<string, WorkItem[]>()
  for (const w of items) {
    const iso = w.period_start || w.start_date || w.due_date
    if (!iso) {
      const k = "unscheduled"
      const arr = m.get(k) || []
      arr.push(w)
      m.set(k, arr)
      continue
    }
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) continue
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const arr = m.get(k) || []
    arr.push(w)
    m.set(k, arr)
  }
  return Array.from(m.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([k, items]) => ({
      key: k,
      label:
        k === "unscheduled"
          ? "Unscheduled"
          : new Date(`${k}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      items,
    }))
}

// ── Main view ───────────────────────────────────────────────────────────────
export function ProjectDetailView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || "Failed to load project")
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load project")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  if (loading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col gap-3 p-6">
            <p className="text-sm text-destructive">{error || "Project not found"}</p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/projects">
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                Back to Projects
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { project, client, systems, work_items, related_services, intakes, debriefs, meetings, recordings } = data

  const periodGroups = groupByMonth(work_items.all)
  const upcomingItems = work_items.open
    .slice()
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-6 p-6">
      <ProjectHeader project={project} client={client} workItems={work_items} onReload={reload} />

      {/* ── Background ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Background</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <ClientCard client={client} />
          <SystemsCard projectId={project.id} systems={systems} onChange={reload} />
          <ServicesCard services={related_services} />
        </div>
      </section>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <Tabs defaultValue="work-items" className="flex flex-col gap-4">
        <TabsList className="w-full max-w-2xl">
          <TabsTrigger value="work-items" className="flex-1">
            Work Items
            <span className="ml-1.5 text-xs text-muted-foreground">{work_items.total}</span>
          </TabsTrigger>
          <TabsTrigger value="intakes" className="flex-1">
            Intakes
            <span className="ml-1.5 text-xs text-muted-foreground">{intakes.length}</span>
          </TabsTrigger>
          <TabsTrigger value="debriefs" className="flex-1">
            Debriefs
            <span className="ml-1.5 text-xs text-muted-foreground">{debriefs.length}</span>
          </TabsTrigger>
          <TabsTrigger value="recordings" className="flex-1">
            Recordings
            <span className="ml-1.5 text-xs text-muted-foreground">{recordings.length}</span>
          </TabsTrigger>
          <TabsTrigger value="meetings" className="flex-1">
            Meetings
            <span className="ml-1.5 text-xs text-muted-foreground">{meetings.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="work-items" className="m-0">
          <WorkItemsTab
            project={project}
            workItems={work_items}
            periodGroups={periodGroups}
            upcoming={upcomingItems}
          />
        </TabsContent>
        <TabsContent value="intakes" className="m-0">
          <IntakesTab intakes={intakes} />
        </TabsContent>
        <TabsContent value="debriefs" className="m-0">
          <DebriefsTab debriefs={debriefs} />
        </TabsContent>
        <TabsContent value="recordings" className="m-0">
          <RecordingsTab recordings={recordings} />
        </TabsContent>
        <TabsContent value="meetings" className="m-0">
          <MeetingsTab meetings={meetings} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────────────
function ProjectHeader({
  project,
  client,
  workItems,
  onReload,
}: {
  project: Project
  client: Client | null
  workItems: ProjectResponse["work_items"]
  onReload: () => void
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link href="/projects" className="inline-flex items-center gap-1 hover:text-foreground">
          <FolderKanban className="h-4 w-4" aria-hidden />
          Projects
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span>{kindLabel(project.kind)}</span>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="text-foreground">{client?.name || "Unknown client"}</span>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="max-w-3xl text-pretty text-sm text-muted-foreground">{project.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={statusBadgeClasses(project.status)}>
              {project.status}
            </Badge>
            <Badge variant="outline" className="border-muted text-muted-foreground">
              {kindLabel(project.kind)}
            </Badge>
            {project.work_template_pattern && (
              <Badge variant="outline" className="border-muted text-muted-foreground">
                Template ~ &ldquo;{project.work_template_pattern}&rdquo;
              </Badge>
            )}
            {project.work_type_pattern && (
              <Badge variant="outline" className="border-muted text-muted-foreground">
                Type ~ &ldquo;{project.work_type_pattern}&rdquo;
              </Badge>
            )}
          </div>
        </div>

        <EditProjectDialog project={project} onSaved={onReload} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open work items" value={String(workItems.open_count)} icon={CircleDot} />
        <Stat label="Completed" value={String(workItems.completed_count)} icon={CheckCircle2} />
        <Stat label="Started" value={formatDate(project.start_date)} icon={CalendarDays} />
        <Stat label="Ends" value={formatDate(project.end_date)} icon={CalendarDays} />
      </div>
    </header>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2 text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className="truncate text-lg font-semibold leading-tight">{value}</span>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Background cards ────────────────────────────────────────────────────────
function ClientCard({ client }: { client: Client | null }) {
  if (!client) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Client</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Unlinked.</CardContent>
      </Card>
    )
  }
  const Icon = client.kind === "organization" ? Building2 : User
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Client</CardTitle>
        <span className="text-xs uppercase text-muted-foreground">{client.kind}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-2 text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/clients/${client.id}`}
              className="truncate font-medium hover:underline"
              title={client.name || ""}
            >
              {client.name || "Untitled"}
            </Link>
            {client.entity_type && <span className="text-xs text-muted-foreground">{client.entity_type}</span>}
          </div>
        </div>
        {client.email && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{client.email}</span>
          </div>
        )}
        {client.phone && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Phone className="h-3.5 w-3.5" aria-hidden />
            {client.phone}
          </div>
        )}
        <div className="mt-1 flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/clients/${client.id}`}>Open profile</Link>
          </Button>
          {client.karbon_url && (
            <Button variant="ghost" size="sm" asChild>
              <a href={client.karbon_url} target="_blank" rel="noopener noreferrer">
                Karbon
                <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden />
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SystemsCard({
  projectId,
  systems,
  onChange,
}: {
  projectId: string
  systems: System[]
  onChange: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Client Systems</CardTitle>
        <AddSystemDialog projectId={projectId} onAdded={onChange} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {systems.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No systems documented yet. Track QuickBooks, Gusto, Stripe, Ramp, etc. so the team can find them quickly.
          </p>
        ) : (
          systems.map((s) => <SystemRow key={s.id} system={s} projectId={projectId} onChange={onChange} />)
        )}
      </CardContent>
    </Card>
  )
}

function SystemRow({
  system,
  projectId,
  onChange,
}: {
  system: System
  projectId: string
  onChange: () => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    if (!confirm(`Remove "${system.name}"?`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/systems/${system.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed")
      onChange()
    } catch (e) {
      console.error("[v0] delete system failed:", e)
      alert("Failed to delete system")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="group flex items-start justify-between gap-2 rounded-md border p-2.5">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{system.name}</span>
          {system.system_type && (
            <Badge variant="outline" className="border-muted text-[10px] text-muted-foreground">
              {system.system_type}
            </Badge>
          )}
        </div>
        {system.url && (
          <a
            href={system.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-xs text-primary hover:underline"
          >
            {system.url}
          </a>
        )}
        {system.username && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-mono">{system.username}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(system.username || "")}
              className="opacity-0 transition group-hover:opacity-100 hover:text-foreground"
              aria-label="Copy username"
            >
              <Copy className="h-3 w-3" aria-hidden />
            </button>
          </span>
        )}
        {system.notes && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{system.notes}</p>}
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditOpen(true)} aria-label="Edit">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive"
          onClick={remove}
          disabled={deleting}
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      <SystemDialog
        open={editOpen}
        setOpen={setEditOpen}
        projectId={projectId}
        existing={system}
        onSaved={onChange}
      />
    </div>
  )
}

function AddSystemDialog({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PlusCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
        Add
      </Button>
      <SystemDialog open={open} setOpen={setOpen} projectId={projectId} onSaved={onAdded} />
    </>
  )
}

function SystemDialog({
  open,
  setOpen,
  projectId,
  existing,
  onSaved,
}: {
  open: boolean
  setOpen: (v: boolean) => void
  projectId: string
  existing?: System
  onSaved: () => void
}) {
  const [name, setName] = useState(existing?.name || "")
  const [systemType, setSystemType] = useState(existing?.system_type || "accounting")
  const [url, setUrl] = useState(existing?.url || "")
  const [username, setUsername] = useState(existing?.username || "")
  const [notes, setNotes] = useState(existing?.notes || "")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Reset when dialog opens with new data
  useEffect(() => {
    if (open) {
      setName(existing?.name || "")
      setSystemType(existing?.system_type || "accounting")
      setUrl(existing?.url || "")
      setUsername(existing?.username || "")
      setNotes(existing?.notes || "")
      setErr(null)
    }
  }, [open, existing])

  async function save() {
    if (!name.trim()) {
      setErr("Name is required.")
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const payload = {
        name: name.trim(),
        system_type: systemType || null,
        url: url.trim() || null,
        username: username.trim() || null,
        notes: notes.trim() || null,
      }
      const url2 = existing
        ? `/api/projects/${projectId}/systems/${existing.id}`
        : `/api/projects/${projectId}/systems`
      const method = existing ? "PATCH" : "POST"
      const res = await fetch(url2, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Failed to save system")
      setOpen(false)
      onSaved()
    } catch (e: any) {
      setErr(e?.message || "Failed to save system")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit system" : "Add system"}</DialogTitle>
          <DialogDescription>
            Document the platforms this client uses so anyone on the team can find login locations quickly. Never store
            passwords here.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sys-name">Name</Label>
            <Input
              id="sys-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="QuickBooks Online"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sys-type">Type</Label>
            <Select value={systemType} onValueChange={setSystemType}>
              <SelectTrigger id="sys-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYSTEM_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sys-url">URL</Label>
            <Input id="sys-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sys-username">Username / account label</Label>
            <Input
              id="sys-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. accounting@motta.cpa"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sys-notes">Notes</Label>
            <Textarea
              id="sys-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Where credentials are stored, MFA method, anything teammates need to know."
              rows={3}
            />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {existing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServicesCard({ services }: { services: RelatedService[] }) {
  return (
    <Card>
      <CardHeader className="space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Related Services (Ignition)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {services.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No Ignition proposal services linked to this client yet.
          </p>
        ) : (
          services.slice(0, 8).map((s) => (
            <div key={s.id} className="flex flex-col gap-1 rounded-md border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{s.service_name}</span>
                  {s.proposal_title && (
                    <span className="truncate text-xs text-muted-foreground">{s.proposal_title}</span>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold">{formatMoney(s.total_amount, s.currency)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {s.billing_frequency && (
                  <Badge variant="outline" className="border-muted text-[10px] text-muted-foreground">
                    {s.billing_frequency}
                  </Badge>
                )}
                {s.status && (
                  <Badge variant="outline" className={`text-[10px] ${statusBadgeClasses(s.status)}`}>
                    {s.status}
                  </Badge>
                )}
                {s.proposal_status && (
                  <Badge variant="outline" className="border-muted text-[10px] text-muted-foreground">
                    Proposal: {s.proposal_status}
                  </Badge>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

// ── Tabs ────────────────────────────────────────────────────────────────────
function WorkItemsTab({
  workItems,
  periodGroups,
  upcoming,
}: {
  project: Project
  workItems: ProjectResponse["work_items"]
  periodGroups: Array<{ key: string; label: string; items: WorkItem[] }>
  upcoming: WorkItem[]
}) {
  return (
    <div className="flex flex-col gap-4">
      {upcoming.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Upcoming</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {upcoming.map((w) => (
              <WorkItemRow key={w.id} item={w} compact />
            ))}
          </CardContent>
        </Card>
      )}

      {workItems.all.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No Karbon work items match this project&apos;s patterns yet.
            </p>
            <p className="text-xs text-muted-foreground">
              New work items will appear here automatically as they sync from Karbon.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">All work items by period</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {periodGroups.map((g) => (
              <div key={g.key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
                  <span className="text-xs text-muted-foreground">
                    {g.items.filter((w) => !isCompleted(w)).length} open / {g.items.length} total
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {g.items.map((w) => (
                    <WorkItemRow key={w.id} item={w} />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function WorkItemRow({ item, compact = false }: { item: WorkItem; compact?: boolean }) {
  const completed = isCompleted(item)
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
        completed ? "bg-muted/30" : "bg-background"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {completed ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
        ) : (
          <CircleDot className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        )}
        <Link
          href={`/work-items?q=${encodeURIComponent(item.karbon_work_item_key || item.title || "")}`}
          className="truncate text-sm hover:underline"
          title={item.title || ""}
        >
          {item.title || item.karbon_work_item_key || "Untitled"}
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
        {!compact && item.assignee_name && <span className="hidden sm:inline">{item.assignee_name}</span>}
        {item.due_date && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" aria-hidden />
            {formatDate(item.due_date)}
          </span>
        )}
        <Badge variant="outline" className={statusBadgeClasses(item.status)}>
          {item.status || "—"}
        </Badge>
        {item.karbon_url && (
          <a
            href={item.karbon_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open in Karbon"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}

function IntakesTab({ intakes }: { intakes: Intake[] }) {
  if (intakes.length === 0) {
    return <EmptyTab icon={Inbox} label="No intake submissions for this client yet." />
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        {intakes.map((i) => (
          <div key={i.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-sm font-medium">
                {i.submitter_full_name || i.business_name || "Untitled submission"}
              </span>
              <span className="text-xs text-muted-foreground">{i.submitter_email}</span>
              {i.service_focus && (
                <Badge variant="outline" className="w-fit border-muted text-[10px] text-muted-foreground">
                  {i.service_focus}
                </Badge>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {formatDate(i.jotform_created_at)}
              {i.karbon_work_item_url && (
                <a
                  href={i.karbon_work_item_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Open Karbon work item"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DebriefsTab({ debriefs }: { debriefs: Debrief[] }) {
  if (debriefs.length === 0) {
    return <EmptyTab icon={MessageSquare} label="No debriefs recorded for this client yet." />
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        {debriefs.map((d) => {
          const actions = Array.isArray(d.action_items) ? (d.action_items as any[]) : []
          return (
            <Link
              key={d.id}
              href={`/debriefs/${d.id}`}
              className="flex flex-col gap-1.5 rounded-md border p-3 transition hover:border-primary/40 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{d.work_item_title || d.debrief_type || "Debrief"}</span>
                <span className="text-xs text-muted-foreground">{formatDate(d.debrief_date)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {d.team_member_full_name && <span>{d.team_member_full_name}</span>}
                {d.debrief_type && (
                  <Badge variant="outline" className="border-muted text-[10px] text-muted-foreground">
                    {d.debrief_type}
                  </Badge>
                )}
                {d.status && (
                  <Badge variant="outline" className={`text-[10px] ${statusBadgeClasses(d.status)}`}>
                    {d.status}
                  </Badge>
                )}
                {actions.length > 0 && (
                  <Badge variant="outline" className="border-muted text-[10px] text-muted-foreground">
                    {actions.length} action item{actions.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              {d.notes && <p className="line-clamp-2 text-xs text-muted-foreground">{d.notes}</p>}
            </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}

function RecordingsTab({ recordings }: { recordings: Recording[] }) {
  if (recordings.length === 0) {
    return <EmptyTab icon={Video} label="No Zoom recordings tagged to this client yet." />
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        {recordings.map((r, idx) => (
          <div key={`${r.zoom_meeting_id ?? idx}`} className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-sm font-medium">{r.topic || "Untitled meeting"}</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" aria-hidden />
                {formatDateTime(r.start_time)}
                {typeof r.duration === "number" && <span>· {r.duration} min</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {r.status && (
                <Badge variant="outline" className={statusBadgeClasses(r.status)}>
                  {r.status}
                </Badge>
              )}
              {r.join_url && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={r.join_url} target="_blank" rel="noopener noreferrer">
                    Open
                    <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
                  </a>
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function MeetingsTab({ meetings }: { meetings: Meeting[] }) {
  if (meetings.length === 0) {
    return <EmptyTab icon={CalendarDays} label="No scheduled meetings linked to this client yet." />
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        {meetings.map((m) => (
          <div key={m.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-sm font-medium">{m.title || "Untitled meeting"}</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" aria-hidden />
                {formatDateTime(m.scheduled_start)}
                {typeof m.duration_minutes === "number" && <span>· {m.duration_minutes} min</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {m.status && (
                <Badge variant="outline" className={statusBadgeClasses(m.status)}>
                  {m.status}
                </Badge>
              )}
              {m.video_link && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={m.video_link} target="_blank" rel="noopener noreferrer">
                    Join
                    <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
                  </a>
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function EmptyTab({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <Icon className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}

// ── Edit project ────────────────────────────────────────────────────────────
function EditProjectDialog({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || "")
  const [status, setStatus] = useState(project.status)
  const [kind, setKind] = useState(project.kind)
  const [templatePattern, setTemplatePattern] = useState(project.work_template_pattern || "")
  const [typePattern, setTypePattern] = useState(project.work_type_pattern || "")
  const [startDate, setStartDate] = useState(project.start_date?.slice(0, 10) || "")
  const [endDate, setEndDate] = useState(project.end_date?.slice(0, 10) || "")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(project.name)
      setDescription(project.description || "")
      setStatus(project.status)
      setKind(project.kind)
      setTemplatePattern(project.work_template_pattern || "")
      setTypePattern(project.work_type_pattern || "")
      setStartDate(project.start_date?.slice(0, 10) || "")
      setEndDate(project.end_date?.slice(0, 10) || "")
      setErr(null)
    }
  }, [open, project])

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          status,
          kind,
          work_template_pattern: templatePattern.trim() || null,
          work_type_pattern: typePattern.trim() || null,
          start_date: startDate || null,
          end_date: endDate || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Failed to save project")
      setOpen(false)
      onSaved()
    } catch (e: any) {
      setErr(e?.message || "Failed to save project")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="mr-2 h-4 w-4" aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea
              id="p-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Scope, notes, special considerations…"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="p-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="p-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly_bookkeeping">Monthly Bookkeeping</SelectItem>
                  <SelectItem value="quarterly_bookkeeping">Quarterly Bookkeeping</SelectItem>
                  <SelectItem value="tax_return">Tax Return</SelectItem>
                  <SelectItem value="payroll">Payroll</SelectItem>
                  <SelectItem value="advisory">Advisory</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-tpl">Template pattern</Label>
              <Input id="p-tpl" value={templatePattern} onChange={(e) => setTemplatePattern(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-type">Work-type pattern</Label>
              <Input id="p-type" value={typePattern} onChange={(e) => setTypePattern(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-start">Start date</Label>
              <Input id="p-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-end">End date</Label>
              <Input id="p-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


