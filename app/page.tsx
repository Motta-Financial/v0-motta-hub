"use client"

import { useState, useEffect } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardHome } from "@/components/dashboard-home"
import { ServiceLineDashboard } from "@/components/service-line-dashboard"
import { AccountingDashboardOverview } from "@/components/accounting-dashboard-overview"
import { AccountingBookkeepingTracker } from "@/components/accounting-bookkeeping-tracker"
import { AccountingOnboardingTracker } from "@/components/accounting-onboarding-tracker"
import { DevTeamDashboard } from "@/components/dev-team-dashboard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Home, Calculator, FileText, Users2 } from "lucide-react"

export default function Page() {
  const [activeTab, setActiveTab] = useState("dashboard")
  const [accountingSubTab, setAccountingSubTab] = useState("overview")

  useEffect(() => {
    console.log("[v0] Main page (/) mounted")
  }, [])

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="accounting" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              <span className="hidden sm:inline">Accounting</span>
            </TabsTrigger>
            <TabsTrigger value="tax" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Tax</span>
            </TabsTrigger>
            <TabsTrigger value="special-teams" className="flex items-center gap-2">
              <Users2 className="h-4 w-4" />
              <span className="hidden sm:inline">Special Teams</span>
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="mt-6">
            <DashboardHome />
          </TabsContent>

          {/* Accounting Tab */}
          <TabsContent value="accounting" className="mt-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Accounting Dashboard</h1>
                <p className="text-muted-foreground">
                  Manage monthly bookkeeping, onboarding clients, and track all accounting operations
                </p>
              </div>

              <Tabs value={accountingSubTab} onValueChange={setAccountingSubTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="bookkeeping">Monthly Bookkeeping</TabsTrigger>
                  <TabsTrigger value="onboarding">Onboarding Clients</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6 mt-6">
                  <AccountingDashboardOverview
                    onNavigateToBookkeeping={() => setAccountingSubTab("bookkeeping")}
                    onNavigateToOnboarding={() => setAccountingSubTab("onboarding")}
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
          </TabsContent>

          {/* Tax Tab */}
          <TabsContent value="tax" className="mt-6">
            <ServiceLineDashboard
              serviceLine="TAX"
              title="Tax Dashboard"
              description="Overview of all tax clients and work items"
              serviceLineKeywords={["TAX", "TAXES", "1040", "1120", "1065"]}
            />
          </TabsContent>

          {/* Special Teams Tab */}
          <TabsContent value="special-teams" className="mt-6">
            <DevTeamDashboard />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
