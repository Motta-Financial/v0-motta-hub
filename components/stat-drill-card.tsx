"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronDown, ChevronUp, ExternalLink, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

interface DrillItem {
  id: string
  title: string
  subtitle?: string | null
  meta?: string | null
  href?: string | null
}

interface StatDrillCardProps {
  title: string
  icon: React.ReactNode
  value: number | string
  hint?: string
  hintClassName?: string
  /** Endpoint hit when the user expands the card. Should return `{ items: DrillItem[] }`. */
  detailsEndpoint?: string
  /** Optional fallback "view all" link shown beneath the drill-in list. */
  viewAllHref?: string
  className?: string
}

/**
 * Compact KPI card with a built-in drill-in panel. Tapping the chevron
 * reveals a lazy-loaded list of the underlying records (top 10) so the user
 * can move from "I have 47 open tasks" to "here are the 10 most urgent ones"
 * without leaving the dashboard. Lists are fetched on first expand and
 * cached for the lifetime of the component.
 */
export function StatDrillCard({
  title,
  icon,
  value,
  hint,
  hintClassName,
  detailsEndpoint,
  viewAllHref,
  className,
}: StatDrillCardProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [items, setItems] = React.useState<DrillItem[] | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isOpen || items !== null || !detailsEndpoint) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    fetch(detailsEndpoint)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load details"))))
      .then((data) => {
        if (cancelled) return
        setItems(Array.isArray(data?.items) ? data.items : [])
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message || "Failed to load")
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, items, detailsEndpoint])

  const canDrillIn = !!detailsEndpoint

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className={cn("bg-white shadow-sm border-gray-200 w-full", className)}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-start justify-between gap-2 rounded-t-lg px-6 pt-4 pb-2 text-left",
              canDrillIn && "cursor-pointer hover:bg-gray-50",
            )}
            disabled={!canDrillIn}
          >
            <div className="min-w-0 flex-1">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-gray-700">
                {icon}
                <span className="truncate">{title}</span>
              </CardTitle>
            </div>
            {canDrillIn && (
              <span className="mt-0.5 text-gray-400 transition-transform">
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            )}
          </button>
        </CollapsibleTrigger>

        <CardHeader className="px-6 pt-0 pb-0 sr-only">
          <CardTitle>{title}</CardTitle>
        </CardHeader>

        <CardContent className="px-6 pb-4 pt-0">
          <div className="text-2xl font-bold text-gray-900">{value}</div>
          {hint && <p className={cn("text-xs text-gray-500 mt-1", hintClassName)}>{hint}</p>}
        </CardContent>

        <CollapsibleContent>
          <div className="border-t border-gray-100 px-6 py-3">
            {isLoading && (
              <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading recent records...
              </div>
            )}
            {error && !isLoading && (
              <p className="py-3 text-sm text-red-600">{error}</p>
            )}
            {!isLoading && !error && items !== null && items.length === 0 && (
              <p className="py-3 text-sm text-gray-500">Nothing to show right now.</p>
            )}
            {!isLoading && !error && items !== null && items.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {items.map((item) => {
                  const inner = (
                    <div className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                        {item.subtitle && (
                          <p className="truncate text-xs text-gray-500">{item.subtitle}</p>
                        )}
                      </div>
                      {item.meta && (
                        <span className="shrink-0 text-xs text-gray-400">{item.meta}</span>
                      )}
                    </div>
                  )
                  return item.href ? (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="block rounded-md hover:bg-gray-50 -mx-2 px-2"
                      >
                        {inner}
                      </Link>
                    </li>
                  ) : (
                    <li key={item.id}>{inner}</li>
                  )
                })}
              </ul>
            )}
            {viewAllHref && !isLoading && !error && (
              <Button asChild variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs">
                <Link href={viewAllHref}>
                  View all
                  <ExternalLink className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
