"use client"

import { useMemo } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  ExternalLink,
  Video,
  CalendarClock,
  ArrowUpRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ZoomConnection {
  id: string
  team_member_id: string
  zoom_email: string | null
  is_active: boolean
  last_synced_at: string | null
}

interface CalendlyConnection {
  id: string
  team_member_id: string
  calendly_user_email: string | null
  is_active: boolean
  sync_enabled: boolean
  last_synced_at: string | null
  health?: {
    tokenExpired?: boolean
    syncStale?: boolean
    needsReauthForScopes?: boolean
  }
}

interface SetupItem {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  status: "connected" | "not_connected" | "needs_attention"
  statusLabel: string
  detail: string | null
  primaryAction: { label: string; href: string }
  secondaryAction?: { label: string; href: string }
}

interface MottaSetupTabProps {
  teamMemberId: string | null | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MottaSetupTab({ teamMemberId }: MottaSetupTabProps) {
  // We fetch the full connection lists (admin-scoped in those routes) and
  // filter client-side to the current team member. This matches how the
  // Zoom and Calendly dashboards already do it and keeps a single source of
  // truth for connection state.
  const { data: zoomData, isLoading: zoomLoading } = useSWR<{
    connections: ZoomConnection[]
  }>("/api/zoom/connections", fetcher, { revalidateOnFocus: false })

  const { data: calendlyData, isLoading: calendlyLoading } = useSWR<{
    connections: CalendlyConnection[]
  }>("/api/calendly/connections", fetcher, { revalidateOnFocus: false })

  const items: SetupItem[] = useMemo(() => {
    const zoomConn = (zoomData?.connections || []).find(
      (c) => c.team_member_id === teamMemberId,
    )
    const calendlyConn = (calendlyData?.connections || []).find(
      (c) => c.team_member_id === teamMemberId,
    )

    // Zoom
    let zoomStatus: SetupItem["status"] = "not_connected"
    let zoomStatusLabel = "Not connected"
    let zoomDetail: string | null = null
    if (zoomConn) {
      if (!zoomConn.is_active) {
        zoomStatus = "needs_attention"
        zoomStatusLabel = "Reconnect needed"
        zoomDetail = "Connection is inactive — reauthorize to resume sync."
      } else {
        zoomStatus = "connected"
        zoomStatusLabel = "Connected"
        zoomDetail = zoomConn.zoom_email
          ? `Linked to ${zoomConn.zoom_email}`
          : "Active connection"
      }
    }

    // Calendly
    let calendlyStatus: SetupItem["status"] = "not_connected"
    let calendlyStatusLabel = "Not connected"
    let calendlyDetail: string | null = null
    if (calendlyConn) {
      const health = calendlyConn.health
      if (
        !calendlyConn.is_active ||
        health?.tokenExpired ||
        health?.needsReauthForScopes
      ) {
        calendlyStatus = "needs_attention"
        calendlyStatusLabel = health?.tokenExpired
          ? "Token expired"
          : health?.needsReauthForScopes
            ? "Reauthorize for new scopes"
            : "Reconnect needed"
        calendlyDetail = "Reauthorize Calendly to keep meetings in sync."
      } else {
        calendlyStatus = "connected"
        calendlyStatusLabel = "Connected"
        calendlyDetail = calendlyConn.calendly_user_email
          ? `Linked to ${calendlyConn.calendly_user_email}`
          : "Active connection"
      }
    }

    return [
      {
        id: "zoom",
        title: "Connect Zoom",
        description:
          "Sync your scheduled meetings, recordings, and call history into Motta Hub.",
        icon: Video,
        status: zoomStatus,
        statusLabel: zoomStatusLabel,
        detail: zoomDetail,
        primaryAction: {
          label: zoomStatus === "connected" ? "Manage" : "Connect Zoom",
          href: "/meetings/zoom",
        },
      },
      {
        id: "calendly",
        title: "Connect Calendly",
        description:
          "Pull every booked meeting onto the team calendar with the right client linkage.",
        icon: CalendarClock,
        status: calendlyStatus,
        statusLabel: calendlyStatusLabel,
        detail: calendlyDetail,
        primaryAction: {
          label:
            calendlyStatus === "connected" ? "Manage" : "Connect Calendly",
          href: "/calendly",
        },
      },
    ]
  }, [zoomData, calendlyData, teamMemberId])

  const completed = items.filter((i) => i.status === "connected").length
  const total = items.length
  const allDone = completed === total

  const isLoading = zoomLoading || calendlyLoading

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Progress summary */}
      <Card
        className={cn(
          "p-4",
          allDone ? "bg-emerald-50/50 border-emerald-200" : "bg-muted/30",
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {allDone ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">
                {allDone
                  ? "All set"
                  : `${completed} of ${total} integrations connected`}
              </p>
              <p className="text-xs text-muted-foreground">
                {allDone
                  ? "Your Motta Hub workspace is fully wired up."
                  : "Finish connecting your accounts to unlock the full Hub experience."}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              allDone
                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                : "bg-amber-100 text-amber-800 border-amber-200",
            )}
          >
            {completed}/{total}
          </Badge>
        </div>
      </Card>

      {/* Setup items */}
      <div className="space-y-2">
        {items.map((item) => (
          <SetupItemCard key={item.id} item={item} />
        ))}
      </div>

      {/* Footer reference link */}
      <Card className="p-4 border-dashed">
        <div className="flex items-start gap-3">
          <ExternalLink className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">More integrations coming soon</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Karbon, Jotform, and email are wired up at the firm level. If you
              hit a missing connection while working, ping{" "}
              <a
                href="mailto:support@mottafinancial.com"
                className="underline underline-offset-2 hover:text-foreground"
              >
                support@mottafinancial.com
              </a>
              .
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup item card
// ─────────────────────────────────────────────────────────────────────────────

function SetupItemCard({ item }: { item: SetupItem }) {
  const Icon = item.icon

  const statusBadgeClass =
    item.status === "connected"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : item.status === "needs_attention"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : "bg-stone-100 text-stone-700 border-stone-200"

  const StatusIcon =
    item.status === "connected"
      ? CheckCircle2
      : item.status === "needs_attention"
        ? AlertTriangle
        : Circle

  return (
    <Card
      className={cn(
        "p-4 transition-colors hover:bg-muted/30",
        item.status === "needs_attention" && "border-l-4 border-l-amber-500",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{item.title}</p>
              <Badge
                variant="outline"
                className={cn("gap-1 text-xs", statusBadgeClass)}
              >
                <StatusIcon className="h-3 w-3" />
                {item.statusLabel}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.description}
            </p>
            {item.detail && (
              <p className="mt-1 text-xs text-muted-foreground">
                {item.detail}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" variant={item.status === "connected" ? "outline" : "default"}>
            <Link href={item.primaryAction.href} className="gap-1.5">
              {item.primaryAction.label}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  )
}
