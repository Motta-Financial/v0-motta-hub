"use client"

/**
 * Intake page wrapper — a single surface that exposes both the
 * operational queue and the analytics dashboard via tabs, instead of
 * the previous two-route split (/sales/intake and
 * /sales/intake/dashboard). The current tab is persisted to the URL
 * (`?view=queue|dashboard`) so deep-links from Daily Briefing, the
 * legacy /sales/intake/dashboard redirect, and browser back/forward
 * all behave the same as before.
 *
 * The Jotform integration health card used to render at the top of
 * the queue here. It now lives on /admin/webhooks (the dedicated
 * webhook integrations console) so this page can stay focused on the
 * sales workflow rather than admin plumbing.
 */

import { Suspense } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { IntakeList } from "./intake-list"
import { IntakeDashboard } from "./intake-dashboard"

type View = "queue" | "dashboard"

function isView(v: string | null): v is View {
  return v === "queue" || v === "dashboard"
}

function IntakeTabsInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const raw = searchParams.get("view")
  const view: View = isView(raw) ? raw : "queue"

  function setView(next: View) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "queue") {
      params.delete("view")
    } else {
      params.set("view", next)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div className="space-y-4">
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "queue" ? <IntakeList /> : <IntakeDashboard />}
    </div>
  )
}

export function IntakeTabs() {
  // IntakeList + IntakeTabsInner both read useSearchParams, which
  // requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <IntakeTabsInner />
    </Suspense>
  )
}
