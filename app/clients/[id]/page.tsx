import { DashboardLayout } from "@/components/dashboard-layout"
import { ClientProfile } from "@/components/client-profile"

interface ClientPageProps {
  params: {
    id: string
  }
}

export default function ClientPage({ params }: ClientPageProps) {
  return (
    <DashboardLayout>
      <ClientProfile clientId={params.id} />
    </DashboardLayout>
  )
}
