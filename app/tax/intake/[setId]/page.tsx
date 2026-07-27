import { DashboardLayout } from "@/components/dashboard-layout"
import { TaxIntakeClient } from "@/components/tax/tax-intake-client"

interface PageProps {
  params: Promise<{ setId: string }>
}

/**
 * /tax/intake/[setId] — gather 1040 source documents in the Hub.
 *
 * The preparer keys W-2s here; the page shows the resulting 1040 preview
 * and the exact ProConnect Import payload side by side, so what will be
 * written is visible before anything is sent.
 */
export default async function TaxIntakePage({ params }: PageProps) {
  const { setId } = await params
  return (
    <DashboardLayout>
      <TaxIntakeClient setId={setId} />
    </DashboardLayout>
  )
}
