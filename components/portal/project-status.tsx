/**
 * Client-facing status chip + supporting copy lines, built on top of
 * lib/portal/client-status.ts. Renders one of three plain-English
 * states — never a raw internal status code — and is shared by the
 * project cards, the project detail header, and the dashboard's
 * active work list so the same work item reads identically everywhere.
 */

import { AlertCircle, CheckCircle2, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ClientStatus } from "@/lib/portal/client-status"

const DEEP_GREEN = "#6B745D"
const DARK_GREEN = "#4A5240"
const MID_GREEN = "#8E9B79"
const PALE_GREEN = "#B5BFA8"
const WARNING_BG = "#FEF3C7"
const WARNING_BORDER = "#F3D98A"
const WARNING_TEXT = "#92400E"

// ── Status chip ───────────────────────────────────────────────────────────────
// The "needs you" state is deliberately the loudest: a warm amber pill
// with a border and a small alert icon. The other two stay calm, quiet
// sage green with no border.

export function ProjectStatusChip({
  status,
  className,
}: {
  status: ClientStatus
  className?: string
}) {
  if (status.tone === "needs-you") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
          className,
        )}
        style={{ backgroundColor: WARNING_BG, borderColor: WARNING_BORDER, color: WARNING_TEXT }}
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: DEEP_GREEN }} />
        {status.label}
      </span>
    )
  }

  if (status.tone === "done") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
          className,
        )}
        style={{ backgroundColor: `${PALE_GREEN}40`, color: DARK_GREEN }}
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        {status.label}
      </span>
    )
  }

  // "working"
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        className,
      )}
      style={{ backgroundColor: `${MID_GREEN}22`, color: DARK_GREEN }}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" />
      {status.label}
    </span>
  )
}

// ── "Waiting on: ..." subline ─────────────────────────────────────────────────
// Only renders for the "needs you" tone, and only when specific items are
// known. Placed directly under the chip on cards, list rows, and the detail
// header.

export function WaitingOnLine({
  status,
  className,
}: {
  status: ClientStatus
  className?: string
}) {
  if (status.tone !== "needs-you" || !status.waitingOn || status.waitingOn.length === 0) {
    return null
  }
  return (
    <p className={cn("text-xs leading-relaxed text-gray-500", className)}>
      <span className="font-medium" style={{ color: WARNING_TEXT }}>
        Waiting on:
      </span>{" "}
      {status.waitingOn.join(", ")}
    </p>
  )
}

// ── One-line explanation ──────────────────────────────────────────────────────
// Used on the project detail page, directly under the status chip.

export function StatusExplanation({
  status,
  className,
}: {
  status: ClientStatus
  className?: string
}) {
  return (
    <p className={cn("text-sm leading-relaxed text-gray-500", className)}>
      {status.explanation}
    </p>
  )
}
