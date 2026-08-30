"use client"

/**
 * Shared empty-state and warning-banner primitives.
 *
 * Used anywhere a list can legitimately be empty (no emails synced yet,
 * no documents uploaded yet, etc). The two are intentionally styled very
 * differently so a real failure never reads as good news:
 *
 *   - EmptyState: a quiet, muted card — "nothing here yet, and that's fine."
 *   - WarningBanner: an amber-toned banner with an alert icon — "something
 *     went wrong loading this, here's how to recover."
 *
 * Both use semantic Tailwind/shadcn tokens (bg-muted, text-foreground, …)
 * so they adapt automatically between the Hub's dark theme and the client
 * portal's light theme without any hardcoded colors.
 */

import type { LucideIcon } from "lucide-react"
import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const WARNING_BG = "#FEF3C7"
const WARNING_BORDER = "#F3D98A"
const WARNING_ICON = "#92720B"
const WARNING_HEADING = "#5C4A0A"
const WARNING_TEXT = "#7A6212"

const MID_GREEN = "#8E9B79"
const PALE_GREEN = "#B5BFA8"

interface EmptyStateAction {
  label: string
  href?: string
  onClick?: () => void
}

interface EmptyStateProps {
  icon: LucideIcon
  heading: string
  description: string
  action?: EmptyStateAction
  className?: string
}

export function EmptyState({
  icon: Icon,
  heading,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn("rounded-xl border-0 shadow-sm", className)}>
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: `${PALE_GREEN}33` }}
        >
          <Icon className="h-5 w-5" style={{ color: MID_GREEN }} aria-hidden="true" />
        </div>
        <div className="max-w-sm space-y-1">
          <p className="text-sm font-medium text-foreground">{heading}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {action ? (
          action.href ? (
            <Button asChild size="sm" variant="outline" className="mt-1 gap-1.5">
              <a href={action.href}>{action.label}</a>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1 gap-1.5"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  )
}

interface WarningBannerProps {
  heading: string
  description: string
  action?: EmptyStateAction
  className?: string
}

/**
 * Warning-toned banner for "we couldn't load this" — never render this as
 * a grey empty state, since an outage must never read as good news.
 */
export function WarningBanner({
  heading,
  description,
  action,
  className,
}: WarningBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      style={{ backgroundColor: WARNING_BG, borderColor: WARNING_BORDER }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: WARNING_ICON }}
          aria-hidden="true"
        />
        <div className="space-y-0.5">
          <p className="text-sm font-medium" style={{ color: WARNING_HEADING }}>
            {heading}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: WARNING_TEXT }}>
            {description}
          </p>
        </div>
      </div>
      {action ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 bg-white hover:bg-white/70"
          style={{ borderColor: WARNING_BORDER, color: WARNING_HEADING }}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
