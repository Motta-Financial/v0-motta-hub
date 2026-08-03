import { DashboardLayout } from "@/components/dashboard-layout"
import { PaymentLinksManager } from "@/components/payments/payment-links-manager"

export const metadata = {
  title: "Payment Links | ALFRED Hub",
  description: "Create and send secure payment links for fixed service packages.",
}

export default function PaymentLinksPage() {
  return (
    <DashboardLayout>
      <PaymentLinksManager />
    </DashboardLayout>
  )
}
