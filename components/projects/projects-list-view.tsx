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

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  Library,
  Loader2,
  Search,
  Sparkles,
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

export function ProjectsListView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeKey, setTypeKey] = useState<string>("all")
  const [status, setStatus] = useState<string>("active")
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
    const q = search.trim().toLowerCase()
    if (q) {
      arr = arr.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.client_name || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          (p.project_type_name || "").toLowerCase().includes(q) ||
          (p.project_template_title || "").toLowerCase().includes(q),
      )
    }
    return arr
  }, [projects, typeKey, search])

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
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
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
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {project.client_name}
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
            <Badge variant="outline" className="border-muted text-muted-foreground">
              {kindLabel(project.kind)}
            </Badge>
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
        </CardContent>
      </Card>
    </Link>
  )
}

// ── Create dialog ────────────────────────────────────────────────────────────
function CreateProjectDialog({
  open,
  setOpen,
  onCreated,
}: {
  open: boolean
  setOpen: (v: boolean) => void
  onCreated: () => void
}) {
  const [clientQuery, setClientQuery] = useState("")
  const [clientResults, setClientResults] = useState<
    Array<{ id: string; name: string; kind: "organization" | "contact" }>
  >([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<{ id: string; name: string; kind: "organization" | "contact" } | null>(null)
  const [name, setName] = useState("")
  const [kind, setKind] = useState<string>("monthly_bookkeeping")
  const [templatePattern, setTemplatePattern] = useState("Monthly Bookkeeping")
  const [typePattern, setTypePattern] = useState("Bookkeeping")
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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
          const kind = String(row.type || "").toLowerCase() === "organization" ? "organization" : "contact"
          items.push({ id: row.id, name: row.name || "Untitled", kind })
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

  // When the user picks a client + a kind, suggest a name.
  useEffect(() => {
    if (selected && !name) {
      const label =
        kind === "monthly_bookkeeping"
          ? "Monthly Bookkeeping"
          : kind === "quarterly_bookkeeping"
          ? "Quarterly Bookkeeping"
          : kind === "tax_return"
          ? "Tax Return"
          : kind === "payroll"
          ? "Payroll"
          : kind === "advisory"
          ? "Advisory"
          : kind === "onboarding"
          ? "Onboarding"
          : "Project"
      setName(`${selected.name} — ${label}`)
    }
  }, [selected, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sensible pattern defaults per kind
  useEffect(() => {
    if (kind === "monthly_bookkeeping") {
      setTemplatePattern("Monthly Bookkeeping")
      setTypePattern("Bookkeeping")
    } else if (kind === "quarterly_bookkeeping") {
      setTemplatePattern("Quarterly Bookkeeping")
      setTypePattern("Bookkeeping")
    } else if (kind === "payroll") {
      setTemplatePattern("")
      setTypePattern("Payroll")
    } else if (kind === "tax_return") {
      setTemplatePattern("")
      setTypePattern("Tax")
    } else if (kind === "onboarding") {
      setTemplatePattern("Onboarding")
      setTypePattern("Onboarding")
    } else if (kind === "advisory") {
      setTemplatePattern("")
      setTypePattern("Advisory")
    } else {
      setTemplatePattern("")
      setTypePattern("")
    }
  }, [kind])

  async function submit() {
    if (!selected) {
      setErr("Pick a client first.")
      return
    }
    if (!name.trim()) {
      setErr("Project name is required.")
      return
    }
    setSubmitting(true)
    setErr(null)
    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        kind,
        status: "active",
        work_template_pattern: templatePattern.trim() || null,
        work_type_pattern: typePattern.trim() || null,
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
      setSelected(null)
      setName("")
      setClientQuery("")
      setKind("monthly_bookkeeping")
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
            A project auto-attaches any Karbon work items for the chosen client whose template name or work type
            matches the patterns below — newly synced items appear automatically.
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="kind">
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-pattern">Template pattern</Label>
              <Input
                id="tpl-pattern"
                value={templatePattern}
                onChange={(e) => setTemplatePattern(e.target.value)}
                placeholder="e.g. Monthly Bookkeeping"
              />
              <p className="text-xs text-muted-foreground">Case-insensitive substring match on work template name.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-pattern">Work-type pattern</Label>
              <Input
                id="type-pattern"
                value={typePattern}
                onChange={(e) => setTypePattern(e.target.value)}
                placeholder="e.g. Bookkeeping"
              />
              <p className="text-xs text-muted-foreground">Case-insensitive substring match on work type.</p>
            </div>
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
