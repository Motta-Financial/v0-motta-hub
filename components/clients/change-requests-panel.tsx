"use client"

import { useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Phone,
  Mail,
  MapPin,
  Check,
  X,
  Inbox,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react"
import {
  INITIAL_CHANGE_REQUESTS,
  fieldIconKey,
  type ChangeRequest,
  type ChangeRequestStatus,
} from "@/lib/mock/change-requests"
import { cn } from "@/lib/utils"

const FIELD_ICON = {
  phone: Phone,
  address: MapPin,
  email: Mail,
} as const

const TABS: { key: ChangeRequestStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "dismissed", label: "Dismissed" },
]

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

function groupByClient(requests: ChangeRequest[]) {
  const order: string[] = []
  const groups = new Map<string, ChangeRequest[]>()
  for (const r of requests) {
    if (!groups.has(r.clientName)) {
      groups.set(r.clientName, [])
      order.push(r.clientName)
    }
    groups.get(r.clientName)!.push(r)
  }
  return order.map((name) => ({ clientName: name, items: groups.get(name)! }))
}

function EmptyState({ status }: { status: ChangeRequestStatus }) {
  const copy: Record<ChangeRequestStatus, { icon: typeof Inbox; title: string; body: string }> = {
    pending: {
      icon: Inbox,
      title: "No pending change requests",
      body: "When a client updates their info from the portal, it'll show up here for review.",
    },
    approved: {
      icon: CheckCircle2,
      title: "No approved requests yet",
      body: "Requests you approve will be listed here.",
    },
    dismissed: {
      icon: XCircle,
      title: "No dismissed requests",
      body: "Requests you dismiss will be listed here.",
    },
  }
  const { icon: Icon, title, body } = copy[status]
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-lg border p-4">
      <Skeleton className="h-4 w-4 rounded-sm" />
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-8 w-20" />
    </div>
  )
}

export function ChangeRequestsPanel() {
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [tab, setTab] = useState<ChangeRequestStatus>("pending")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Simulate an initial fetch so the loading skeleton has something to show.
  useMemo(() => {
    const timer = setTimeout(() => {
      setRequests(INITIAL_CHANGE_REQUESTS)
      setLoading(false)
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pendingCount = requests.filter((r) => r.status === "pending").length

  const visible = useMemo(
    () => requests.filter((r) => r.status === tab),
    [requests, tab],
  )
  const grouped = useMemo(() => groupByClient(visible), [visible])

  function resolve(ids: string[], status: "approved" | "dismissed") {
    const targets = requests.filter((r) => ids.includes(r.id))
    setRequests((prev) =>
      prev.map((r) => (ids.includes(r.id) ? { ...r, status } : r)),
    )
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })

    if (status === "approved") {
      const fields = Array.from(new Set(targets.map((t) => t.field)))
      if (fields.length === 1) {
        toast.success(`${fields[0]} updated`)
      } else {
        toast.success(`${targets.length} changes updated`)
      }
    } else {
      toast(targets.length === 1 ? "Request dismissed" : `${targets.length} requests dismissed`)
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedInView = visible.filter((r) => selected.has(r.id))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ChangeRequestStatus)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2">
                {t.label}
                {t.key === "pending" && pendingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="h-5 min-w-5 rounded-full px-1.5 text-xs tabular-nums"
                  >
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {tab === "pending" && selectedInView.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5">
            <span className="text-sm text-muted-foreground">
              {selectedInView.length} selected
            </span>
            <Button
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => resolve(selectedInView.map((r) => r.id), "approved")}
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={() => resolve(selectedInView.map((r) => r.id), "dismissed")}
            >
              <X className="h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState status={tab} />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((group) => (
            <div key={group.clientName} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] font-medium">
                    {group.items[0].clientInitials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{group.clientName}</span>
                <span className="text-xs text-muted-foreground">
                  {group.items.length} {group.items.length === 1 ? "change" : "changes"}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {group.items.map((req) => {
                    const Icon = FIELD_ICON[fieldIconKey(req.field)]
                    const isChecked = selected.has(req.id)
                    return (
                      <motion.div
                        key={req.id}
                        layout
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-start gap-4 rounded-lg border bg-card p-4">
                          {tab === "pending" && (
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleSelected(req.id)}
                              className="mt-1"
                              aria-label={`Select ${req.field} change for ${req.clientName}`}
                            />
                          )}

                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-sm font-semibold">{req.field}</span>
                              <span className="text-xs text-muted-foreground">
                                requested by {req.requestedBy} &middot; {relativeTime(req.requestedAtIso)}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                              <span className="text-sm text-muted-foreground line-through decoration-muted-foreground/50">
                                {req.currentValue}
                              </span>
                              <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" />
                              <span className="text-sm font-semibold text-foreground break-words">
                                {req.requestedValue}
                              </span>
                            </div>
                          </div>

                          {tab === "pending" ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Button
                                size="sm"
                                className="h-8 gap-1.5"
                                onClick={() => resolve([req.id], "approved")}
                              >
                                <Check className="h-3.5 w-3.5" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5"
                                onClick={() => resolve([req.id], "dismissed")}
                              >
                                <X className="h-3.5 w-3.5" />
                                Dismiss
                              </Button>
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className={cn(
                                "shrink-0 gap-1",
                                req.status === "approved"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-500/15 dark:text-emerald-300"
                                  : "border-border bg-muted text-muted-foreground",
                              )}
                            >
                              {req.status === "approved" ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : (
                                <XCircle className="h-3 w-3" />
                              )}
                              {req.status === "approved" ? "Approved" : "Dismissed"}
                            </Badge>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
