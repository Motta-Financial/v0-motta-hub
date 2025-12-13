"use client"

import { useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ServiceLineDashboard } from "@/components/service-line-dashboard"
import { AccountingBookkeepingTracker } from "@/components/accounting-bookkeeping-tracker"
import { AccountingOnboardingTracker } from "@/components/accounting-onboarding-tracker"
import { AccountingDashboardOverview } from "@/components/accounting-dashboard-overview"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function AccountingPage() {
  const [activeTab, setActiveTab] = useState("overview")

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Accounting Dashboard</h1>
          <p className="text-muted-foreground">
            Manage monthly bookkeeping, onboarding clients, and track all accounting operations
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="bookkeeping">Monthly Bookkeeping</TabsTrigger>
            <TabsTrigger value="onboarding">Onboarding Clients</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <AccountingDashboardOverview
              onNavigateToBookkeeping={() => setActiveTab("bookkeeping")}
              onNavigateToOnboarding={() => setActiveTab("onboarding")}
            />
            <ServiceLineDashboard
              serviceLine="ACCOUNTING"
              title="Accounting Stats"
              description="Overview of all accounting clients and work items"
              serviceLineKeywords={["ACCOUNTING", "ACCT", "BOOKKEEPING", "BK", "PAYROLL", "PR"]}
            />
          </TabsContent>

          <TabsContent value="bookkeeping" className="mt-6">
            <AccountingBookkeepingTracker />
          </TabsContent>

          <TabsContent value="onboarding" className="mt-6">
            <AccountingOnboardingTracker />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
