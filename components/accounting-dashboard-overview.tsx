"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ChevronRight, CheckCircle2, Clock, AlertCircle, Pause, FileText, Users, Calendar } from "lucide-react"

interface DashboardOverviewProps {
  onNavigateToBookkeeping: () => void
  onNavigateToOnboarding: () => void
}

export function AccountingDashboardOverview({
  onNavigateToBookkeeping,
  onNavigateToOnboarding,
}: DashboardOverviewProps) {
  const [currentMonth, setCurrentMonth] = useState("")
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

    setBookkeepingStats({
      total: 45,
      byStatus: {
        complete: 12,
        needInfo: 8,
        onHold: 5,
        notReady: 15,
        review: 5,
      },
      avgProgress: 67,
    })

    setOnboardingStats({
      total: 18,
      byPhase: {
        proposal: 10,
        discovery: 5,
        reconciliation: 2,
        quality: 1,
      },
      byStatus: {
        accepted: 6,
        awaiting: 7,
        draft: 3,
        na: 2,
      },
    })
  }, [])

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
                  {currentMonth}
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
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-900">{bookkeepingStats.total}</p>
                <p className="text-xs text-gray-600">Total Clients</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{bookkeepingStats.byStatus.complete}</p>
                <p className="text-xs text-gray-600">Complete</p>
              </div>
              <div className="text-center p-3 bg-yellow-50 rounded-lg">
                <p className="text-2xl font-bold text-yellow-600">{bookkeepingStats.byStatus.needInfo}</p>
                <p className="text-xs text-gray-600">Need Info</p>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">{bookkeepingStats.avgProgress}%</p>
                <p className="text-xs text-gray-600">Avg Progress</p>
              </div>
            </div>

            {/* Status Breakdown */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Status Breakdown</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-2 bg-green-50 rounded">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-gray-700">Complete</span>
                  </div>
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {bookkeepingStats.byStatus.complete}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-2 bg-yellow-50 rounded">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-yellow-600" />
                    <span className="text-sm text-gray-700">Need Info</span>
                  </div>
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                    {bookkeepingStats.byStatus.needInfo}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-2 bg-orange-50 rounded">
                  <div className="flex items-center gap-2">
                    <Pause className="h-4 w-4 text-orange-600" />
                    <span className="text-sm text-gray-700">On Hold</span>
                  </div>
                  <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                    {bookkeepingStats.byStatus.onHold}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-2 bg-red-50 rounded">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <span className="text-sm text-gray-700">Not Ready</span>
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
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-900">{onboardingStats.total}</p>
                <p className="text-xs text-gray-600">Total Clients</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{onboardingStats.byStatus.accepted}</p>
                <p className="text-xs text-gray-600">Accepted</p>
              </div>
              <div className="text-center p-3 bg-yellow-50 rounded-lg">
                <p className="text-2xl font-bold text-yellow-600">{onboardingStats.byStatus.awaiting}</p>
                <p className="text-xs text-gray-600">Awaiting</p>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">{onboardingStats.byStatus.draft}</p>
                <p className="text-xs text-gray-600">Draft</p>
              </div>
            </div>

            {/* Phase Breakdown */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Phase Breakdown</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">Proposal Stage</span>
                      <span className="text-sm font-semibold text-gray-900">{onboardingStats.byPhase.proposal}</span>
                    </div>
                    <Progress
                      value={(onboardingStats.byPhase.proposal / onboardingStats.total) * 100}
                      className="h-2"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">Discovery</span>
                      <span className="text-sm font-semibold text-gray-900">{onboardingStats.byPhase.discovery}</span>
                    </div>
                    <Progress
                      value={(onboardingStats.byPhase.discovery / onboardingStats.total) * 100}
                      className="h-2"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">Reconciliation</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {onboardingStats.byPhase.reconciliation}
                      </span>
                    </div>
                    <Progress
                      value={(onboardingStats.byPhase.reconciliation / onboardingStats.total) * 100}
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
