import { DashboardLayout } from "@/components/dashboard-layout"
import { WebhookManagement } from "@/components/webhook-management"

export default function WebhooksPage() {
  return (
    <DashboardLayout>
      <WebhookManagement />
    </DashboardLayout>
  )
}
