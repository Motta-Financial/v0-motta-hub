import { DashboardLayout } from "@/components/dashboard-layout"
import { ServiceLineDashboard } from "@/components/service-line-dashboard"

export default function TaxPage() {
  return (
    <DashboardLayout>
      <ServiceLineDashboard
        serviceLine="TAX"
        title="Tax Dashboard"
        description="Overview of all tax clients and work items"
        serviceLineKeywords={["TAX", "TAXES", "1040", "1120", "1065"]}
        showAddClient={true}
      />
    </DashboardLayout>
  )
}
