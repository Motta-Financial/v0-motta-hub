"use client"

import { DashboardLayout } from "@/components/dashboard-layout"
import { UnlinkedRecordsClient } from "@/components/admin/unlinked-records-client"

export default function UnlinkedRecordsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Unlinked Records</h1>
          <p className="text-muted-foreground">
            Review and link records from Ignition, Calendly, and Debriefs to your contacts and organizations
          </p>
        </div>
        <UnlinkedRecordsClient />
      </div>
    </DashboardLayout>
  )
}
