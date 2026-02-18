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
  allWorkItems: KarbonWorkItem[]
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

  // Don't fetch on login or auth pages
  const isAuthPage = pathname === "/login" || pathname?.startsWith("/auth")

  // Fetch from Supabase-backed route (fast, <100ms) instead of
  // the Karbon API proxy (slow, 30+ seconds, frequently times out)
  const { data, error, isLoading, mutate } = useSWR(
    isAuthPage ? null : "/api/work-items?limit=5000",
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

  const taxWorkItems = useMemo(() => {
    return allWorkItems.filter((item: KarbonWorkItem) => isTaxWorkItem(item.Title, item.WorkType))
  }, [allWorkItems])

  const value: KarbonWorkItemsContextValue = {
    allWorkItems,
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
