import { DashboardLayout } from "@/components/dashboard-layout"
import { AirtableMigration } from "@/components/airtable-migration"

export default function MigrationPage() {
  return (
    <DashboardLayout>
      <AirtableMigration />
    </DashboardLayout>
  )
}
