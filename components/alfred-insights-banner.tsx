"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X, TrendingUp, Users, AlertTriangle } from "lucide-react"
import Image from "next/image"

interface InsightProps {
  title: string
  description: string
  priority: "high" | "medium" | "low"
  action: string
  icon: React.ElementType
}

const insights: InsightProps[] = [
  {
    title: "Client Review Overdue",
    description: "Johnson Industries quarterly review is 3 days overdue",
    priority: "high",
    action: "Schedule Review",
    icon: AlertTriangle,
  },
  {
    title: "Workflow Optimization",
    description: "I found 2 automation opportunities that could save 4 hours/week",
    priority: "medium",
    action: "View Details",
    icon: TrendingUp,
  },
  {
    title: "Team Capacity",
    description: "Sarah has 15% more capacity this week for additional client work",
    priority: "low",
    action: "Assign Tasks",
    icon: Users,
  },
]

export function AlfredInsightsBanner() {
  const [dismissed, setDismissed] = useState<string[]>([])
  const [currentInsight, setCurrentInsight] = useState(0)

  const visibleInsights = insights.filter((_, index) => !dismissed.includes(index.toString()))

  if (visibleInsights.length === 0) return null

  const insight = visibleInsights[currentInsight % visibleInsights.length]
  const insightIndex = insights.indexOf(insight)

  const handleDismiss = () => {
    setDismissed([...dismissed, insightIndex.toString()])
    if (currentInsight >= visibleInsights.length - 1) {
      setCurrentInsight(0)
    }
  }

  const handleNext = () => {
    setCurrentInsight((prev) => (prev + 1) % visibleInsights.length)
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-red-100 text-red-700"
      case "medium":
        return "bg-yellow-100 text-yellow-700"
      case "low":
        return "bg-blue-100 text-blue-700"
      default:
        return "bg-gray-100 text-gray-700"
    }
  }

  return (
    <Card className="mb-6 border-l-4" style={{ borderLeftColor: "#6B745D", borderColor: "#8E9B79" }}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <div
              className="flex items-center justify-center w-10 h-10 rounded-lg"
              style={{ backgroundColor: "#EAE6E1" }}
            >
              <Image
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ALFRED%20Ai-vu0KAQ4ZR1fBs564bL8SLnRp5atDeW.png"
                alt="ALFRED AI"
                width={24}
                height={24}
                className="h-6 w-6"
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-sm" style={{ color: "#333333" }}>
                  ALFRED Insight
                </h3>
                <Badge className={`text-xs px-2 py-1 ${getPriorityColor(insight.priority)}`}>
                  {insight.priority.toUpperCase()}
                </Badge>
              </div>
              <h4 className="font-medium text-gray-900 mb-1">{insight.title}</h4>
              <p className="text-sm text-gray-600 mb-3">{insight.description}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" className="text-white text-xs" style={{ backgroundColor: "#6B745D" }}>
                  <insight.icon className="h-3 w-3 mr-1" />
                  {insight.action}
                </Button>
                {visibleInsights.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNext}
                    className="text-xs bg-transparent"
                    style={{ borderColor: "#8E9B79", color: "#333333" }}
                  >
                    Next Insight ({visibleInsights.length - 1} more)
                  </Button>
                )}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
