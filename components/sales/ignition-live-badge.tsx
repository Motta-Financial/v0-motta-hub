"use client"

/**
 * IgnitionLiveBadge
 * ────────────────────────────────────────────────────────────────────────
 * Compact "Live from Ignition · last synced 5m ago" pill rendered next to
 * the page title on every sales surface that reads from the Reporting API
 * (Proposals, Invoices, Payments). It:
 *
 *  - Polls /api/ignition/sync every 60 seconds so the relative time stays
 *    fresh without a page reload.
 *  - Renders three visual states: HEALTHY (green dot + last-synced time),
 *    SYNCING (amber pulsing dot + "Sync in progress"), ERROR (rose dot +
 *    error tooltip).
 *  - Falls back to a neutral "Live from Ignition" label when the connection
 *    hasn't synced yet or the fetch itself fails — never breaks the page.
 *
 * The component is intentionally read-only. Manual sync controls live on
 * /admin/ignition; this badge is just a confidence indicator for the data
 * the user is staring at.
 */

import useSWR from "swr"
import { cn } from "@/lib/utils"

interface SyncStatus {
  connection: {
    lastSyncedAt: string | null
    lastSyncStartedAt: string | null
    lastSyncError: string | null
    isRunning: boolean
  } | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

/**
 * Format an ISO timestamp as a short relative phrase like "5m ago" /
 * "2h ago" / "3d ago". We hand-roll this so we don't pull in dayjs just
 * for one pill — the page already uses Intl.* helpers for other dates.
 */
function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ""
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export function IgnitionLiveBadge({ className }: { className?: string }) {
  // Refresh every 60s. Don't revalidate on focus — the badge isn't
  // important enough to spam the API every time the user tabs back.
  const { data } = useSWR<SyncStatus>("/api/ignition/sync", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  })

  const connection = data?.connection ?? null
  const isRunning = !!connection?.isRunning
  const hasError = !!connection?.lastSyncError
  const lastSyncedAt = connection?.lastSyncedAt ?? null

  // Determine the visual tone. SYNCING wins over ERROR (the running sync
  // is what the user cares about); ERROR wins over HEALTHY only when no
  // sync is currently in flight.
  type Tone = "healthy" | "syncing" | "error" | "neutral"
  const tone: Tone = isRunning
    ? "syncing"
    : hasError
      ? "error"
      : lastSyncedAt
        ? "healthy"
        : "neutral"

  const toneStyles: Record<Tone, { wrap: string; dot: string; pulse: boolean }> = {
    healthy: {
      wrap: "bg-emerald-50 text-emerald-900 border-emerald-200",
      dot: "bg-emerald-500",
      pulse: false,
    },
    syncing: {
      wrap: "bg-amber-50 text-amber-900 border-amber-200",
      dot: "bg-amber-500",
      pulse: true,
    },
    error: {
      wrap: "bg-rose-50 text-rose-900 border-rose-200",
      dot: "bg-rose-500",
      pulse: false,
    },
    neutral: {
      wrap: "bg-stone-100 text-stone-700 border-stone-200",
      dot: "bg-stone-400",
      pulse: false,
    },
  }

  const styles = toneStyles[tone]

  const label =
    tone === "syncing"
      ? "Sync in progress…"
      : tone === "error"
        ? "Last sync failed"
        : tone === "healthy"
          ? `Live · synced ${relativeFromNow(lastSyncedAt)}`
          : "Live from Ignition"

  // The full ISO timestamp ends up in `title` so power users can hover to
  // confirm exactly when the last successful sync ran — useful when the
  // relative time is ambiguous (e.g. "1d ago" could be 24-48h).
  const tooltip =
    tone === "error"
      ? `Last sync error: ${connection?.lastSyncError}`
      : lastSyncedAt
        ? `Last successful sync: ${new Date(lastSyncedAt).toLocaleString()}`
        : "Ignition Reporting API"

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        styles.wrap,
        className,
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        {styles.pulse ? (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
              styles.dot,
            )}
          />
        ) : null}
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", styles.dot)} />
      </span>
      {label}
    </span>
  )
}
