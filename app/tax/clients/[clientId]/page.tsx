import { DashboardLayout } from "@/components/dashboard-layout"
import { TaxClientProfile } from "@/components/tax/tax-client-profile"

interface PageProps {
  params: Promise<{ clientId: string }>
}

/**
 * /tax/clients/[clientId] — Tax Profile page
 *
 * Shows a comprehensive tax profile for a single ProConnect client,
 * including all their returns organized by year with expandable details.
 * Users can click "View 1040" to open the full form in a new tab.
 */
export default async function TaxClientProfilePage({ params }: PageProps) {
  const { clientId } = await params

  return (
    <DashboardLayout>
      <TaxClientProfile clientId={clientId} />
    </DashboardLayout>
  )
}
