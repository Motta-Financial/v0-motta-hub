import { DashboardLayout } from "@/components/dashboard-layout"
import { RelationshipsClient } from "@/components/tax/relationships-client"

export const dynamic = "force-dynamic"

export default function RelationshipsPage() {
  return (
    <DashboardLayout>
      <RelationshipsClient />
    </DashboardLayout>
  )
}
