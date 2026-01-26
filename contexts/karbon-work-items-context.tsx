"use client"

import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import useSWR from "swr"

// Karbon work item type
export interface KarbonWorkItem {
  WorkKey: string
  Title: string
  ClientName?: string
  WorkType?: string
  WorkStatus?: string
  DueDate?: string
  StartDate?: string
  LastModifiedDateTime?: string
  AssigneeName?: string
  ClientKey?: string
  Description?: string
}

interface KarbonWorkItemsContextValue {
  // All work items from Karbon
  allWorkItems: KarbonWorkItem[]
  // Filtered tax work items (title starts with "TAX |")
  taxWorkItems: KarbonWorkItem[]
  // Loading and error states
  isLoading: boolean
  error: string | null
  // Refresh function
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

// Helper to check if a work item is a tax work item
function isTaxWorkItem(title: string, workType?: string): boolean {
  if (!title) return false
  const titleLower = title.toLowerCase()
  const workTypeLower = (workType || "").toLowerCase()
  
  // Check if title starts with "TAX |" pattern
  if (titleLower.startsWith("tax |")) return true
  
  // Check work type for tax-related keywords
  if (workTypeLower.includes("tax") || 
      workTypeLower.includes("1040") || 
      workTypeLower.includes("1120") ||
      workTypeLower.includes("1065") ||
      workTypeLower.includes("990")) {
    return true
  }
  
  return false
}

export function KarbonWorkItemsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  
  // Don't fetch on login or auth pages (pathname can be null on initial render)
  const isAuthPage = !pathname || pathname === '/login' || pathname.startsWith('/auth')
  
  const { data, error, isLoading, mutate } = useSWR(
    isAuthPage ? null : "/api/karbon/work-items",
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60000, // 1 minute - prevents duplicate fetches
      refreshInterval: 300000, // 5 minutes - background refresh
    }
  )

  const allWorkItems = useMemo(() => {
    return data?.workItems || []
  }, [data])

  const taxWorkItems = useMemo(() => {
    return allWorkItems.filter((item: KarbonWorkItem) => 
      isTaxWorkItem(item.Title, item.WorkType)
    )
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
