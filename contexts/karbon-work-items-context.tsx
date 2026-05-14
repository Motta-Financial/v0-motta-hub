"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import useSWR from "swr"

// Work item type -- matches the Supabase work_items table,
// but also exposes legacy Karbon-style field aliases so existing
// components keep working without a rewrite.
export interface KarbonWorkItem {
  // Primary Supabase fields
  id?: string
  karbon_work_item_key?: string
  title?: string
  client_name?: string | null
  work_type?: string | null
  workflow_status?: string | null
  status?: string | null
  primary_status?: string | null
  due_date?: string | null
  start_date?: string | null
  completed_date?: string | null
  karbon_modified_at?: string | null
  // Period_start / period_end are populated for recurring engagements
  // (bookkeeping, payroll, etc.) — e.g. period_start = 2026-01-01 for a
  // "Bookkeeping — Jan 2026" item. Carried through here so dashboards can
  // group/filter by service period without a separate fetch.
  period_start?: string | null
  period_end?: string | null
  assignee_name?: string | null
  karbon_client_key?: string | null
  description?: string | null
  priority?: string | null
  karbon_url?: string | null
  client_group_name?: string | null
  secondary_status?: string | null
  // Legacy aliases (mapped from Supabase fields)
  WorkKey: string
  Title: string
  ClientName?: string
  WorkType?: string
  WorkStatus?: string
  DueDate?: string
  StartDate?: string
  CompletedDate?: string
  LastModifiedDateTime?: string
  AssigneeName?: string
  AssignedTo?: { FullName: string; Email?: string; UserKey?: string }[]
  ClientKey?: string
  Description?: string
  Priority?: string
  PrimaryStatus?: string
  SecondaryStatus?: string
  ClientGroupName?: string
  Key?: string
}

interface KarbonWorkItemsContextValue {
  /** Every work item from Supabase (includes completed). Use for search. */
  allWorkItems: KarbonWorkItem[]
  /** Work items excluding completed/cancelled. Use for dashboard views. */
  activeWorkItems: KarbonWorkItem[]
  taxWorkItems: KarbonWorkItem[]
  isLoading: boolean
  error: string | null
  refresh: () => void
}

const KarbonWorkItemsContext = createContext<KarbonWorkItemsContextValue | null>(null)

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    let errorMessage = res.statusText
    try {
      const errorData = await res.json()
      errorMessage = errorData.error || errorMessage
    } catch {
      // Response wasn't JSON
    }
    throw new Error(errorMessage)
  }
  return res.json()
}

// Map a Supabase work_items row into the KarbonWorkItem shape
// so downstream components can use either naming convention.
function mapSupabaseToKarbon(item: any): KarbonWorkItem {
  return {
    // Supabase fields
    id: item.id,
    karbon_work_item_key: item.karbon_work_item_key,
    title: item.title,
    client_name: item.client_name,
    work_type: item.work_type,
    workflow_status: item.workflow_status,
    status: item.status,
    primary_status: item.primary_status,
    due_date: item.due_date,
    start_date: item.start_date,
    completed_date: item.completed_date,
    karbon_modified_at: item.karbon_modified_at,
    period_start: item.period_start,
    period_end: item.period_end,
    assignee_name: item.assignee_name,
    karbon_client_key: item.karbon_client_key,
    description: item.description,
    priority: item.priority,
    karbon_url: item.karbon_url,
    client_group_name: item.client_group_name,
    secondary_status: item.secondary_status,
    // Legacy aliases
    WorkKey: item.karbon_work_item_key || item.id,
    Key: item.karbon_work_item_key || item.id,
    Title: item.title || "",
    ClientName: item.client_name || undefined,
    WorkType: item.work_type || undefined,
    WorkStatus: item.workflow_status || item.status || undefined,
    DueDate: item.due_date || undefined,
    StartDate: item.start_date || undefined,
    CompletedDate: item.completed_date || undefined,
    LastModifiedDateTime: item.karbon_modified_at || undefined,
    AssigneeName: item.assignee_name || undefined,
    // Build AssignedTo array from assignee_name for backwards compat
    AssignedTo: item.assignee_name
      ? [{ FullName: item.assignee_name, Email: undefined, UserKey: undefined }]
      : undefined,
    ClientKey: item.karbon_client_key || undefined,
    Description: item.description || undefined,
    Priority: item.priority || undefined,
    PrimaryStatus: item.primary_status || item.status || undefined,
    SecondaryStatus: item.secondary_status || undefined,
    ClientGroupName: item.client_group_name || undefined,
  }
}

function isTaxWorkItem(title: string, workType?: string): boolean {
  if (!title) return false
  const titleLower = title.toLowerCase()
  const workTypeLower = (workType || "").toLowerCase()
  if (titleLower.startsWith("tax |")) return true
  if (
    workTypeLower.includes("tax") ||
    workTypeLower.includes("1040") ||
    workTypeLower.includes("1120") ||
    workTypeLower.includes("1065") ||
    workTypeLower.includes("990")
  ) {
    return true
  }
  return false
}

export function KarbonWorkItemsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  // Pathname allowlist for the 5000-row work-items fetch.
  //
  // This provider is mounted at the root layout (app/layout.tsx), so
  // historically it fired its 5000-row fetch on **every** page
  // navigation — including the sign-in redirect to "/" — even though
  // only one app route actually consumes the data:
  //   • /work-items                      → WorkItemsView
  //
  // The other components that import useKarbonWorkItems
  // (irs-notices, triage-summary, busy-season-tracker) are currently
  // not rendered from any app/** route, so they don't trigger fetches
  // either. Add their owning routes here if/when they get re-mounted.
  //
  // On every other route we pass `null` to useSWR, which means the
  // fetcher never runs and the provider just returns empty arrays.
  // Consumers on those routes don't exist, so they never read the
  // empty state — this is a pure cost cut. Saves ~500ms–2s on the
  // post-signin render and on every navigation that doesn't need it.
  const isAuthPage = pathname === "/login" || pathname?.startsWith("/auth")
  const needsWorkItems =
    !isAuthPage &&
    (pathname === "/work-items" || pathname?.startsWith("/work-items/"))

  // Fetch from Supabase-backed route (fast, <100ms) instead of
  // the Karbon API proxy (slow, 30+ seconds, frequently times out).
  const { data, error, isLoading, mutate } = useSWR(
    needsWorkItems ? "/api/work-items?limit=5000" : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60000,
      refreshInterval: 300000,
    },
  )

  const allWorkItems = useMemo(() => {
    const items = data?.work_items || []
    return items.map(mapSupabaseToKarbon)
  }, [data])

  // Exclude completed / cancelled items for dashboard views
  const activeWorkItems = useMemo(() => {
    return allWorkItems.filter((item: KarbonWorkItem) => {
      const s = (item.status || item.primary_status || item.WorkStatus || "").toLowerCase()
      return !s.includes("completed") && !s.includes("complete") && !s.includes("cancelled") && !s.includes("canceled")
    })
  }, [allWorkItems])

  const taxWorkItems = useMemo(() => {
    return activeWorkItems.filter((item: KarbonWorkItem) => isTaxWorkItem(item.Title, item.WorkType))
  }, [activeWorkItems])

  const value: KarbonWorkItemsContextValue = {
    allWorkItems,
    activeWorkItems,
    taxWorkItems,
    isLoading,
    error: error?.message || null,
    refresh: () => mutate(),
  }

  return (
    <KarbonWorkItemsContext.Provider value={value}>
      {children}
    </KarbonWorkItemsContext.Provider>
  )
}

export function useKarbonWorkItems() {
  const context = useContext(KarbonWorkItemsContext)
  if (!context) {
    throw new Error("useKarbonWorkItems must be used within a KarbonWorkItemsProvider")
  }
  return context
}

// Hook specifically for tax work items (busy season)
export function useTaxWorkItems() {
  const { taxWorkItems, isLoading, error, refresh } = useKarbonWorkItems()
  return { taxWorkItems, isLoading, error, refresh }
}
