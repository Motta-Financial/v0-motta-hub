"use client"

import { useState } from "react"
import Link from "next/link"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ServiceLineDashboard } from "@/components/service-line-dashboard"
import { AccountingBookkeepingTracker } from "@/components/accounting-bookkeeping-tracker"
import { AccountingOnboardingTracker } from "@/components/accounting-onboarding-tracker"
import { AccountingDashboardOverview } from "@/components/accounting-dashboard-overview"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronRight, ClipboardList } from "lucide-react"
import { ACCT_WORK_TYPES } from "@/lib/accounting-work-types"

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

        {/* Cross-link to the firm-wide multi-tab Project Plan view that
            replaced the FY2026 project-plan Excel workbook. Lives at
            /accounting/project-plan and is also reachable from the sidebar. */}
        <Card className="border-blue-200 bg-blue-50/40 hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <ClipboardList className="h-5 w-5 text-blue-700" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-lg">Project Plan</CardTitle>
                    <Badge variant="outline" className="bg-white text-blue-800 border-blue-200">
                      Firm-wide
                    </Badge>
                  </div>
                  <CardDescription>
                    Dashboard, Team Workload, Client Roster, Timeline, Kanban, and the 10-step
                    Bookkeeping Checklist — live from Karbon &amp; Supabase.
                  </CardDescription>
                </div>
              </div>
              <Button asChild>
                <Link href="/accounting/project-plan">
                  Open Project Plan
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
        </Card>

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
              description="Overview of all clients and work items in the canonical Accounting work types"
              // Strict allow-list match on Karbon's canonical work_type
              // column — every other Accounting surface (Overview cards,
              // Bookkeeping tracker, Onboarding tracker, Project Plan)
              // imports the same constant, so they all reconcile to an
              // identical universe of work items. Updating the canonical
              // list happens in one place: lib/accounting-work-types.ts.
              workTypes={ACCT_WORK_TYPES}
              // serviceLineKeywords is a no-op when workTypes is set; we
              // keep it populated so the prop contract holds and so the
              // legacy title-keyword fallback still works if a caller
              // ever drops the strict filter.
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
