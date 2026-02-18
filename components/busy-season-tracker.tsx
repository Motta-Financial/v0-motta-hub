"use client"

import { useState, useMemo, useCallback } from "react"
import useSWR from "swr"
import { useTaxWorkItems, type KarbonWorkItem } from "@/contexts/karbon-work-items-context"
import type { TeamMember } from "@/contexts/user-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Calendar,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  User,
  Flag,
  Search,
  Loader2,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Filter,
  ChevronsUpDown,
} from "lucide-react"

// ──────────────────────────────────────────────────────────────────
// TAX WORKFLOW – exact order from the Karbon workflow screenshots/SOP
// Statuses are grouped into phases for colour-coding.
// ──────────────────────────────────────────────────────────────────

interface WorkflowStage {
  status: string
  phase: "lead" | "proposal" | "onboarding" | "preparation" | "review" | "filing" | "complete" | "extension"
  step: number
  description: string
}

const TAX_WORKFLOW_STAGES: WorkflowStage[] = [
  // LEAD PHASE
  { status: "MOTTA | Work Clean Up", phase: "lead", step: 1, description: "Work item needs updating" },
  { status: "LEAD | Prospect", phase: "lead", step: 2, description: "Introduced but no serious interest yet" },
  { status: "Lead | Awaiting Intake", phase: "lead", step: 3, description: "Intake form or Calendly link sent" },
  { status: "Lead | Meeting Schd", phase: "lead", step: 4, description: "Client has scheduled a meeting" },
  { status: "MOTTA | NEED DEBRIEF", phase: "lead", step: 5, description: "Debrief form needs to be completed" },
  { status: "Lead | Discovery (Sent)", phase: "lead", step: 6, description: "Discovery requests sent to client" },
  { status: "Lead | Discovery (Rec'd)", phase: "lead", step: 7, description: "Client sent prior year returns" },
  { status: "P24 | Prior Year Input", phase: "lead", step: 8, description: "International team inputting into ProConnect" },
  // PROPOSAL PHASE
  { status: "RETURNING | Re-Engage", phase: "proposal", step: 9, description: "Returning client needs re-engagement" },
  { status: "MOTTA | PREPARE PROPOSAL", phase: "proposal", step: 10, description: "Preparing proposal based on debrief" },
  { status: "Proposal | Drafted", phase: "proposal", step: 11, description: "Proposal has been drafted" },
  { status: "MOTTA | REVIEW PROPOSAL", phase: "proposal", step: 12, description: "Project Lead reviewing proposal" },
  { status: "MOTTA | SEND PROPOSAL", phase: "proposal", step: 13, description: "Approved, ready to send via Ignition" },
  { status: "Proposal | Sent", phase: "proposal", step: 14, description: "Proposal sent, awaiting client signature" },
  // ONBOARDING PHASE
  { status: "SIGNED | Send Requests", phase: "onboarding", step: 15, description: "Signed – send document requests ASAP" },
  { status: "Client Requests | Sent", phase: "onboarding", step: 16, description: "Document requests sent to client" },
  { status: "Client Requests | Rec'd", phase: "onboarding", step: 17, description: "Client sent documents – READY FOR PREP" },
  // PREPARATION PHASE
  { status: "TAX | Initial Prep", phase: "preparation", step: 18, description: "Initial document review and preparation" },
  { status: "Actively Preparing", phase: "preparation", step: 19, description: "Preparer working on the return" },
  { status: "Prepared | Follow Ups", phase: "preparation", step: 20, description: "Draft done, awaiting client follow-ups" },
  { status: "Prepped | Client Review", phase: "preparation", step: 21, description: "Draft sent to client for review" },
  { status: "Client Follow Ups", phase: "preparation", step: 22, description: "Awaiting additional client responses" },
  { status: "Set up Chart of Accts", phase: "preparation", step: 23, description: "Setting up chart of accounts" },
  // REVIEW PHASE
  { status: "MOTTA | Prelim Review", phase: "review", step: 24, description: "Project Reviewer preliminary review" },
  { status: "Motta Review'd | Fllw Ups", phase: "review", step: 25, description: "Reviewed, awaiting preparer follow-ups" },
  { status: "Internal Review | Final", phase: "review", step: 26, description: "Final review by Project Lead" },
  // FILING PHASE
  { status: "FINAL | Sent for eSig", phase: "filing", step: 27, description: "eSignature request sent via ProConnect" },
  { status: "FINAL | Ready to eFile", phase: "filing", step: 28, description: "Ready to file – ensure accepted" },
  { status: "TAX | eFiled (Pending)", phase: "filing", step: 29, description: "Return e-filed, awaiting acceptance" },
  { status: "TAX | Return Reject", phase: "filing", step: 30, description: "Return was rejected – needs attention" },
  // COMPLETE PHASE
  { status: "COMPLETE | Ready to Bill", phase: "complete", step: 31, description: "Accepted – send final invoice" },
  { status: "COMPLETE | Filed & Billed", phase: "complete", step: 32, description: "Project complete" },
  // EXTENSION PHASE
  { status: "TAX | File Extension", phase: "extension", step: 33, description: "Extension needs to be filed" },
  { status: "TAX | Extension eFiled", phase: "extension", step: 34, description: "Extension has been e-filed" },
  { status: "FINAL | Mailed", phase: "extension", step: 35, description: "Return mailed to client" },
]

const TAX_WORKFLOW_STATUS_NAMES = TAX_WORKFLOW_STAGES.map((s) => s.status)

// Map for quick lookup
const STAGE_MAP = new Map(TAX_WORKFLOW_STAGES.map((s) => [s.status.toLowerCase(), s]))

// Phase display config
const PHASE_CONFIG: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  lead: { label: "Lead", color: "text-slate-700", bgColor: "bg-slate-100", borderColor: "border-slate-300" },
  proposal: { label: "Proposal", color: "text-amber-700", bgColor: "bg-amber-50", borderColor: "border-amber-300" },
  onboarding: { label: "Onboarding", color: "text-blue-700", bgColor: "bg-blue-50", borderColor: "border-blue-300" },
  preparation: { label: "Preparation", color: "text-violet-700", bgColor: "bg-violet-50", borderColor: "border-violet-300" },
  review: { label: "Review", color: "text-orange-700", bgColor: "bg-orange-50", borderColor: "border-orange-300" },
  filing: { label: "Filing", color: "text-emerald-700", bgColor: "bg-emerald-50", borderColor: "border-emerald-300" },
  complete: { label: "Complete", color: "text-green-700", bgColor: "bg-green-50", borderColor: "border-green-300" },
  extension: { label: "Extension", color: "text-rose-700", bgColor: "bg-rose-50", borderColor: "border-rose-300" },
}

// Work types for busy season
const BUSY_SEASON_WORK_TYPES = [
  "TAX | C-Corp (1120)",
  "TAX | Individual (1040)",
  "TAX | Individual (1040c)",
  "TAX | Non-Profit & Exempt (990)",
  "TAX | Partnership (1065)",
  "Tax | S-Corp (1120S)",
  "Tax | 709 (Gift)",
  "TAX | Foreign",
  "TAX | IRS Support",
  "TAX | Trusts & Estates",
  "TAX | Stock Comp",
  "TAX | Planning & Advisory",
  "TAX | Estimates & Forecasting",
]

const BUSY_SEASON_TAX_YEAR = 2025

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function getEntityTypeDisplay(entityType: string): { label: string; color: string } {
  if (entityType.includes("1065") || entityType.toLowerCase().includes("partnership"))
    return { label: "1065", color: "bg-blue-100 text-blue-700 border-blue-300" }
  if (entityType.includes("1120-S") || entityType.includes("1120S") || entityType.toLowerCase().includes("s-corp"))
    return { label: "1120-S", color: "bg-green-100 text-green-700 border-green-300" }
  if (entityType.includes("1120") || entityType.toLowerCase().includes("c-corp"))
    return { label: "1120", color: "bg-orange-100 text-orange-700 border-orange-300" }
  if (entityType.includes("1040"))
    return { label: "1040", color: "bg-violet-100 text-violet-700 border-violet-300" }
  if (entityType.includes("990") || entityType.toLowerCase().includes("non-profit"))
    return { label: "990", color: "bg-pink-100 text-pink-700 border-pink-300" }
  if (entityType.includes("709") || entityType.toLowerCase().includes("gift"))
    return { label: "709", color: "bg-teal-100 text-teal-700 border-teal-300" }
  return { label: entityType, color: "bg-gray-100 text-gray-700 border-gray-300" }
}

// Strip Karbon prefix: "In Progress - Actively Preparing" → "Actively Preparing"
function extractStatusSuffix(fullStatus: string): string {
  if (!fullStatus) return "Unknown"
  const prefixes = ["In Progress - ", "Ready To Start - ", "Completed - ", "Planned - ", "On Hold - "]
  for (const prefix of prefixes) {
    if (fullStatus.startsWith(prefix)) return fullStatus.substring(prefix.length)
  }
  return fullStatus
}

// Determine entity type from title / work_type
function determineEntityType(title: string, workType?: string): string {
  const t = (title + " " + (workType || "")).toLowerCase()
  if (t.includes("1040") || t.includes("individual")) return "1040 - Individual"
  if (t.includes("1065") || t.includes("partnership")) return "1065 - Partnership"
  if ((t.includes("1120s") || t.includes("1120-s") || t.includes("s-corp")) && !t.includes("c-corp"))
    return "1120-S - S-Corp"
  if (t.includes("1120") || t.includes("c-corp")) return "1120 - C-Corp"
  if (t.includes("990") || t.includes("non-profit") || t.includes("nonprofit")) return "990 - Nonprofit"
  if (t.includes("709") || t.includes("gift")) return "709 - Gift Tax"
  if (t.includes("trust") || t.includes("estate")) return "Trusts & Estates"
  return "Other"
}

function extractTaxYear(title: string): number {
  const m = title.match(/20\d{2}/)
  return m ? parseInt(m[0]) : new Date().getFullYear()
}

function extractClientName(item: KarbonWorkItem): string {
  if (item.ClientName) return item.ClientName
  const parts = (item.Title || "").split("|").map((p) => p.trim())
  return parts.length >= 3 ? parts[2] : item.Title || "Unknown"
}

function formatRelativeTime(dateString: string): string {
  const d = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  const hrs = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  if (mins < 60) return `${mins}m`
  if (hrs < 24) return `${hrs}h`
  if (days < 30) return `${days}d`
  return d.toLocaleDateString()
}

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string
  title: string
  clientName: string
  entityType: string
  workType: string
  taxYear: number
  karbonStatus: string          // raw from Karbon (with prefix)
  normalizedStatus: string      // suffix only
  phase: string
  step: number
  assigneeName: string
  dueDate: string | null
  startDate: string | null
  lastModified: string
  isPriority: boolean
  karbonUrl: string | null
  workKey: string
}

// SWR fetcher
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    let msg = res.statusText
    try { const d = await res.json(); msg = d.error || msg } catch { /* */ }
    throw new Error(msg)
  }
  return res.json()
}

// ──────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────

export function BusySeasonTracker() {
  // Shared context – all active tax work items
  const { taxWorkItems, isLoading, error: contextError, refresh } = useTaxWorkItems()

  // Team members for display
  const { data: teamData } = useSWR<{ team_members: TeamMember[] }>("/api/team-members", fetcher, {
    revalidateOnFocus: false,
  })

  // Filters
  const [searchQuery, setSearchQuery] = useState("")
  const [entityFilter, setEntityFilter] = useState<string>("all")
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all")
  const [phaseFilter, setPhaseFilter] = useState<string>("all")
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(TAX_WORKFLOW_STATUS_NAMES))
  
  // Detail dialog
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null)

  // ── Transform & filter Karbon items into QueueItems ──
  const queueItems = useMemo<QueueItem[]>(() => {
    if (!taxWorkItems?.length) return []

    return taxWorkItems
      .filter((item) => {
        const year = extractTaxYear(item.Title)
        if (year !== BUSY_SEASON_TAX_YEAR) return false
        // Only include matching tax work types
        const tl = item.Title.toLowerCase()
        return (
          tl.includes("individual") || tl.includes("1040") ||
          tl.includes("partnership") || tl.includes("1065") ||
          tl.includes("s-corp") || tl.includes("1120s") ||
          tl.includes("c-corp") || tl.includes("1120)") ||
          tl.includes("non-profit") || tl.includes("990") ||
          tl.includes("709") || tl.includes("gift") ||
          tl.includes("trust") || tl.includes("estate") ||
          tl.includes("foreign") || tl.includes("irs support") ||
          tl.includes("stock comp") || tl.includes("planning") ||
          tl.includes("estimates")
        )
      })
      .map((item): QueueItem => {
        const rawStatus = item.WorkStatus || item.status || ""
        const normalized = extractStatusSuffix(rawStatus)
        const stage = STAGE_MAP.get(normalized.toLowerCase())
        return {
          id: item.WorkKey || item.id || "",
          title: item.Title,
          clientName: extractClientName(item),
          entityType: determineEntityType(item.Title, item.WorkType),
          workType: item.WorkType || "",
          taxYear: extractTaxYear(item.Title),
          karbonStatus: rawStatus,
          normalizedStatus: normalized,
          phase: stage?.phase || "unknown",
          step: stage?.step || 999,
          assigneeName: item.AssigneeName || item.assignee_name || "",
          dueDate: item.DueDate || item.due_date || null,
          startDate: item.StartDate || item.start_date || null,
          lastModified: item.LastModifiedDateTime || item.karbon_modified_at || new Date().toISOString(),
          isPriority: item.Priority === "High" || item.priority === "High",
          karbonUrl: item.karbon_url || null,
          workKey: item.WorkKey || item.id || "",
        }
      })
  }, [taxWorkItems])

  // ── Apply filters ──
  const filteredItems = useMemo(() => {
    return queueItems.filter((item) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (
          !item.clientName.toLowerCase().includes(q) &&
          !item.title.toLowerCase().includes(q) &&
          !item.assigneeName.toLowerCase().includes(q) &&
          !item.entityType.toLowerCase().includes(q)
        )
          return false
      }
      if (entityFilter !== "all" && !item.entityType.toLowerCase().includes(entityFilter.toLowerCase())) return false
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "unassigned" && item.assigneeName) return false
        if (assigneeFilter !== "unassigned" && item.assigneeName !== assigneeFilter) return false
      }
      if (phaseFilter !== "all" && item.phase !== phaseFilter) return false
      return true
    })
  }, [queueItems, searchQuery, entityFilter, assigneeFilter, phaseFilter])

  // ── Group by workflow status (ordered) ──
  const statusGroups = useMemo(() => {
    const groups = new Map<string, QueueItem[]>()

    // Initialize in workflow order
    TAX_WORKFLOW_STAGES.forEach((stage) => {
      groups.set(stage.status, [])
    })
    groups.set("Other", [])

    filteredItems.forEach((item) => {
      // Try exact match first
      const matchKey = TAX_WORKFLOW_STATUS_NAMES.find(
        (s) => s.toLowerCase() === item.normalizedStatus.toLowerCase()
      )
      if (matchKey) {
        groups.get(matchKey)!.push(item)
      } else {
        groups.get("Other")!.push(item)
      }
    })

    // Sort items within each group by due date, then by priority
    groups.forEach((items) => {
      items.sort((a, b) => {
        if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
        const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
        return da - db
      })
    })

    // Return only non-empty groups, in order
    const result: { stage: WorkflowStage | null; status: string; items: QueueItem[] }[] = []
    TAX_WORKFLOW_STAGES.forEach((stage) => {
      const items = groups.get(stage.status)!
      if (items.length > 0) result.push({ stage, status: stage.status, items })
    })
    const other = groups.get("Other")!
    if (other.length > 0) result.push({ stage: null, status: "Other", items: other })

    return result
  }, [filteredItems])

  // ── Unique assignees for filter ──
  const uniqueAssignees = useMemo(() => {
    const names = new Set<string>()
    queueItems.forEach((item) => {
      if (item.assigneeName) names.add(item.assigneeName)
    })
    return Array.from(names).sort()
  }, [queueItems])

  // ── Phase summary counts ──
  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredItems.forEach((item) => {
      counts[item.phase] = (counts[item.phase] || 0) + 1
    })
    return counts
  }, [filteredItems])

  // ── Expand / collapse ──
  const toggleSection = useCallback((status: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.has(status) ? next.delete(status) : next.add(status)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    setExpandedSections(new Set([...TAX_WORKFLOW_STATUS_NAMES, "Other"]))
  }, [])

  const collapseAll = useCallback(() => {
    setExpandedSections(new Set())
  }, [])

  // ── Render ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            Busy Season {BUSY_SEASON_TAX_YEAR}
          </h1>
          <p className="text-muted-foreground">
            {isLoading
              ? "Loading work items..."
              : `${filteredItems.length} of ${queueItems.length} tax work items organized by workflow status`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={refresh} variant="outline" size="sm" disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Phase summary badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={`px-3 py-1.5 text-sm font-medium cursor-pointer transition-all ${
            phaseFilter === "all" ? "bg-foreground text-background border-foreground" : "hover:bg-muted"
          }`}
          onClick={() => setPhaseFilter("all")}
        >
          All ({filteredItems.length})
        </Badge>
        {Object.entries(PHASE_CONFIG).map(([phase, cfg]) => {
          const count = phaseCounts[phase] || 0
          if (count === 0) return null
          return (
            <Badge
              key={phase}
              variant="outline"
              className={`px-3 py-1.5 text-sm font-medium cursor-pointer transition-all ${cfg.bgColor} ${cfg.color} ${cfg.borderColor} ${
                phaseFilter === phase ? "ring-2 ring-offset-1 ring-current" : "hover:shadow-sm"
              }`}
              onClick={() => setPhaseFilter(phaseFilter === phase ? "all" : phase)}
            >
              {cfg.label} ({count})
            </Badge>
          )
        })}
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search client, preparer, entity..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Entity Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entity Types</SelectItem>
            <SelectItem value="1040">1040 - Individual</SelectItem>
            <SelectItem value="1065">1065 - Partnership</SelectItem>
            <SelectItem value="1120-S">1120-S - S-Corp</SelectItem>
            <SelectItem value="1120">1120 - C-Corp</SelectItem>
            <SelectItem value="990">990 - Nonprofit</SelectItem>
            <SelectItem value="709">709 - Gift Tax</SelectItem>
            <SelectItem value="trust">Trusts & Estates</SelectItem>
          </SelectContent>
        </Select>

        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-[200px]">
            <User className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assignees</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {uniqueAssignees.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Expand/Collapse controls */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {statusGroups.length} workflow {statusGroups.length === 1 ? "stage" : "stages"} with work items
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 text-xs gap-1">
            <ChevronsUpDown className="h-3 w-3" />
            Expand All
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 text-xs gap-1">
            <ChevronsUpDown className="h-3 w-3" />
            Collapse All
          </Button>
        </div>
      </div>

      {/* Main content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : contextError ? (
        <div className="text-center py-16 text-muted-foreground">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <p className="text-destructive">{contextError}</p>
          <Button onClick={refresh} variant="outline" className="mt-4">
            Try Again
          </Button>
        </div>
      ) : statusGroups.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No work items match your filters</p>
          {searchQuery && (
            <p className="text-sm mt-2">
              {'No results for "' + searchQuery + '"'}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {statusGroups.map(({ stage, status, items }) => {
            const phaseConfig = stage ? PHASE_CONFIG[stage.phase] : PHASE_CONFIG.lead
            const isExpanded = expandedSections.has(status)

            return (
              <Collapsible key={status} open={isExpanded} onOpenChange={() => toggleSection(status)}>
                <CollapsibleTrigger className="w-full">
                  <div
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer ${
                      phaseConfig?.bgColor || "bg-muted/50"
                    } ${phaseConfig?.borderColor || "border-border"} hover:opacity-90`}
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      {stage && (
                        <span className="text-xs font-mono text-muted-foreground w-6 text-right shrink-0">
                          {stage.step}
                        </span>
                      )}
                      <span className={`font-semibold ${phaseConfig?.color || "text-foreground"}`}>{status}</span>
                      <Badge
                        variant="secondary"
                        className={`text-xs ${phaseConfig?.bgColor || ""} ${phaseConfig?.color || ""}`}
                      >
                        {items.length}
                      </Badge>
                    </div>
                    {stage && (
                      <span className="text-xs text-muted-foreground hidden md:block max-w-md truncate">
                        {stage.description}
                      </span>
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1">
                    {/* Table header */}
                    <div className="grid grid-cols-[minmax(0,2fr)_100px_minmax(0,1fr)_100px_80px_80px_36px] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b">
                      <span>Client</span>
                      <span>Type</span>
                      <span>Assignee</span>
                      <span>Due Date</span>
                      <span>In Status</span>
                      <span>Priority</span>
                      <span className="sr-only">Link</span>
                    </div>
                    {/* Rows */}
                    {items.map((item) => {
                      const entityDisplay = getEntityTypeDisplay(item.entityType)
                      const isOverdue =
                        item.dueDate && new Date(item.dueDate) < new Date()

                      return (
                        <div
                          key={item.id}
                          className="grid grid-cols-[minmax(0,2fr)_100px_minmax(0,1fr)_100px_80px_80px_36px] gap-2 px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors cursor-pointer items-center"
                          onClick={() => setSelectedItem(item)}
                        >
                          {/* Client */}
                          <div className="flex items-center gap-2 min-w-0">
                            {item.isPriority && (
                              <Flag className="h-3.5 w-3.5 text-destructive fill-destructive shrink-0" />
                            )}
                            <span className="font-medium truncate">{item.clientName}</span>
                          </div>

                          {/* Entity type */}
                          <Badge variant="outline" className={`text-xs font-bold w-fit ${entityDisplay.color}`}>
                            {entityDisplay.label}
                          </Badge>

                          {/* Assignee */}
                          <div className="flex items-center gap-1.5 min-w-0 text-sm">
                            {item.assigneeName ? (
                              <>
                                <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center shrink-0">
                                  <span className="text-[10px] font-bold text-muted-foreground">
                                    {item.assigneeName
                                      .split(" ")
                                      .map((n) => n[0])
                                      .join("")
                                      .slice(0, 2)}
                                  </span>
                                </div>
                                <span className="truncate">{item.assigneeName}</span>
                              </>
                            ) : (
                              <span className="text-muted-foreground italic">Unassigned</span>
                            )}
                          </div>

                          {/* Due date */}
                          <span
                            className={`text-sm ${
                              isOverdue ? "text-destructive font-medium" : "text-muted-foreground"
                            }`}
                          >
                            {item.dueDate ? new Date(item.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "--"}
                          </span>

                          {/* In status duration */}
                          <span className="text-sm text-muted-foreground">
                            {formatRelativeTime(item.lastModified)}
                          </span>

                          {/* Priority */}
                          <span>
                            {item.isPriority ? (
                              <Badge variant="outline" className="text-[10px] bg-red-50 text-destructive border-red-200">
                                High
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">--</span>
                            )}
                          </span>

                          {/* Karbon link */}
                          {item.karbonUrl ? (
                            <a
                              href={item.karbonUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label="Open in Karbon"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-2xl">
          {selectedItem && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{selectedItem.clientName}</DialogTitle>
                <DialogDescription>
                  {selectedItem.entityType} &mdash; Tax Year {selectedItem.taxYear}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {selectedItem.karbonUrl && (
                  <a
                    href={selectedItem.karbonUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open in Karbon
                  </a>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Karbon Status
                    </label>
                    <div>
                      <Badge
                        variant="outline"
                        className={`${
                          selectedItem.phase && PHASE_CONFIG[selectedItem.phase]
                            ? `${PHASE_CONFIG[selectedItem.phase].bgColor} ${PHASE_CONFIG[selectedItem.phase].color} ${PHASE_CONFIG[selectedItem.phase].borderColor}`
                            : ""
                        }`}
                      >
                        {selectedItem.normalizedStatus}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Phase
                    </label>
                    <p className="text-sm font-medium capitalize">{selectedItem.phase}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Assignee
                    </label>
                    <div className="flex items-center gap-1.5 text-sm">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{selectedItem.assigneeName || "Unassigned"}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Work Type
                    </label>
                    <p className="text-sm">{selectedItem.workType || "--"}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Due Date
                    </label>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{selectedItem.dueDate ? new Date(selectedItem.dueDate).toLocaleDateString() : "Not set"}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Start Date
                    </label>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{selectedItem.startDate ? new Date(selectedItem.startDate).toLocaleDateString() : "Not set"}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Last Modified
                    </label>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{new Date(selectedItem.lastModified).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Priority
                    </label>
                    <div>
                      {selectedItem.isPriority ? (
                        <Badge variant="outline" className="bg-red-50 text-destructive border-red-200">
                          <Flag className="h-3 w-3 mr-1 fill-current" />
                          High Priority
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Normal</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-1 pt-2 border-t">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Full Title
                  </label>
                  <p className="text-sm">{selectedItem.title}</p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default BusySeasonTracker
