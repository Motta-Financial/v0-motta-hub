"use client"

import { Loader2 } from "lucide-react"
import { TriageFeed } from "@/components/triage-feed"
import { ExpandableCard } from "@/components/ui/expandable-card"
import { useUser, useDisplayName } from "@/contexts/user-context"

export function DashboardHome() {
  const { teamMember, isLoading: userLoading } = useUser()
  const displayName = useDisplayName()

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  // The Dashboard tab is now a single Triage panel: posting messages, and
  // surfacing debriefs / new meetings / daily briefings / accepted
  // proposals all happen in one feed. The standalone /triage child page
  // (previously its own nav entry) has been folded in here as the user
  // originally intended.
  return (
    <div className="w-full space-y-6">
      <ExpandableCard
        title={`Welcome back, ${displayName}`}
        description={
          teamMember?.title
            ? `${teamMember.title} at Motta Financial`
            : "Here's what's happening with your clients today."
        }
        defaultExpanded={true}
        collapsible={true}
        maximizable={false}
        className="bg-white shadow-sm border-gray-200 w-full"
        actions={
          <div className="text-right">
            <p className="text-sm text-gray-500">Today</p>
            <p className="text-base font-medium text-gray-900">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        }
      >
        <TriageFeed />
      </ExpandableCard>
    </div>
  )
}
