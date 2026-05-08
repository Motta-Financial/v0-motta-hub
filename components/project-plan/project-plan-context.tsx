"use client"

// Cross-tab state for the Accounting Project Plan view. The Dashboard tab
// surfaces aggregate stats (counts by status, by service type, by client,
// by team member); when a user clicks one of those rows they should land
// on the Roster (or Kanban) tab pre-filtered to that slice. Rather than
// thread callbacks through every component, we share a small piece of
// state through a Context that the orchestrator owns.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import type { ServiceType, StatusBucket } from "./project-plan-shared"

export type ProjectPlanTab =
  | "dashboard"
  | "team"
  | "roster"
  | "timeline"
  | "kanban"
  | "checklist"

export interface ProjectPlanFilters {
  /** Free-text search applied to client / title / work-type / Karbon key */
  query: string
  status: StatusBucket | "ALL"
  service: ServiceType | "ALL"
  assignee: string // "ALL" or a person's full name
}

export const DEFAULT_PROJECT_PLAN_FILTERS: ProjectPlanFilters = {
  query: "",
  status: "ALL",
  service: "ALL",
  assignee: "ALL",
}

interface ProjectPlanContextValue {
  filters: ProjectPlanFilters
  setFilters: (next: Partial<ProjectPlanFilters>) => void
  resetFilters: () => void
  /**
   * Jump to a different tab and apply a (partial) filter override in the
   * same call. Used by the Dashboard's drill-throughs:
   *   jumpTo("roster", { status: "Waiting" })
   * which both navigates and pre-applies the slice the user clicked.
   */
  jumpTo: (tab: ProjectPlanTab, overrides?: Partial<ProjectPlanFilters>) => void
  /** Currently-active tab (mirrors the Tabs control). */
  tab: ProjectPlanTab
  setTab: (tab: ProjectPlanTab) => void
}

const ProjectPlanContext = createContext<ProjectPlanContextValue | null>(null)

interface ProviderProps {
  defaultTab: ProjectPlanTab
  children: ReactNode
}

export function ProjectPlanProvider({ defaultTab, children }: ProviderProps) {
  const [tab, setTab] = useState<ProjectPlanTab>(defaultTab)
  const [filters, setFiltersState] = useState<ProjectPlanFilters>(DEFAULT_PROJECT_PLAN_FILTERS)

  const setFilters = useCallback((next: Partial<ProjectPlanFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }))
  }, [])

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_PROJECT_PLAN_FILTERS)
  }, [])

  // jumpTo is the primary cross-tab interaction: it merges the override
  // into the shared filter state and switches tabs in a single state
  // update, so the destination tab renders with the correct filter on
  // first paint instead of flashing the unfiltered view.
  const jumpTo = useCallback((targetTab: ProjectPlanTab, overrides?: Partial<ProjectPlanFilters>) => {
    if (overrides) setFiltersState((prev) => ({ ...prev, ...overrides }))
    setTab(targetTab)
  }, [])

  const value = useMemo<ProjectPlanContextValue>(
    () => ({ filters, setFilters, resetFilters, jumpTo, tab, setTab }),
    [filters, setFilters, resetFilters, jumpTo, tab],
  )

  return <ProjectPlanContext.Provider value={value}>{children}</ProjectPlanContext.Provider>
}

export function useProjectPlanContext() {
  const ctx = useContext(ProjectPlanContext)
  if (!ctx) {
    throw new Error(
      "useProjectPlanContext must be used inside <ProjectPlanProvider> (e.g. inside ProjectPlanView).",
    )
  }
  return ctx
}
