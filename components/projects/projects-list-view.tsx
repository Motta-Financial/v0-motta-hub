"use client"

/**
 * Projects list view.
 *
 * Lists all Project records (e.g. "Acme Corp — Monthly Bookkeeping"), each
 * with a live work-item count. Filtering is client-side on the already-fetched
 * collection — projects total ~50-100 rows in practice, so that's fast and
 * keeps the filter UI snappy.
 *
 * Project Type / Project Template are sourced from the Karbon
 * `work_types` / `work_templates` tables — we treat Karbon as the source of
 * truth so any new work_type the firm publishes shows up here automatically.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CircleDot,
  ClipboardList,
  FolderKanban,
  Layers,
  Library,
  Loader2,
  Search,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

type ProjectRow = {
  id: string
  name: string
  kind: string
  status: string
  description: string | null
  organization_id: string | null
  contact_id: string | null
  project_type_key: string | null
  project_template_key: string | null
  project_type_name: string | null
  project_template_title: string | null
  work_type_pattern: string | null
  work_template_pattern: string | null
  start_date: string | null
  end_date: string | null
  client_name: string
  client_kind: "organization" | "contact"
  client_id: string | null
  client_count: number
  clients: Array<{
    id: string
    kind: "organization" | "contact"
    client_id: string
    name: string
    role: string
    is_primary: boolean
  }>
  karbon_url: string | null
  work_item_count: number
  open_work_item_count: number
  next_due_date: string | null
  owner_team_member_id: string | null
  owner_name: string | null
  owner_avatar_url: string | null
  team: Array<{ id: string; name: string; open_count: number }>
}

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

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "paused":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "completed":
      return "border-blue-200 bg-blue-50 text-blue-700"
    case "archived":
    default:
      return "border-muted bg-muted text-muted-foreground"
  }
}

function statusDotClasses(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-500"
    case "paused":
      return "bg-amber-500"
    case "completed":
      return "bg-blue-500"
    case "archived":
    default:
      return "bg-muted-foreground/50"
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function ProjectsListView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeKey, setTypeKey] = useState<string>("all")
  const [status, setStatus] = useState<string>("all")
  const [assigneeId, setAssigneeId] = useState<string>("all")
  const [search, setSearch] = useState<string>("")
  const [createOpen, setCreateOpen] = useState(false)
  const [prefill, setPrefill] = useState<{ typeKey?: string | null; templateKey?: string | null }>({})

  // Open the Create dialog when ?new=1 is in the URL (e.g. coming from the
  // Project Templates page after picking a template).
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setPrefill({
        typeKey: searchParams.get("typeKey"),
        templateKey: searchParams.get("templateKey"),
      })
      setCreateOpen(true)
    }
  }, [searchParams])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const url = new URL("/api/projects", window.location.origin)
      if (status !== "all") url.searchParams.set("status", status)
      const res = await fetch(url.toString(), { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Failed to load projects")
      setProjects(json.projects || [])
    } catch (e: any) {
      console.error("[v0] projects list load failed:", e?.message || e)
      setError(e?.message || "Failed to load projects")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const filtered = useMemo(() => {
    let arr = projects
    if (typeKey !== "all") {
      arr = arr.filter((p) => p.project_type_key === typeKey)
    }
    if (assigneeId !== "all") {
      arr = arr.filter((p) => (p.team || []).some((t) => t.id === assigneeId))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      arr = arr.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.client_name || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          (p.project_type_name || "").toLowerCase().includes(q) ||
          (p.project_template_title || "").toLowerCase().includes(q) ||
          (p.team || []).some((t) => t.name.toLowerCase().includes(q)),
      )
    }
    return arr
  }, [projects, typeKey, assigneeId, search])

  // ── Dashboard aggregates (computed over the full loaded set) ──
  const stats = useMemo(() => {
    let openWorkItems = 0
    let dueSoon = 0
    const now = new Date()
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    for (const p of projects) {
      openWorkItems += p.open_work_item_count || 0
      if (p.next_due_date) {
        const d = new Date(p.next_due_date)
        if (!Number.isNaN(d.getTime()) && d <= in7) dueSoon += 1
      }
    }
    return {
      total: projects.length,
      active: projects.filter((p) => p.status === "active").length,
      openWorkItems,
      dueSoon,
    }
  }, [projects])

  const statusCounts = useMemo(() => {
    const order = ["active", "paused", "completed", "archived"]
    const m = new Map<string, number>()
    for (const p of projects) m.set(p.status, (m.get(p.status) || 0) + 1)
    return order
      .filter((s) => m.has(s))
      .map((s) => ({ status: s, count: m.get(s) || 0 }))
      .concat(
        Array.from(m.entries())
          .filter(([s]) => !order.includes(s))
          .map(([status, count]) => ({ status, count })),
      )
  }, [projects])

  const assigneeCounts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number; openCount: number }>()
    for (const p of projects) {
      for (const t of p.team || []) {
        const cur = m.get(t.id) || { id: t.id, name: t.name, count: 0, openCount: 0 }
        cur.count += 1
        cur.openCount += t.open_count || 0
        m.set(t.id, cur)
      }
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count)
  }, [projects])

  const groups = useMemo(() => {
    const m = new Map<string, ProjectRow[]>()
    for (const p of filtered) {
      const key = p.project_type_name || kindLabel(p.kind)
      const arr = m.get(key) || []
      arr.push(p)
      m.set(key, arr)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const typeCounts = useMemo(() => {
    const m = new Map<string, { count: number; name: string }>()
    for (const p of projects) {
      if (!p.project_type_key) continue
      const cur = m.get(p.project_type_key) || {
        count: 0,
        name: p.project_type_name || p.project_type_key,
      }
      cur.count += 1
      m.set(p.project_type_key, cur)
    }
    return m
  }, [projects])

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FolderKanban className="h-4 w-4" />
            <span>Engagement-level view of your client work</span>
          </div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Each project groups Karbon work items into one engagement, sourced from the
            firm&apos;s published <strong>Project Types</strong> and <strong>Templates</strong>.
            New work items appear automatically as they sync.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/projects/templates">
              <Library className="mr-2 h-4 w-4" aria-hidden />
              Browse templates
            </Link>
          </Button>
          <CreateProjectDialog
            open={createOpen}
            setOpen={(v) => {
              setCreateOpen(v)
              if (!v) {
                setPrefill({})
                // Strip the new=1 query when the dialog closes.
                if (searchParams.get("new")) router.replace("/projects")
              }
            }}
            onCreated={load}
            prefill={prefill}
          />
        </div>
      </header>

      {/* ── Dashboard ────────────────────────────────────────────── */}
      {!loading && projects.length > 0 && (
        <div className="flex flex-col gap-4">
          {/* Headline stat tiles */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              icon={<FolderKanban className="h-4 w-4" aria-hidden />}
              label="Total projects"
              value={stats.total}
            />
            <StatTile
              icon={<CircleDot className="h-4 w-4 text-emerald-600" aria-hidden />}
              label="Active"
              value={stats.active}
            />
            <StatTile
              icon={<ClipboardList className="h-4 w-4" aria-hidden />}
              label="Open work items"
              value={stats.openWorkItems}
            />
            <StatTile
              icon={<CalendarClock className="h-4 w-4 text-amber-600" aria-hidden />}
              label="Due within 7 days"
              value={stats.dueSoon}
            />
          </div>

          {/* Breakdown cards */}
          <div className="grid gap-3 lg:grid-cols-3">
            {/* By Status */}
            <BreakdownCard
              title="By Status"
              icon={<Layers className="h-4 w-4" aria-hidden />}
              onClear={status !== "all" ? () => setStatus("all") : undefined}
            >
              {statusCounts.map((s) => (
                <button
                  key={s.status}
                  type="button"
                  onClick={() => setStatus(status === s.status ? "all" : s.status)}
                  aria-pressed={status === s.status}
                  className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm transition hover:bg-muted/60 ${
                    status === s.status ? "border-primary/50 bg-primary/5" : "border-transparent"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDotClasses(s.status)}`} aria-hidden />
                    {statusLabel(s.status)}
                  </span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                </button>
              ))}
            </BreakdownCard>

            {/* By Type */}
            <BreakdownCard
              title="By Type"
              icon={<FolderKanban className="h-4 w-4" aria-hidden />}
              onClear={typeKey !== "all" ? () => setTypeKey("all") : undefined}
            >
              {Array.from(typeCounts.entries())
                .sort(([, a], [, b]) => b.count - a.count)
                .slice(0, 6)
                .map(([key, info]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTypeKey(typeKey === key ? "all" : key)}
                    aria-pressed={typeKey === key}
                    className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm transition hover:bg-muted/60 ${
                      typeKey === key ? "border-primary/50 bg-primary/5" : "border-transparent"
                    }`}
                  >
                    <span className="truncate pr-2">{info.name}</span>
                    <span className="font-semibold tabular-nums">{info.count}</span>
                  </button>
                ))}
              {typeCounts.size === 0 && (
                <p className="px-2.5 py-1.5 text-sm text-muted-foreground">No typed projects.</p>
              )}
            </BreakdownCard>

            {/* By Assignee */}
            <BreakdownCard
              title="By Assignee"
              icon={<Users className="h-4 w-4" aria-hidden />}
              onClear={assigneeId !== "all" ? () => setAssigneeId("all") : undefined}
            >
              {assigneeCounts.slice(0, 6).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAssigneeId(assigneeId === a.id ? "all" : a.id)}
                  aria-pressed={assigneeId === a.id}
                  className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm transition hover:bg-muted/60 ${
                    assigneeId === a.id ? "border-primary/50 bg-primary/5" : "border-transparent"
                  }`}
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Avatar className="h-5 w-5 shrink-0">
                      <AvatarFallback className="text-[10px]">{initials(a.name)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{a.name}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{a.count}</span>
                </button>
              ))}
              {assigneeCounts.length === 0 && (
                <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                  No assignees on matched work items.
                </p>
              )}
            </BreakdownCard>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by client, project name, description…"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>
        <Select value={typeKey} onValueChange={setTypeKey}>
          <SelectTrigger className="w-[260px]" aria-label="Filter by project type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All project types ({projects.length})</SelectItem>
            {Array.from(typeCounts.entries())
              .sort(([, a], [, b]) => a.name.localeCompare(b.name))
              .map(([key, info]) => (
                <SelectItem key={key} value={key}>
                  {info.name} ({info.count})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger className="w-[200px]" aria-label="Filter by assignee">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees ({assigneeCounts.length})</SelectItem>
            {assigneeCounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} ({a.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No projects match your filters.</p>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              Create a project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(([groupName, rows]) => (
            <section key={groupName} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {groupName}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {rows.length} project{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectRow }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block focus:outline-none"
      aria-label={`Open project ${project.name}`}
    >
      <Card className="h-full transition hover:border-primary/40 hover:shadow-sm">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="truncate">{project.client_name}</span>
                {project.client_count > 1 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <Users className="h-3 w-3" aria-hidden />+{project.client_count - 1}
                  </span>
                )}
              </p>
              <h3 className="text-base font-semibold leading-tight text-pretty group-hover:text-primary">
                {project.name}
              </h3>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" aria-hidden />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={statusBadgeClasses(project.status)}>
              {project.status}
            </Badge>
            {project.project_type_name && (
              <Badge variant="outline" className="border-muted text-muted-foreground">
                {project.project_type_name}
              </Badge>
            )}
            {project.project_template_title && (
              <Badge
                variant="outline"
                className="max-w-[180px] truncate border-blue-200 bg-blue-50 text-blue-700"
                title={project.project_template_title}
              >
                {project.project_template_title}
              </Badge>
            )}
          </div>

          <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
              <span className="font-medium text-foreground">{project.open_work_item_count}</span>
              <span>open / {project.work_item_count} total</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Next: {formatDate(project.next_due_date)}
            </span>
          </div>

          {/* Owner + assignee row */}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {project.owner_name ? (
                <span className="truncate">{project.owner_name}</span>
              ) : (
                <span className="italic">No owner</span>
              )}
            </span>
            {project.team && project.team.length > 0 ? (
              <span className="flex items-center -space-x-1.5" aria-label="Assignees">
                {project.team.slice(0, 4).map((t) => (
                  <Avatar key={t.id} className="h-5 w-5 border border-background" title={t.name}>
                    {project.owner_team_member_id === t.id && project.owner_avatar_url ? (
                      <AvatarImage src={project.owner_avatar_url || "/placeholder.svg"} alt={t.name} />
                    ) : null}
                    <AvatarFallback className="text-[9px]">{initials(t.name)}</AvatarFallback>
                  </Avatar>
                ))}
                {project.team.length > 4 && (
                  <span className="ml-2.5 text-[10px] text-muted-foreground">
                    +{project.team.length - 4}
                  </span>
                )}
              </span>
            ) : (
              <span className="italic">Unassigned</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-2xl font-semibold leading-none tabular-nums">{value}</span>
          <span className="truncate text-xs text-muted-foreground">{label}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function BreakdownCard({
  title,
  icon,
  onClear,
  children,
}: {
  title: string
  icon: ReactNode
  onClear?: () => void
  children: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
            <span className="text-muted-foreground">{icon}</span>
            {title}
          </h3>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

// ── Create dialog ────────────────────────────────────────────────────────────
type WorkTypeRow = {
  id: string
  karbon_work_type_key: string
  name: string
  is_recurring: boolean | null
}
type WorkTemplateRow = {
  karbon_work_template_key: string
  karbon_work_type_key: string | null
  title: string
  estimated_budget_minutes: number | null
}

function CreateProjectDialog({
  open,
  setOpen,
  onCreated,
  prefill,
}: {
  open: boolean
  setOpen: (v: boolean) => void
  onCreated: () => void
  prefill?: { typeKey?: string | null; templateKey?: string | null }
}) {
  const [clientQuery, setClientQuery] = useState("")
  const [clientResults, setClientResults] = useState<
    Array<{ id: string; name: string; kind: "organization" | "contact" }>
  >([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<{ id: string; name: string; kind: "organization" | "contact" } | null>(null)
  const [name, setName] = useState("")
  const [typeKey, setTypeKey] = useState<string>("")
  const [templateKey, setTemplateKey] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // ── Karbon types/templates load (pulled from project_types_published view) ──
  const [types, setTypes] = useState<WorkTypeRow[]>([])
  const [templates, setTemplates] = useState<WorkTemplateRow[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const [tRes, tplRes] = await Promise.all([
          fetch("/api/project-types?limit=200", { cache: "no-store" }),
          fetch("/api/project-templates?limit=500", { cache: "no-store" }),
        ])
        const t = await tRes.json()
        const tpl = await tplRes.json()
        if (cancelled) return
        setTypes(t?.types || [])
        setTemplates(tpl?.templates || [])
      } catch (e) {
        console.error("[v0] load types/templates failed:", e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Apply prefill once data loads.
  useEffect(() => {
    if (!open) return
    if (prefill?.typeKey && !typeKey) setTypeKey(prefill.typeKey)
    if (prefill?.templateKey && !templateKey) setTemplateKey(prefill.templateKey)
  }, [open, prefill, typeKey, templateKey])

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setSelected(null)
      setName("")
      setTypeKey("")
      setTemplateKey("")
      setClientQuery("")
      setClientResults([])
      setErr(null)
    }
  }, [open])

  // Client search.
  useEffect(() => {
    let cancelled = false
    const q = clientQuery.trim()
    if (q.length < 2) {
      setClientResults([])
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?search=${encodeURIComponent(q)}&limit=15`, { cache: "no-store" })
        const json = await res.json()
        if (cancelled) return
        const items: Array<{ id: string; name: string; kind: "organization" | "contact" }> = []
        for (const row of json?.clients || []) {
          const k = String(row.type || "").toLowerCase() === "organization" ? "organization" : "contact"
          items.push({ id: row.id, name: row.name || "Untitled", kind: k })
        }
        setClientResults(items.slice(0, 12))
      } catch {
        if (!cancelled) setClientResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [clientQuery])

  // Suggest a project name when client + type/template are known.
  const selectedType = useMemo(() => types.find((t) => t.karbon_work_type_key === typeKey) || null, [types, typeKey])
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.karbon_work_template_key === templateKey) || null,
    [templates, templateKey],
  )

  // Filter templates to the chosen type (when set).
  const filteredTemplates = useMemo(() => {
    const arr = typeKey ? templates.filter((t) => t.karbon_work_type_key === typeKey) : templates
    return arr.slice().sort((a, b) => a.title.localeCompare(b.title))
  }, [templates, typeKey])

  // When a template is picked, auto-set its type if not already set.
  useEffect(() => {
    if (selectedTemplate && !typeKey && selectedTemplate.karbon_work_type_key) {
      setTypeKey(selectedTemplate.karbon_work_type_key)
    }
  }, [selectedTemplate, typeKey])

  // Auto-suggest a project name.
  useEffect(() => {
    if (!selected || name) return
    const label = selectedTemplate?.title || selectedType?.name || "Project"
    setName(`${selected.name} — ${label}`)
  }, [selected, selectedTemplate, selectedType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Map Karbon type → legacy `kind` enum (for backwards compatibility).
  function kindForType(typeName: string | undefined): string {
    const n = (typeName || "").toLowerCase()
    if (n.includes("monthly") && n.includes("bookkeeping")) return "monthly_bookkeeping"
    if (n.includes("quarterly") && n.includes("bookkeeping")) return "quarterly_bookkeeping"
    if (n.includes("bookkeeping")) return "monthly_bookkeeping"
    if (n.includes("tax")) return "tax_return"
    if (n.includes("payroll")) return "payroll"
    if (n.includes("advisory") || n.includes("cas")) return "advisory"
    if (n.includes("onboarding")) return "onboarding"
    return "custom"
  }

  async function submit() {
    if (!selected) {
      setErr("Pick a client first.")
      return
    }
    if (!name.trim()) {
      setErr("Project name is required.")
      return
    }
    if (!typeKey && !templateKey) {
      setErr("Pick a project type or template.")
      return
    }
    setSubmitting(true)
    setErr(null)
    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        kind: kindForType(selectedTemplate?.title || selectedType?.name),
        status: "active",
        project_type_key: typeKey || selectedTemplate?.karbon_work_type_key || null,
        project_template_key: templateKey || null,
        // Keep the legacy substring patterns populated so the existing
        // `projectMatches` work-item filter keeps attaching items.
        work_type_pattern: selectedType?.name || null,
        work_template_pattern: selectedTemplate?.title || null,
      }
      if (selected.kind === "organization") payload.organization_id = selected.id
      else payload.contact_id = selected.id

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Failed to create project")
      setOpen(false)
      onCreated()
    } catch (e: any) {
      setErr(e?.message || "Failed to create project")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FolderKanban className="mr-2 h-4 w-4" aria-hidden />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Pick a Project Type and/or Template — these come straight from your firm&apos;s
            published Karbon library, so newly synced work items in that template auto-attach
            to this project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-search">Client</Label>
            {selected ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span>
                  {selected.name}{" "}
                  <span className="text-xs text-muted-foreground">({selected.kind})</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="client-search"
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                  placeholder="Search organizations or contacts…"
                />
                {searching ? (
                  <p className="text-xs text-muted-foreground">Searching…</p>
                ) : clientResults.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto rounded-md border">
                    {clientResults.map((r) => (
                      <button
                        type="button"
                        key={`${r.kind}-${r.id}`}
                        onClick={() => setSelected(r)}
                        className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                      >
                        <span>{r.name}</span>
                        <span className="text-xs uppercase text-muted-foreground">{r.kind}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            <p className="text-xs text-muted-foreground">
              You can link additional clients (spouse, related entities, etc.) after the
              project is created.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-key">Project type</Label>
              <Select value={typeKey || "__none"} onValueChange={(v) => setTypeKey(v === "__none" ? "" : v)}>
                <SelectTrigger id="type-key">
                  <SelectValue placeholder="Pick a type…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {types
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((t) => (
                      <SelectItem key={t.karbon_work_type_key} value={t.karbon_work_type_key}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-key">Template</Label>
              <Select
                value={templateKey || "__none"}
                onValueChange={(v) => setTemplateKey(v === "__none" ? "" : v)}
              >
                <SelectTrigger id="tpl-key">
                  <SelectValue placeholder="Optional template…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— No template —</SelectItem>
                  {filteredTemplates.map((t) => (
                    <SelectItem key={t.karbon_work_template_key} value={t.karbon_work_template_key}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Project name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !selected}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type { ProjectRow }
