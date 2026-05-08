"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectPlanDashboard } from "./project-plan-dashboard"
import { ProjectPlanTeamWorkload } from "./project-plan-team-workload"
import { ProjectPlanClientRoster } from "./project-plan-client-roster"
import { ProjectPlanTimeline } from "./project-plan-timeline"
import { ProjectPlanKanban } from "./project-plan-kanban"
import { ProjectPlanChecklist } from "./project-plan-checklist"
import {
  ProjectPlanProvider,
  useProjectPlanContext,
  type ProjectPlanTab,
} from "./project-plan-context"

const TABS: { value: ProjectPlanTab; label: string }[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "team", label: "Team Workload" },
  { value: "roster", label: "Client Roster" },
  { value: "timeline", label: "Timeline" },
  { value: "kanban", label: "Kanban" },
  { value: "checklist", label: "Bookkeeping Checklist" },
]

interface ProjectPlanViewProps {
  defaultTab?: ProjectPlanTab
}

// Orchestrator for the six-tab Project Plan view. The active tab and the
// shared cross-tab filters live in ProjectPlanContext so that drilling
// from the Dashboard into the Roster (or Kanban) carries the clicked
// slice with it instead of forcing the user to re-apply the filter.
export function ProjectPlanView({ defaultTab = "dashboard" }: ProjectPlanViewProps) {
  return (
    <ProjectPlanProvider defaultTab={defaultTab}>
      <ProjectPlanTabs />
    </ProjectPlanProvider>
  )
}

function ProjectPlanTabs() {
  const { tab, setTab } = useProjectPlanContext()
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as ProjectPlanTab)} className="w-full">
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
