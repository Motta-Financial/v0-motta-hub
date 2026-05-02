import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesInvoices } from "@/components/sales-invoices"

export const metadata = {
  title: "Invoices | Motta Hub",
  description: "Billed amounts, payments collected, and outstanding balances",
}

export default function SalesInvoicesPage() {
  return (
    <DashboardLayout>
      <SalesInvoices />
    </DashboardLayout>
  )
}
