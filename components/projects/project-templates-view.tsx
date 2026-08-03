"use client"

/**
 * Project Templates browser.
 *
 * Two-column layout: types on the left (Karbon `work_types` — 41 firm-wide
 * categories, the basis for Project Type), templates on the right (Karbon
 * `work_templates` — published templates, the basis for Project Template).
 *
 * "Use template" jumps to /projects with a query string that pre-fills the
 * Create Project dialog.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeft,
  Building2,
  Clock,
  Layers,
  Library,
  PlayCircle,
  Search,
  Sparkles,
} from "lucide-react"

type ProjectType = {
  key: string
  name: string
  is_active: boolean
  is_recurring: boolean
  default_budget_minutes: number | null
  template_count: number
  project_count: number
  active_project_count: number
}

type ProjectTemplate = {
  key: string
  type_key: string | null
  type_name: string | null
  title: string
  description: string | null
  estimated_budget_minutes: number | null
  estimated_time_minutes: number | null
  has_scheduled_client_task_groups: boolean | null
  published_date: string | null
  date_modified: string | null
  karbon_work_items_created: number
  date_last_work_item_created: string | null
  is_active: boolean
  hub_project_count: number
}

function formatMinutes(n: number | null): string {
  if (!n) return "—"
  const h = Math.floor(n / 60)
  const m = n % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

// Pull the prefix before the first "|" out of the work_type name to use as a
// stable group label ("ACCT", "ADVS", "TAX", "Motta", …).
function groupOf(name: string): string {
  const i = name.indexOf("|")
  return i > 0 ? name.slice(0, i).trim() : "Other"
}

export function ProjectTemplatesView() {
  const router = useRouter()
  const [types, setTypes] = useState<ProjectType[]>([])
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [selectedTypeKey, setSelectedTypeKey] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [loadingTypes, setLoadingTypes] = useState(true)
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load types once
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingTypes(true)
      try {
        const res = await fetch("/api/project-types", { cache: "no-store" })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || "Failed to load types")
        if (!cancelled) {
          const ts: ProjectType[] = (json.types || []).filter((t: ProjectType) => t.is_active)
          setTypes(ts)
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load types")
      } finally {
        if (!cancelled) setLoadingTypes(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Load templates when type filter changes
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingTemplates(true)
      try {
        const url = new URL("/api/project-templates", window.location.origin)
        if (selectedTypeKey) url.searchParams.set("typeKey", selectedTypeKey)
        const res = await fetch(url.toString(), { cache: "no-store" })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || "Failed to load templates")
        if (!cancelled) setTemplates(json.templates || [])
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load templates")
      } finally {
        if (!cancelled) setLoadingTemplates(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedTypeKey])

  const groupedTypes = useMemo(() => {
    const m = new Map<string, ProjectType[]>()
    for (const t of types) {
      const g = groupOf(t.name)
      const arr = m.get(g) || []
      arr.push(t)
      m.set(g, arr)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [types])

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.type_name || "").toLowerCase().includes(q),
    )
  }, [templates, search])

  function startProjectFromTemplate(t: ProjectTemplate) {
    const params = new URLSearchParams()
    params.set("new", "1")
    if (t.type_key) params.set("typeKey", t.type_key)
    params.set("templateKey", t.key)
    router.push(`/projects?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/projects" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Projects
          </Link>
          <span>/</span>
          <span className="text-foreground">Templates</span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Library className="h-4 w-4" />
            <span>Project Types & Templates from Karbon</span>
          </div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Project Templates
          </h1>
          <p className="max-w-3xl text-pretty text-sm text-muted-foreground">
            Project Types mirror Karbon&apos;s firm-wide work types; templates are the
            published starting points for new work. Use a template to create a Hub
            project that auto-attaches future Karbon work items of the same kind.
          </p>
        </div>
      </header>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* ── Types sidebar ─────────────────────────────────────────────── */}
        <Card className="self-start">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
              Project Types
              <span className="ml-auto text-xs text-muted-foreground">{types.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-2">
            <button
              type="button"
              onClick={() => setSelectedTypeKey(null)}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted ${
                selectedTypeKey === null ? "bg-muted font-medium" : ""
              }`}
            >
              <span>All types</span>
              <span className="text-xs text-muted-foreground">
                {types.reduce((a, t) => a + t.template_count, 0)}
              </span>
            </button>
            {loadingTypes ? (
              <div className="flex flex-col gap-2 px-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : (
              groupedTypes.map(([group, items]) => (
                <div key={group} className="flex flex-col">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </div>
                  {items.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setSelectedTypeKey(t.key)}
                      className={`flex items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition hover:bg-muted ${
                        selectedTypeKey === t.key ? "bg-muted font-medium" : ""
                      }`}
                    >
                      <span className="truncate">{t.name.replace(/^[^|]*\|\s*/, "")}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {t.template_count}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* ── Templates grid ────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates by title, type, or description…"
                className="pl-8"
                aria-label="Search templates"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {filteredTemplates.length} of {templates.length} template{templates.length === 1 ? "" : "s"}
            </span>
          </div>

          {loadingTemplates ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Sparkles className="h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">No templates match.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredTemplates.map((t) => (
                <TemplateCard
                  key={t.key}
                  template={t}
                  onUse={() => startProjectFromTemplate(t)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  onUse,
}: {
  template: ProjectTemplate
  onUse: () => void
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold leading-tight text-pretty">{template.title}</h3>
            {template.type_name && (
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {template.type_name}
              </p>
            )}
          </div>
          {template.hub_project_count > 0 && (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              {template.hub_project_count} in use
            </Badge>
          )}
        </div>

        {template.description && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{template.description}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {formatMinutes(template.estimated_budget_minutes)} budget
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" aria-hidden />
            {template.karbon_work_items_created} created in Karbon
          </span>
          <span className="ml-auto">Updated {formatDate(template.date_modified)}</span>
        </div>

        <Button onClick={onUse} className="w-full" size="sm">
          <PlayCircle className="mr-2 h-4 w-4" aria-hidden />
          Start project from template
        </Button>
      </CardContent>
    </Card>
  )
}
