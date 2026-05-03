"use client"

/**
 * Global search palette — opens with Cmd/Ctrl+K from anywhere in the app.
 *
 * Hits `/api/search?q=...` which fans out across five entities:
 *   - Work Items (Karbon)
 *   - Clients (organizations + contacts)
 *   - Debriefs
 *   - Invoices (Ignition)
 *   - Proposals (Ignition)
 *
 * Originally this component was scoped to work items only — we keep the
 * exported names `WorkItemSearchTrigger` / `WorkItemSearchDialog` so the
 * dashboard-layout import keeps working without churn, but the underlying
 * behaviour and UI are now fully entity-agnostic.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import {
  Search,
  Loader2,
  FileText,
  Building2,
  User,
  Calendar,
  Briefcase,
  MessageSquare,
  Receipt,
  ClipboardList,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// Response shape (mirrors /api/search/route.ts)
// ─────────────────────────────────────────────────────────────────────────────

type WorkItemHit = {
  id: string
  karbonKey: string | null
  title: string
  clientName: string | null
  workType: string | null
  status: string | null
  dueDate: string | null
  completedDate: string | null
  assigneeName: string | null
  karbonUrl: string | null
  href: string
}
type ClientHit = {
  id: string
  kind: "contact" | "organization"
  href: string
  name: string
  subtitle: string | null
  city: string | null
  state: string | null
  isProspect?: boolean
}
type DebriefHit = {
  id: string
  date: string | null
  debriefType: string | null
  status: string | null
  snippet: string | null
  clientName: string | null
  workItemTitle: string | null
  teamMemberName: string | null
  href: string
}
type InvoiceHit = {
  id: string
  invoiceNumber: string | null
  status: string | null
  amount: number | null
  amountOutstanding: number | null
  currency: string | null
  invoiceDate: string | null
  dueDate: string | null
  stripeInvoiceId: string | null
  clientName: string | null
  href: string
}
type ProposalHit = {
  id: string
  proposalNumber: string | null
  title: string | null
  status: string | null
  totalValue: number | null
  currency: string | null
  clientName: string | null
  acceptedAt: string | null
  sentAt: string | null
  createdAt: string | null
  href: string
}
type SearchResponse = {
  query: string
  workItems: WorkItemHit[]
  clients: ClientHit[]
  debriefs: DebriefHit[]
  invoices: InvoiceHit[]
  proposals: ProposalHit[]
  totals: {
    workItems: number
    clients: number
    debriefs: number
    invoices: number
    proposals: number
  }
}

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<SearchResponse>
  })

// ─────────────────────────────────────────────────────────────────────────────
// Hooks + small helpers
// ─────────────────────────────────────────────────────────────────────────────

function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function statusTone(status?: string | null) {
  const s = (status || "").toLowerCase()
  if (s.includes("complete") || s === "paid" || s === "accepted") {
    return "bg-emerald-100 text-emerald-700 border-emerald-200"
  }
  if (s.includes("progress") || s === "sent") return "bg-blue-100 text-blue-700 border-blue-200"
  if (s.includes("ready") || s === "draft") return "bg-amber-100 text-amber-700 border-amber-200"
  if (s.includes("plan")) return "bg-slate-100 text-slate-700 border-slate-200"
  if (s.includes("wait") || s.includes("hold") || s === "outstanding" || s === "overdue") {
    return "bg-orange-100 text-orange-700 border-orange-200"
  }
  if (s.includes("cancel") || s === "lost" || s === "voided") {
    return "bg-rose-100 text-rose-700 border-rose-200"
  }
  return "bg-stone-100 text-stone-700 border-stone-200"
}

function formatDate(d?: string | null) {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatCurrency(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null) return null
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `$${value.toFixed(0)}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger button — lives in the topbar
// ─────────────────────────────────────────────────────────────────────────────

export function WorkItemSearchTrigger({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false)

  // Cmd+K (Mac) / Ctrl+K (Windows) opens the palette globally.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          "h-9 w-full justify-start gap-2 bg-background/60 text-muted-foreground",
          "hover:bg-background hover:text-foreground",
          className,
        )}
        aria-label="Search clients, work items, debriefs, invoices, and proposals"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left text-sm">
          Search clients, work items, debriefs, invoices…
        </span>
        <kbd className="pointer-events-none hidden items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
          <span className="text-xs">
            {typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform)
              ? "⌘"
              : "Ctrl"}
          </span>
          K
        </kbd>
      </Button>
      <WorkItemSearchDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Dialog — the actual command palette
// ─────────────────────────────────────────────────────────────────────────────

export function WorkItemSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [q, setQ] = React.useState("")
  const debouncedQ = useDebounced(q, 200)
  const router = useRouter()

  React.useEffect(() => {
    if (!open) setQ("")
  }, [open])

  const trimmed = debouncedQ.trim()
  const shouldFetch = open && trimmed.length >= 2

  const params = new URLSearchParams()
  params.set("q", trimmed)
  params.set("limit", "8")

  const { data, error, isLoading } = useSWR<SearchResponse>(
    shouldFetch ? `/api/search?${params.toString()}` : null,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )

  const totalHits =
    (data?.workItems.length || 0) +
    (data?.clients.length || 0) +
    (data?.debriefs.length || 0) +
    (data?.invoices.length || 0) +
    (data?.proposals.length || 0)

  // Helper that navigates and closes the palette in one step. We use the
  // Next router (not <Link>) because cmdk's CommandItem needs to stay a
  // button-ish element to keep keyboard navigation behaving naturally.
  function go(href: string) {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search across clients, work items, debriefs, invoices, and proposals. Press Esc to close."
    >
      <CommandInput
        placeholder="Search clients, work items, debriefs, invoices, proposals…"
        value={q}
        onValueChange={setQ}
        autoFocus
      />
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span>
          {shouldFetch ? (
            isLoading && !data ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Searching…
              </span>
            ) : error ? (
              <span className="text-rose-600">Error: {String((error as Error).message)}</span>
            ) : (
              <span>
                {totalHits} match{totalHits === 1 ? "" : "es"} across{" "}
                {[
                  data?.workItems.length && "work items",
                  data?.clients.length && "clients",
                  data?.debriefs.length && "debriefs",
                  data?.invoices.length && "invoices",
                  data?.proposals.length && "proposals",
                ]
                  .filter(Boolean)
                  .join(", ") || "no categories"}
              </span>
            )
          ) : (
            <span>Type at least 2 characters</span>
          )}
        </span>
      </div>
      <CommandList className="max-h-[60vh]">
        {!shouldFetch && (
          <CommandEmpty>
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Search className="mx-auto mb-2 h-6 w-6 opacity-40" />
              Search clients, work items, debriefs, invoices, and proposals.
            </div>
          </CommandEmpty>
        )}
        {shouldFetch && !isLoading && totalHits === 0 && (
          <CommandEmpty>
            <div className="py-8 text-center text-sm text-muted-foreground">
              No matches for &ldquo;{trimmed}&rdquo;.
            </div>
          </CommandEmpty>
        )}

        {data?.clients.length ? (
          <CommandGroup heading={`Clients (${data.clients.length})`}>
            {data.clients.map((c) => (
              <ClientRow key={`${c.kind}-${c.id}`} hit={c} onSelect={() => go(c.href)} />
            ))}
          </CommandGroup>
        ) : null}

        {data?.workItems.length ? (
          <>
            {data.clients.length ? <CommandSeparator /> : null}
            <CommandGroup heading={`Work Items (${data.workItems.length})`}>
              {data.workItems.map((w) => (
                <WorkItemRow key={w.id} hit={w} onSelect={() => go(w.href)} />
              ))}
            </CommandGroup>
          </>
        ) : null}

        {data?.debriefs.length ? (
          <>
            {data.clients.length || data.workItems.length ? <CommandSeparator /> : null}
            <CommandGroup heading={`Debriefs (${data.debriefs.length})`}>
              {data.debriefs.map((d) => (
                <DebriefRow key={d.id} hit={d} onSelect={() => go(d.href)} />
              ))}
            </CommandGroup>
          </>
        ) : null}

        {data?.invoices.length ? (
          <>
            {data.clients.length || data.workItems.length || data.debriefs.length ? (
              <CommandSeparator />
            ) : null}
            <CommandGroup heading={`Invoices (${data.invoices.length})`}>
              {data.invoices.map((inv) => (
                <InvoiceRow key={inv.id} hit={inv} onSelect={() => go(inv.href)} />
              ))}
            </CommandGroup>
          </>
        ) : null}

        {data?.proposals.length ? (
          <>
            {data.clients.length ||
            data.workItems.length ||
            data.debriefs.length ||
            data.invoices.length ? (
              <CommandSeparator />
            ) : null}
            <CommandGroup heading={`Proposals (${data.proposals.length})`}>
              {data.proposals.map((p) => (
                <ProposalRow key={p.id} hit={p} onSelect={() => go(p.href)} />
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-category row renderers
// ─────────────────────────────────────────────────────────────────────────────

function ClientRow({ hit, onSelect }: { hit: ClientHit; onSelect: () => void }) {
  const Icon = hit.kind === "organization" ? Building2 : User
  const location = [hit.city, hit.state].filter(Boolean).join(", ") || null
  return (
    <CommandItem
      // cmdk's built-in filter does a substring match on `value` against the
      // input. We've already filtered server-side, but the dialog still hides
      // items whose `value` doesn't contain the typed text — so include every
      // searchable string here so server-matched items always render.
      value={`client ${hit.kind} ${hit.id} ${hit.name} ${hit.subtitle || ""} ${
        hit.city || ""
      } ${hit.state || ""}`}
      onSelect={onSelect}
      className="flex w-full items-start gap-3 px-2 py-2"
    >
      <div className="mt-0.5 rounded-md bg-blue-100 p-1.5">
        <Icon className="h-4 w-4 text-blue-700" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{hit.name}</span>
          {hit.isProspect ? (
            <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
              Prospect
            </Badge>
          ) : null}
          <Badge variant="outline" className="h-5 shrink-0 text-[10px] capitalize">
            {hit.kind}
          </Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {hit.subtitle ? <span className="truncate">{hit.subtitle}</span> : null}
          {location ? (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3 opacity-0" /> {location}
            </span>
          ) : null}
        </div>
      </div>
    </CommandItem>
  )
}

function WorkItemRow({ hit, onSelect }: { hit: WorkItemHit; onSelect: () => void }) {
  const due = formatDate(hit.dueDate)
  const completed = formatDate(hit.completedDate)
  const status = hit.status || ""
  return (
    <CommandItem
      value={`workitem ${hit.id} ${hit.karbonKey || ""} ${hit.title} ${hit.workType || ""} ${
        hit.clientName || ""
      } ${hit.assigneeName || ""}`}
      onSelect={onSelect}
      className="flex w-full items-start gap-3 px-2 py-2"
    >
      <div className="mt-0.5 rounded-md bg-stone-100 p-1.5">
        <FileText className="h-4 w-4 text-stone-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{hit.title}</span>
          {status ? (
            <Badge
              variant="outline"
              className={cn("h-5 shrink-0 text-[10px]", statusTone(status))}
            >
              {status}
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {hit.workType ? (
            <span className="inline-flex items-center gap-1">
              <Briefcase className="h-3 w-3" /> {hit.workType}
            </span>
          ) : null}
          {hit.clientName ? (
            <span className="inline-flex items-center gap-1 truncate">
              <User className="h-3 w-3" /> {hit.clientName}
            </span>
          ) : null}
          {hit.assigneeName ? (
            <span className="inline-flex items-center gap-1 truncate">
              <User className="h-3 w-3" /> {hit.assigneeName}
            </span>
          ) : null}
          {(due || completed) && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {completed ? `Completed ${completed}` : `Due ${due}`}
            </span>
          )}
        </div>
      </div>
    </CommandItem>
  )
}

function DebriefRow({ hit, onSelect }: { hit: DebriefHit; onSelect: () => void }) {
  const date = formatDate(hit.date)
  return (
    <CommandItem
      value={`debrief ${hit.id} ${hit.workItemTitle || ""} ${hit.clientName || ""} ${
        hit.debriefType || ""
      } ${hit.teamMemberName || ""} ${hit.snippet || ""}`}
      onSelect={onSelect}
      className="flex w-full items-start gap-3 px-2 py-2"
    >
      <div className="mt-0.5 rounded-md bg-purple-100 p-1.5">
        <MessageSquare className="h-4 w-4 text-purple-700" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {hit.workItemTitle || hit.clientName || "(debrief)"}
          </span>
          {hit.debriefType ? (
            <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
              {hit.debriefType}
            </Badge>
          ) : null}
          {hit.status ? (
            <Badge
              variant="outline"
              className={cn("h-5 shrink-0 text-[10px]", statusTone(hit.status))}
            >
              {hit.status}
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {hit.clientName ? (
            <span className="inline-flex items-center gap-1 truncate">
              <User className="h-3 w-3" /> {hit.clientName}
            </span>
          ) : null}
          {date ? (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" /> {date}
            </span>
          ) : null}
          {hit.teamMemberName ? (
            <span className="inline-flex items-center gap-1 truncate">{hit.teamMemberName}</span>
          ) : null}
        </div>
        {hit.snippet ? (
          <p className="mt-1 truncate text-xs text-muted-foreground/90">{hit.snippet}</p>
        ) : null}
      </div>
    </CommandItem>
  )
}

function InvoiceRow({ hit, onSelect }: { hit: InvoiceHit; onSelect: () => void }) {
  const date = formatDate(hit.invoiceDate) || formatDate(hit.dueDate)
  const total = formatCurrency(hit.amount, hit.currency)
  const outstanding = formatCurrency(hit.amountOutstanding, hit.currency)
  return (
    <CommandItem
      value={`invoice ${hit.id} ${hit.invoiceNumber || ""} ${hit.stripeInvoiceId || ""} ${
        hit.clientName || ""
      } ${hit.status || ""}`}
      onSelect={onSelect}
      className="flex w-full items-start gap-3 px-2 py-2"
    >
      <div className="mt-0.5 rounded-md bg-emerald-100 p-1.5">
        <Receipt className="h-4 w-4 text-emerald-700" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {hit.invoiceNumber || "(no invoice number)"}
          </span>
          {hit.status ? (
            <Badge
              variant="outline"
              className={cn("h-5 shrink-0 text-[10px]", statusTone(hit.status))}
            >
              {hit.status}
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {hit.clientName ? (
            <span className="inline-flex items-center gap-1 truncate">
              <User className="h-3 w-3" /> {hit.clientName}
            </span>
          ) : null}
          {total ? <span className="tabular-nums">{total}</span> : null}
          {outstanding && hit.amountOutstanding && hit.amountOutstanding > 0 ? (
            <span className="tabular-nums text-orange-600">{outstanding} outstanding</span>
          ) : null}
          {date ? (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" /> {date}
            </span>
          ) : null}
        </div>
      </div>
    </CommandItem>
  )
}

function ProposalRow({ hit, onSelect }: { hit: ProposalHit; onSelect: () => void }) {
  const date = formatDate(hit.acceptedAt || hit.sentAt || hit.createdAt)
  const total = formatCurrency(hit.totalValue, hit.currency)
  return (
    <CommandItem
      value={`proposal ${hit.id} ${hit.proposalNumber || ""} ${hit.title || ""} ${
        hit.clientName || ""
      } ${hit.status || ""}`}
      onSelect={onSelect}
      className="flex w-full items-start gap-3 px-2 py-2"
    >
      <div className="mt-0.5 rounded-md bg-amber-100 p-1.5">
        <ClipboardList className="h-4 w-4 text-amber-700" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {hit.title || hit.proposalNumber || "(proposal)"}
          </span>
          {hit.status ? (
            <Badge
              variant="outline"
              className={cn("h-5 shrink-0 text-[10px]", statusTone(hit.status))}
            >
              {hit.status}
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {hit.clientName ? (
            <span className="inline-flex items-center gap-1 truncate">
              <User className="h-3 w-3" /> {hit.clientName}
            </span>
          ) : null}
          {hit.proposalNumber ? <span>#{hit.proposalNumber}</span> : null}
          {total ? <span className="tabular-nums">{total}</span> : null}
          {date ? (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" /> {date}
            </span>
          ) : null}
        </div>
      </div>
    </CommandItem>
  )
}
