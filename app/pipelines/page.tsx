import { DashboardLayout } from "@/components/dashboard-layout"
import { ServicePipeline } from "@/components/service-pipeline"

export default function PipelinesPage() {
  return (
    <DashboardLayout>
      <ServicePipeline />
    </DashboardLayout>
  )
}
