"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectPlanDashboard } from "./project-plan-dashboard"
import { ProjectPlanTeamWorkload } from "./project-plan-team-workload"
import { ProjectPlanClientRoster } from "./project-plan-client-roster"
import { ProjectPlanTimeline } from "./project-plan-timeline"
import { ProjectPlanKanban } from "./project-plan-kanban"
import { ProjectPlanChecklist } from "./project-plan-checklist"

const TABS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "team", label: "Team Workload" },
  { value: "roster", label: "Client Roster" },
  { value: "timeline", label: "Timeline" },
  { value: "kanban", label: "Kanban" },
  { value: "checklist", label: "Bookkeeping Checklist" },
] as const

type TabValue = (typeof TABS)[number]["value"]

interface ProjectPlanViewProps {
  defaultTab?: TabValue
}

// Orchestrator for the six-tab view that mirrors the FY2026 Excel
// project-plan workbook. Lives in its own client component so it can hold
// the tab state without forcing the route to be client.
export function ProjectPlanView({ defaultTab = "dashboard" }: ProjectPlanViewProps) {
  const [tab, setTab] = useState<TabValue>(defaultTab)

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="w-full">
      <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="text-xs md:text-sm">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="dashboard" className="mt-6">
        <ProjectPlanDashboard />
      </TabsContent>
      <TabsContent value="team" className="mt-6">
        <ProjectPlanTeamWorkload />
      </TabsContent>
      <TabsContent value="roster" className="mt-6">
        <ProjectPlanClientRoster />
      </TabsContent>
      <TabsContent value="timeline" className="mt-6">
        <ProjectPlanTimeline />
      </TabsContent>
      <TabsContent value="kanban" className="mt-6">
        <ProjectPlanKanban />
      </TabsContent>
      <TabsContent value="checklist" className="mt-6">
        <ProjectPlanChecklist />
      </TabsContent>
    </Tabs>
  )
}
