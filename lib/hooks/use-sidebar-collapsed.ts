"use client"

import { useEffect, useState } from "react"

// Shared across BOTH the internal Hub (dashboard-layout.tsx) and the client
// portal (client-portal-layout.tsx) — same storage key, same shape — so
// collapsing the rail in one app is remembered in the other. Both apps run
// on the same origin, so localStorage is already shared; this hook is just
// the single source of truth both layouts read/write through.
const SIDEBAR_COLLAPSED_STORAGE_KEY = "motta:sidebar:collapsed:v1"

export const SIDEBAR_EXPANDED_WIDTH_HUB = 256 // 16rem — matches existing md:w-64
export const SIDEBAR_EXPANDED_WIDTH_PORTAL = 224 // 14rem — matches existing md:w-56
export const SIDEBAR_COLLAPSED_WIDTH = 56

/**
 * Tracks whether the desktop sidebar rail is collapsed, persisted to
 * localStorage so the choice survives reloads and carries across both apps.
 * Defaults to expanded (false) on first paint — same SSR-safe hydration
 * pattern used by the Hub's `expandedSections` state — so the server and
 * client render identically before the effect below syncs the real value.
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
      if (raw === "true") setCollapsed(true)
    } catch {
      // Storage can throw in private mode; fall through to expanded.
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed))
    } catch {
      // Storage can throw in private mode or when the quota is full; the
      // toggle still works in-session, just without persistence.
    }
  }, [collapsed, hydrated])

  const toggleCollapsed = () => setCollapsed((prev) => !prev)

  return { collapsed, toggleCollapsed, hydrated }
}
