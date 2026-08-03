import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectTemplatesView } from "@/components/projects/project-templates-view"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Project Templates — Motta Hub",
  description:
    "Project Types and Karbon Work Templates that can be used to start new client projects.",
}

export default function ProjectTemplatesPage() {
  return (
    <DashboardLayout>
      <ProjectTemplatesView />
    </DashboardLayout>
  )
}
