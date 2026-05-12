import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectsListView } from "@/components/projects/projects-list-view"

export const dynamic = "force-dynamic"

export default function ProjectsPage() {
  return (
    <DashboardLayout>
      <ProjectsListView />
    </DashboardLayout>
  )
}
