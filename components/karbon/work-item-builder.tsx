"use client"

/**
 * Karbon work-item builder — pick templates, queue up as many work items
 * as the engagement needs, create them all on submit.
 *
 * Extracted from the prospect form, which was the only surface that could
 * create from a template — and only one at a time. The intake detail
 * sheet had a single hardcoded button pinned to the Individual 1040
 * template (`4lgMRtcGXwDl`, inherited verbatim from the old Zap), so
 * every intake prospect got a 1040 work item or nothing regardless of
 * what they actually came in for. The debrief had nothing at all, even
 * though a meeting is exactly where you learn which engagements to open.
 *
 * This component owns only the DRAFTS. It never talks to Karbon —
 * creation happens server-side on submit via
 * `lib/karbon/create-work-items-batch.ts`, so the caller controls when
 * the write happens and can tie it to its own transaction/audit.
 *
 * Templates and the status taxonomy come from `/api/karbon/work-templates`,
 * which reads the locally synced tables rather than hitting Karbon live —
 * the picker stays instant and works during a Karbon outage.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { CalendarIcon, Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export interface WorkTemplate {
  key: string
  title: string
  workTypeKey: string | null
  estimatedBudgetMinutes: number | null
}

export interface WorkStatus {
  key: string
  primary: string | null
  secondary: string | null
  label: string
  workTypeKeys: string[]
}

export interface TeamMemberOption {
  id: string
  full_name: string
  email?: string
}

/** One queued work item. Serialized straight into the submit payload. */
export interface WorkItemDraft {
  /** Client-side id for list keying only — never sent to Karbon. */
  id: string
  templateKey: string
  templateTitle: string
  workTypeKey: string | null
  title: string
  /** True once the user edits the title, which stops auto-regeneration. */
  titleTouched: boolean
  assigneeTeamMemberId: string
  workStatusKey: string
  startDate: Date | null
  dueDate: Date | null
  budgetHours: string
}

export function makeWorkItemDraft(partial?: Partial<WorkItemDraft>): WorkItemDraft {
  return {
    id: crypto.randomUUID(),
    templateKey: "",
    templateTitle: "",
    workTypeKey: null,
    title: "",
    titleTouched: false,
    assigneeTeamMemberId: "",
    workStatusKey: "",
    startDate: null,
    dueDate: null,
    budgetHours: "",
    ...partial,
  }
}

interface Props {
  value: WorkItemDraft[]
  onChange: (next: WorkItemDraft[]) => void
  /** Used to auto-title: "<Template> | <Client> | <year>". */
  clientName?: string | null
  teamMembers: TeamMemberOption[]
  /** Pre-selects the assignee on newly added drafts. */
  defaultAssigneeTeamMemberId?: string | null
  /** Rendered above the list; callers give their own framing. */
  description?: string
  disabled?: boolean
}

export function WorkItemBuilder({
  value,
  onChange,
  clientName,
  teamMembers,
  defaultAssigneeTeamMemberId,
  description,
  disabled,
}: Props) {
  const [templates, setTemplates] = useState<WorkTemplate[]>([])
  const [statuses, setStatuses] = useState<WorkStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openPicker, setOpenPicker] = useState<string | null>(null)

  // Load once, lazily — only when the section is actually used. The
  // templates list is small and static enough that one fetch per mount is
  // cheaper than any caching layer we'd add around it.
  useEffect(() => {
    if (templates.length > 0 || loading) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const res = await fetch("/api/karbon/work-templates")
        if (!res.ok) throw new Error(`Failed to load templates (${res.status})`)
        const data = await res.json()
        if (cancelled) return
        setTemplates(data.templates || [])
        setStatuses(data.statuses || [])
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [templates.length, loading])

  const year = useMemo(() => String(new Date().getFullYear()), [])

  const autoTitle = useCallback(
    (templateTitle: string) => {
      const who = clientName?.trim()
      return who ? `${templateTitle} | ${who} | ${year}` : `${templateTitle} | ${year}`
    },
    [clientName, year],
  )

  const update = (id: string, patch: Partial<WorkItemDraft>) => {
    onChange(value.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  const add = () => {
    onChange([
      ...value,
      makeWorkItemDraft({
        assigneeTeamMemberId: defaultAssigneeTeamMemberId || "",
      }),
    ])
  }

  const remove = (id: string) => onChange(value.filter((d) => d.id !== id))

  const selectTemplate = (draft: WorkItemDraft, t: WorkTemplate) => {
    update(draft.id, {
      templateKey: t.key,
      templateTitle: t.title,
      workTypeKey: t.workTypeKey,
      // Regenerate the title unless the user has taken it over.
      ...(draft.titleTouched ? {} : { title: autoTitle(t.title) }),
      // A status from the previous template's work type would be invalid.
      workStatusKey: "",
      ...(t.estimatedBudgetMinutes && !draft.budgetHours
        ? { budgetHours: String(Math.round((t.estimatedBudgetMinutes / 60) * 10) / 10) }
        : {}),
    })
    setOpenPicker(null)
  }

  /** Statuses valid for a draft's template work type; all if unfiltered. */
  const statusesFor = (draft: WorkItemDraft): WorkStatus[] => {
    if (!draft.workTypeKey) return statuses
    const filtered = statuses.filter((s) => s.workTypeKeys.includes(draft.workTypeKey as string))
    return filtered.length > 0 ? filtered : statuses
  }

  return (
    <div className="space-y-4">
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}

      {loadError ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load Karbon templates: {loadError}
        </p>
      ) : null}

      {value.map((draft, idx) => {
        const available = statusesFor(draft)
        return (
          <div key={draft.id} className="space-y-4 rounded-md border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-xs">
                Work item {idx + 1}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(draft.id)}
                disabled={disabled}
                aria-label={`Remove work item ${idx + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>
                Work template <span className="text-destructive">*</span>
              </Label>
              <Popover
                open={openPicker === draft.id}
                onOpenChange={(o) => setOpenPicker(o ? draft.id : null)}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={openPicker === draft.id}
                    disabled={disabled || !templates.length}
                    className={cn(
                      "w-full justify-between font-normal",
                      !draft.templateKey && "text-muted-foreground",
                    )}
                  >
                    <span className="truncate">
                      {draft.templateTitle ||
                        (loading
                          ? "Loading templates…"
                          : templates.length
                            ? "Select a Karbon template…"
                            : "No templates available")}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command
                    filter={(v, search) =>
                      v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
                    }
                  >
                    <CommandInput placeholder="Search templates by name…" />
                    <CommandList>
                      <CommandEmpty>No templates match.</CommandEmpty>
                      <CommandGroup>
                        {templates.map((t) => (
                          <CommandItem
                            key={t.key}
                            value={t.title}
                            onSelect={() => selectTemplate(draft, t)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                draft.templateKey === t.key ? "opacity-100" : "opacity-0",
                              )}
                              aria-hidden
                            />
                            <span className="truncate">{t.title}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={draft.title}
                disabled={disabled}
                onChange={(e) => update(draft.id, { title: e.target.value, titleTouched: true })}
                placeholder="Auto-generated from the template + client"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Assignee</Label>
                <Select
                  value={draft.assigneeTeamMemberId}
                  onValueChange={(v) => update(draft.id, { assigneeTeamMemberId: v })}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select teammate…" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={draft.workStatusKey}
                  onValueChange={(v) => update(draft.id, { workStatusKey: v })}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Template default" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {available.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Start date</Label>
                <DatePick
                  value={draft.startDate}
                  disabled={disabled}
                  onChange={(d) => update(draft.id, { startDate: d })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Due date</Label>
                <DatePick
                  value={draft.dueDate}
                  disabled={disabled}
                  onChange={(d) => update(draft.id, { dueDate: d })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Budgeted hours</Label>
              <Input
                type="number"
                min="0"
                step="0.25"
                value={draft.budgetHours}
                disabled={disabled}
                onChange={(e) => update(draft.id, { budgetHours: e.target.value })}
                placeholder="Template default"
              />
            </div>
          </div>
        )
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled || (!templates.length && !loading)}
      >
        <Plus className="mr-2 h-4 w-4" />
        {value.length === 0 ? "Add a Karbon work item" : "Add another work item"}
      </Button>
    </div>
  )
}

function DatePick({
  value,
  onChange,
  disabled,
}: {
  value: Date | null
  onChange: (d: Date | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, "PPP") : "Not set"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value || undefined}
          onSelect={(d) => {
            onChange(d || null)
            setOpen(false)
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

/** Drafts that are complete enough to send. */
export function validWorkItemDrafts(drafts: WorkItemDraft[]): WorkItemDraft[] {
  return drafts.filter((d) => d.templateKey && d.title.trim())
}

/** Serialize for the API — Dates become ISO dates, hours become numbers. */
export function serializeWorkItemDrafts(drafts: WorkItemDraft[]) {
  return validWorkItemDrafts(drafts).map((d) => ({
    template_key: d.templateKey,
    title: d.title.trim(),
    work_type_key: d.workTypeKey,
    assignee_team_member_id: d.assigneeTeamMemberId || null,
    work_status_key: d.workStatusKey || null,
    start_date: d.startDate ? format(d.startDate, "yyyy-MM-dd") : null,
    due_date: d.dueDate ? format(d.dueDate, "yyyy-MM-dd") : null,
    budgeted_hours: d.budgetHours ? Number(d.budgetHours) : null,
  }))
}
