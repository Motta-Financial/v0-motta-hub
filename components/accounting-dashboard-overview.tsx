"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Pause,
  FileText,
  Users,
  Calendar,
  RefreshCw,
} from "lucide-react"

interface DashboardOverviewProps {
  onNavigateToBookkeeping: () => void
  onNavigateToOnboarding: () => void
}

export function AccountingDashboardOverview({
  onNavigateToBookkeeping,
  onNavigateToOnboarding,
}: DashboardOverviewProps) {
  const [currentMonth, setCurrentMonth] = useState("")
  const [loading, setLoading] = useState(true)
  const [bookkeepingStats, setBookkeepingStats] = useState({
    total: 0,
    byStatus: {
      complete: 0,
      needInfo: 0,
      onHold: 0,
      notReady: 0,
      review: 0,
    },
    avgProgress: 0,
  })

  const [onboardingStats, setOnboardingStats] = useState({
    total: 0,
    byPhase: {
      proposal: 0,
      discovery: 0,
      reconciliation: 0,
      quality: 0,
    },
    byStatus: {
      accepted: 0,
      awaiting: 0,
      draft: 0,
      na: 0,
    },
  })

  useEffect(() => {
    const now = new Date()
    setCurrentMonth(now.toLocaleDateString("en-US", { month: "long", year: "numeric" }))
    fetchStats()
  }, [])

  const fetchStats = async () => {
    setLoading(true)
    try {
      const now = new Date()
      const monthNum = now.getMonth() + 1
      const yearNum = now.getFullYear()

      // Fetch ACCT | Bookkeeping work items for current month
      const bookkeepingResponse = await fetch(
        `/api/supabase/work-items?titleFilter=ACCT | Bookkeeping&status=active&periodMonth=${monthNum}&periodYear=${yearNum}`,
      )

      if (bookkeepingResponse.ok) {
        const data = await bookkeepingResponse.json()
        const workItems = data.workItems || []

        // Calculate stats from work items
        let complete = 0
        let needInfo = 0
        let onHold = 0
        let notReady = 0
        let review = 0

        workItems.forEach((item: any) => {
          const status = item.workflow_status?.toLowerCase() || ""
          if (status.includes("complete")) {
            complete++
          } else if (status.includes("hold") || status.includes("waiting")) {
            onHold++
          } else if (status.includes("review")) {
            review++
          } else if (status.includes("info") || status.includes("pending")) {
            needInfo++
          } else {
            notReady++
          }
        })

        setBookkeepingStats({
          total: workItems.length,
          byStatus: { complete, needInfo, onHold, notReady, review },
          avgProgress: workItems.length > 0 ? Math.round((complete / workItems.length) * 100) : 0,
        })
      }

      // Fetch onboarding work items (work items with "Onboarding" in title)
      const onboardingResponse = await fetch(`/api/supabase/work-items?titleFilter=Onboarding&status=active`)

      if (onboardingResponse.ok) {
        const data = await onboardingResponse.json()
        const workItems = data.workItems || []

        let proposal = 0
        let discovery = 0
        let reconciliation = 0
        let quality = 0
        let accepted = 0
        let awaiting = 0
        let draft = 0
        let na = 0

        workItems.forEach((item: any) => {
          const status = item.workflow_status?.toLowerCase() || ""
          const title = item.title?.toLowerCase() || ""

          // Phase detection
          if (title.includes("proposal") || status.includes("proposal")) {
            proposal++
          } else if (title.includes("discovery") || status.includes("discovery")) {
            discovery++
          } else if (title.includes("reconciliation") || status.includes("reconciliation")) {
            reconciliation++
          } else if (title.includes("quality") || status.includes("quality")) {
            quality++
          }

          // Status detection
          if (status.includes("accept")) {
            accepted++
          } else if (status.includes("await") || status.includes("pending")) {
            awaiting++
          } else if (status.includes("draft")) {
            draft++
          } else {
            na++
          }
        })

        setOnboardingStats({
          total: workItems.length,
          byPhase: { proposal, discovery, reconciliation, quality },
          byStatus: { accepted, awaiting, draft, na },
        })
      }
    } catch (error) {
      console.error("[v0] Error fetching accounting stats:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Loading accounting dashboard from Supabase...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Monthly Bookkeeping Overview */}
      <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onNavigateToBookkeeping}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Monthly Bookkeeping</CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <Calendar className="h-3 w-3" />
                  {currentMonth} - ACCT | Bookkeeping Work Items
                </CardDescription>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{bookkeepingStats.total}</p>
                <p className="text-xs text-muted-foreground">Total Clients</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{bookkeepingStats.byStatus.complete}</p>
                <p className="text-xs text-muted-foreground">Complete</p>
              </div>
              <div className="text-center p-3 bg-yellow-50 rounded-lg">
                <p className="text-2xl font-bold text-yellow-600">{bookkeepingStats.byStatus.needInfo}</p>
                <p className="text-xs text-muted-foreground">Need Info</p>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">{bookkeepingStats.avgProgress}%</p>
                <p className="text-xs text-muted-foreground">Completion</p>
              </div>
            </div>

            {/* Status Breakdown */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Status Breakdown</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-2 bg-green-50 rounded">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm">Complete</span>
                  </div>
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {bookkeepingStats.byStatus.complete}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-2 bg-yellow-50 rounded">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-yellow-600" />
                    <span className="text-sm">Need Info</span>
                  </div>
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                    {bookkeepingStats.byStatus.needInfo}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-2 bg-orange-50 rounded">
                  <div className="flex items-center gap-2">
                    <Pause className="h-4 w-4 text-orange-600" />
                    <span className="text-sm">On Hold</span>
                  </div>
                  <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                    {bookkeepingStats.byStatus.onHold}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-2 bg-red-50 rounded">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <span className="text-sm">Not Ready</span>
                  </div>
                  <Badge variant="secondary" className="bg-red-100 text-red-800">
                    {bookkeepingStats.byStatus.notReady}
                  </Badge>
                </div>
              </div>
            </div>

            <Button variant="outline" className="w-full bg-transparent" onClick={onNavigateToBookkeeping}>
              View Full Tracker
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Onboarding Clients Overview */}
      <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onNavigateToOnboarding}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Onboarding Clients</CardTitle>
                <CardDescription>Clients in proposal and setup stages</CardDescription>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{onboardingStats.total}</p>
                <p className="text-xs text-muted-foreground">Total Clients</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{onboardingStats.byStatus.accepted}</p>
                <p className="text-xs text-muted-foreground">Accepted</p>
              </div>
              <div className="text-center p-3 bg-yellow-50 rounded-lg">
                <p className="text-2xl font-bold text-yellow-600">{onboardingStats.byStatus.awaiting}</p>
                <p className="text-xs text-muted-foreground">Awaiting</p>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">{onboardingStats.byStatus.draft}</p>
                <p className="text-xs text-muted-foreground">Draft</p>
              </div>
            </div>

            {/* Phase Breakdown */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Phase Breakdown</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">Proposal Stage</span>
                      <span className="text-sm font-semibold">{onboardingStats.byPhase.proposal}</span>
                    </div>
                    <Progress
                      value={
                        onboardingStats.total > 0 ? (onboardingStats.byPhase.proposal / onboardingStats.total) * 100 : 0
                      }
                      className="h-2"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">Discovery</span>
                      <span className="text-sm font-semibold">{onboardingStats.byPhase.discovery}</span>
                    </div>
                    <Progress
                      value={
                        onboardingStats.total > 0
                          ? (onboardingStats.byPhase.discovery / onboardingStats.total) * 100
                          : 0
                      }
                      className="h-2"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">Reconciliation</span>
                      <span className="text-sm font-semibold">{onboardingStats.byPhase.reconciliation}</span>
                    </div>
                    <Progress
                      value={
                        onboardingStats.total > 0
                          ? (onboardingStats.byPhase.reconciliation / onboardingStats.total) * 100
                          : 0
                      }
                      className="h-2"
                    />
                  </div>
                </div>
              </div>
            </div>

            <Button variant="outline" className="w-full bg-transparent" onClick={onNavigateToOnboarding}>
              View Full Tracker
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
