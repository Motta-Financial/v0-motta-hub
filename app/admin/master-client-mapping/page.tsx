"use client"

import { DashboardLayout } from "@/components/dashboard-layout"
import { MasterClientMappingClient } from "@/components/admin/master-client-mapping-client"

export default function MasterClientMappingPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Master Client Mapping</h1>
          <p className="text-muted-foreground">
            One row per Motta Hub client (anchored on the Supabase uuid) with every external-system identifier:
            Karbon, Ignition, and ProConnect.
          </p>
        </div>
        <MasterClientMappingClient />
      </div>
    </DashboardLayout>
  )
}
