"use client"

import { useMemo, useState } from "react"
import useSWR, { mutate } from "swr"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { ExpandableCard } from "@/components/ui/expandable-card"
import { type KarbonWorkItem } from "@/contexts/karbon-work-items-context"
import {
  BOOKKEEPING_CHECKLIST,
  formatShortDate,
  getAssigneeLabel,
  getClientLabel,
  useAccountingWorkItems,
} from "./project-plan-shared"
import { CheckCircle2, CheckSquare, ChevronRight, ListChecks, Loader2, Search } from "lucide-react"

interface ProgressRow {
  step_number: number
  is_complete: boolean
  completed_at: string | null
  completed_by_name: string | null
  notes: string | null
  updated_at: string
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  return res.json()
}

// Mirrors the "Bookkeeping Checklist" tab. The 10 steps are static (defined
// in project-plan-shared.ts); only the per-step progress is persisted in
// Supabase, keyed on (work_item_id, step_number). Toggling a checkbox
// upserts a row; reloads come from SWR.
export function ProjectPlanChecklist() {
  // ACCT-scoped active items — useAccountingWorkItems already filters to
  // work_type prefix "ACCT |", so we further narrow to the bookkeeping
  // sub-type here. The 10-step workflow is bookkeeping-specific and the
  // source-of-truth tab in the Excel workbook only listed bookkeeping
  // engagements.
  const { activeWorkItems, isLoading: itemsLoading } = useAccountingWorkItems()
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const bookkeepingItems = useMemo(() => {
    return activeWorkItems
      .filter((item) => {
        const wt = (item.work_type || item.WorkType || "").toLowerCase()
        const title = (item.title || item.Title || "").toLowerCase()
        return wt.includes("bookkeeping") || title.startsWith("bkpg |")
      })
      .sort((a, b) => {
        const ad = new Date(a.due_date || a.DueDate || "9999-12-31").getTime()
        const bd = new Date(b.due_date || b.DueDate || "9999-12-31").getTime()
        return ad - bd
      })
  }, [activeWorkItems])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bookkeepingItems
    return bookkeepingItems.filter((item) => {
      const haystack = [
        item.title || item.Title,
        item.client_name || item.ClientName,
        item.assignee_name || item.AssigneeName,
        item.karbon_work_item_key || item.WorkKey,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [bookkeepingItems, search])

  const selectedItem = useMemo(
    () => bookkeepingItems.find((i) => (i.id || i.karbon_work_item_key) === selectedId) || null,
    [bookkeepingItems, selectedId],
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
      {/* Left: bookkeeping work item picker (collapsible + maximizable so
          users on tablets can fold the list away once they've selected a
          work item, freeing up screen real estate for the checklist). */}
      <ExpandableCard
        title="Bookkeeping Work Items"
        description={`${bookkeepingItems.length} active bookkeeping engagement${
          bookkeepingItems.length === 1 ? "" : "s"
        }`}
        icon={<ListChecks className="h-5 w-5 text-blue-600" />}
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client or month"
              className="pl-9"
            />
          </div>
          <div className="border rounded-lg max-h-[640px] overflow-y-auto divide-y">
            {itemsLoading && filteredItems.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                Loading…
              </div>
            ) : filteredItems.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No matches.</p>
            ) : (
              filteredItems.map((item) => {
                const id = item.id || item.karbon_work_item_key || ""
                const isSelected = id === selectedId
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedId(id)}
                    className={`w-full text-left p-3 hover:bg-muted/40 transition-colors ${
                      isSelected ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{getClientLabel(item)}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.title || item.Title}
                        </p>
                      </div>
                      <ChevronRight
                        className={`h-4 w-4 flex-shrink-0 mt-0.5 ${
                          isSelected ? "text-blue-600" : "text-muted-foreground"
                        }`}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
                      <span>{getAssigneeLabel(item)}</span>
                      <span className="tabular-nums">
                        Due {formatShortDate(item.due_date || item.DueDate)}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </ExpandableCard>

      {/* Right: checklist for the selected work item */}
      <div>
        {selectedItem ? (
          <ChecklistForWorkItem item={selectedItem} />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-muted-foreground/60" />
              <p className="text-sm">
                Select a bookkeeping work item on the left to view and update its 10-step checklist.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function ChecklistForWorkItem({ item }: { item: KarbonWorkItem }) {
  const workItemId = item.id || item.karbon_work_item_key || ""
  const endpoint = `/api/accounting/bookkeeping-checklist/${workItemId}`
  const { data, error, isLoading } = useSWR<{ progress: ProgressRow[] }>(
    workItemId ? endpoint : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [savingStep, setSavingStep] = useState<number | null>(null)
  const [draftNotes, setDraftNotes] = useState<Record<number, string>>({})
  const [completer, setCompleter] = useState<string>("")

  const progressMap = useMemo(() => {
    const map = new Map<number, ProgressRow>()
    for (const row of data?.progress ?? []) map.set(row.step_number, row)
    return map
  }, [data])

  const completedCount = useMemo(
    () => Array.from(progressMap.values()).filter((r) => r.is_complete).length,
    [progressMap],
  )
  const phase1Done = useMemo(
    () =>
      Array.from(progressMap.values()).filter((r) => r.is_complete && r.step_number <= 5).length,
    [progressMap],
  )
  const phase2Done = useMemo(
    () =>
      Array.from(progressMap.values()).filter((r) => r.is_complete && r.step_number >= 6).length,
    [progressMap],
  )

  const phase1Steps = BOOKKEEPING_CHECKLIST.filter((s) => s.step <= 5)
  const phase2Steps = BOOKKEEPING_CHECKLIST.filter((s) => s.step >= 6)

  async function persistStep(
    stepNumber: number,
    patch: Partial<{ is_complete: boolean; notes: string | null }>,
  ) {
    const existing = progressMap.get(stepNumber)
    const payload = {
      step_number: stepNumber,
      is_complete: patch.is_complete ?? existing?.is_complete ?? false,
      notes: patch.notes ?? existing?.notes ?? null,
      completed_by_name: completer.trim() || existing?.completed_by_name || null,
    }

    setSavingStep(stepNumber)
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || res.statusText)
      }
      await mutate(endpoint)
    } catch (err) {
      console.error("[v0] Failed to save checklist step:", err)
      // Soft-fail; UI will reload via SWR
    } finally {
      setSavingStep(null)
    }
  }

  return (
    <ExpandableCard
      title={getClientLabel(item)}
      // ExpandableCard's description sits under the title in the same row
      // as the chevron + maximize controls, so we keep it terse and use
      // the work-item title (often noisy) as the description.
      description={item.title || item.Title}
      icon={<CheckSquare className="h-5 w-5 text-emerald-600" />}
      // Right-rail badges show phase totals at a glance, even when the
      // body is collapsed. ExpandableCard renders these next to the
      // chevron + maximize controls in the header row.
      actions={
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
            Phase 1: {phase1Done} / 5
          </Badge>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200">
            Phase 2: {phase2Done} / 5
          </Badge>
          <Badge variant="outline" className="bg-muted text-foreground">
            Total: {completedCount} / 10
          </Badge>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <Progress value={(completedCount / 10) * 100} className="h-2" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Marking complete as
            </label>
            <Input
              placeholder="Your name (will be saved with completed steps)"
              value={completer}
              onChange={(e) => setCompleter(e.target.value)}
              className="md:max-w-sm"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Last updated:{" "}
            {data?.progress?.length ? formatShortDate(latestUpdatedAt(data.progress)) : "—"}
          </div>
        </div>

        {error ? (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            Failed to load progress: {error.message}
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <>
            <PhaseBlock
              title="Phase 1 — P24 (Preparer)"
              tone="blue"
              steps={phase1Steps}
              progressMap={progressMap}
              draftNotes={draftNotes}
              setDraftNotes={setDraftNotes}
              savingStep={savingStep}
              onToggle={(step, val) => persistStep(step, { is_complete: val })}
              onSaveNotes={(step) => persistStep(step, { notes: draftNotes[step] ?? null })}
            />
            <PhaseBlock
              title="Phase 2 — Reviewer (Andrew / Caleb / Amy / Matt)"
              tone="emerald"
              steps={phase2Steps}
              progressMap={progressMap}
              draftNotes={draftNotes}
              setDraftNotes={setDraftNotes}
              savingStep={savingStep}
              onToggle={(step, val) => persistStep(step, { is_complete: val })}
              onSaveNotes={(step) => persistStep(step, { notes: draftNotes[step] ?? null })}
            />
          </>
        )}
      </div>
    </ExpandableCard>
  )
}

function PhaseBlock({
  title,
  tone,
  steps,
  progressMap,
  draftNotes,
  setDraftNotes,
  savingStep,
  onToggle,
  onSaveNotes,
}: {
  title: string
  tone: "blue" | "emerald"
  steps: typeof BOOKKEEPING_CHECKLIST
  progressMap: Map<number, ProgressRow>
  draftNotes: Record<number, string>
  setDraftNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>
  savingStep: number | null
  onToggle: (step: number, val: boolean) => void
  onSaveNotes: (step: number) => void
}) {
  const headerToneClass =
    tone === "blue" ? "bg-blue-50 text-blue-800 border-blue-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"

  return (
    <div className="space-y-2">
      <div className={`px-3 py-1.5 rounded-md border text-sm font-medium ${headerToneClass}`}>{title}</div>
      <div className="space-y-2">
        {steps.map((step) => {
          const row = progressMap.get(step.step)
          const isComplete = row?.is_complete ?? false
          const draft = draftNotes[step.step] ?? row?.notes ?? ""
          const isSaving = savingStep === step.step
          return (
            <div
              key={step.step}
              className={`rounded-md border p-3 transition-colors ${
                isComplete ? "bg-emerald-50/40 border-emerald-200" : "bg-card"
              }`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={isComplete}
                  disabled={isSaving}
                  onCheckedChange={(checked) => onToggle(step.step, Boolean(checked))}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      Step {step.step}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{step.assignedTo}</span>
                    {row?.completed_at ? (
                      <span className="text-xs text-emerald-700">
                        Done {formatShortDate(row.completed_at)}
                        {row.completed_by_name ? ` · ${row.completed_by_name}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm">{step.task}</p>
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Notes {row?.notes ? `(${row.notes.length} chars)` : ""}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={draft}
                        onChange={(e) =>
                          setDraftNotes((prev) => ({ ...prev, [step.step]: e.target.value }))
                        }
                        placeholder="Add a note for this step…"
                        className="min-h-[60px] text-sm"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSaving || (draft === (row?.notes ?? ""))}
                          onClick={() => onSaveNotes(step.step)}
                        >
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                          Save note
                        </Button>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function latestUpdatedAt(rows: ProgressRow[]): string {
  return rows.reduce((latest, r) => (r.updated_at > latest ? r.updated_at : latest), "")
}
