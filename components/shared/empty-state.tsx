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
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
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
        "flex flex-col gap-3 rounded-xl border border-amber-300/70 bg-amber-100 px-4 py-3.5 dark:border-amber-700/40 dark:bg-amber-500/10 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {heading}
          </p>
          <p className="text-xs leading-relaxed text-amber-800/90 dark:text-amber-300/80">
            {description}
          </p>
        </div>
      </div>
      {action ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 border-amber-400/70 bg-white text-amber-900 hover:bg-amber-50 dark:border-amber-700/50 dark:bg-transparent dark:text-amber-200"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
