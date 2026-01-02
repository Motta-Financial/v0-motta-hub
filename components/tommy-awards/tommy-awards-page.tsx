"use client"

import type React from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trophy, Flame, Target, Users, Zap } from "lucide-react"
import { TommyLeaderboard } from "./tommy-leaderboard"
import { TommyVotingForm } from "./tommy-voting-form"
import { TommyRecentBallots } from "./tommy-recent-ballots"

export function TommyAwardsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 text-white">
        <div className="absolute inset-0 bg-[url('/placeholder.svg?height=400&width=800')] opacity-10" />
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-amber-500/20 rounded-xl backdrop-blur-sm">
              <Trophy className="h-8 w-8 text-amber-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Tommy Awards</h1>
              <p className="text-slate-300 mt-1">Weekly recognition for demonstrating championship characteristics</p>
            </div>
          </div>

          {/* Tom Brady Characteristics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <CharacteristicBadge icon={<Flame className="h-4 w-4" />} label="Leadership" />
            <CharacteristicBadge icon={<Target className="h-4 w-4" />} label="Excellence" />
            <CharacteristicBadge icon={<Users className="h-4 w-4" />} label="Teamwork" />
            <CharacteristicBadge icon={<Zap className="h-4 w-4" />} label="Dedication" />
          </div>
        </div>
      </div>

      {/* Points System Info */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Scoring System</CardTitle>
          <CardDescription>How points are awarded each week</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 px-3 py-1.5">
              1st Place: 3 Points
            </Badge>
            <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 px-3 py-1.5">
              2nd Place: 2 Points
            </Badge>
            <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200 px-3 py-1.5">
              3rd Place: 1 Point
            </Badge>
            <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 px-3 py-1.5">
              Honorable Mention: 0.5 Points
            </Badge>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 px-3 py-1.5">
              Partner Vote: 5 Points
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Voting Form */}
        <div>
          <TommyVotingForm />
        </div>

        {/* Right Column - Leaderboard & Recent */}
        <div className="space-y-8">
          <TommyLeaderboard />
          <TommyRecentBallots />
        </div>
      </div>
    </div>
  )
}

function CharacteristicBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 backdrop-blur-sm">
      <span className="text-amber-400">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  )
}
