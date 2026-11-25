"use client"

/**
 * What the Hub set on a Karbon work item right after creating it.
 *
 * Creating the work item and setting it up are two calls to Karbon
 * (`lib/karbon/finalize-work-item.ts`). The first can succeed while the
 * second is refused — a status that isn't enabled for the work type, a
 * conflict that outlasted the retries. Without this, the teammate would
 * see a green "created" and never learn that the status or dates still
 * need setting by hand.
 */

import { AlertTriangle, CheckCircle2 } from "lucide-react"
import type { FinalizeWorkItemResult } from "@/lib/karbon/finalize-work-item"
import { formatIsoDateForDisplay } from "@/lib/karbon/tax-work-item-defaults"

/** Compact description of the fields Karbon accepted, e.g. for a list of several items. */
export function describeKarbonSetup(finalize: FinalizeWorkItemResult | null | undefined): string | null {
  const applied = finalize?.applied
  if (!applied) return null
  const parts: string[] = []
  if (applied.StartDate) parts.push(`starts ${formatIsoDateForDisplay(applied.StartDate)}`)
  if (applied.DueDate && applied.DeadlineDate && applied.DueDate === applied.DeadlineDate) {
    parts.push(`due and deadline ${formatIsoDateForDisplay(applied.DueDate)}`)
  } else {
    if (applied.DueDate) parts.push(`due ${formatIsoDateForDisplay(applied.DueDate)}`)
    if (applied.DeadlineDate) parts.push(`deadline ${formatIsoDateForDisplay(applied.DeadlineDate)}`)
  }
  if (applied.SecondaryStatus) parts.push(`status “${applied.SecondaryStatus}”`)
  return parts.length ? parts.join(" · ") : null
}

export function KarbonSetupNotice({
  finalize,
}: {
  finalize: FinalizeWorkItemResult | null | undefined
}) {
  if (!finalize || !finalize.attempted) return null
  const summary = describeKarbonSetup(finalize)

  if (finalize.ok) {
    if (!summary) return null
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span>Set in Karbon: {summary}.</span>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        The work item was created, but Karbon didn&apos;t accept all of its set-up
        {summary ? ` (it did take: ${summary})` : ""}. Please check the status and dates in
        Karbon.
        {finalize.error ? <span className="mt-1 block break-words opacity-80">{finalize.error}</span> : null}
      </span>
    </div>
  )
}
