import { DashboardLayout } from "@/components/dashboard-layout"
import { ClientProfile } from "@/components/client-profile"

interface ClientPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function ClientPage({ params }: ClientPageProps) {
  const { id } = await params
  return (
    <DashboardLayout>
      <ClientProfile clientId={id} />
    </DashboardLayout>
  )
}
