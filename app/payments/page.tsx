import { DashboardLayout } from "@/components/dashboard-layout"
import { PaymentsDashboard } from "@/components/payments-dashboard"

export default function PaymentsPage() {
  return (
    <DashboardLayout>
      <PaymentsDashboard />
    </DashboardLayout>
  )
}
