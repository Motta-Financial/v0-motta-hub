import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectDetailView } from "@/components/projects/project-detail-view"

export const dynamic = "force-dynamic"

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <DashboardLayout>
      <ProjectDetailView projectId={id} />
    </DashboardLayout>
  )
}
