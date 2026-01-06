"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react"

interface OnboardingClient {
  id: string
  name: string
  status: string
  projectType: string
  phase: string
  notes: string
  dueDate?: string
}

export function AccountingOnboardingTracker() {
  const [clients, setClients] = useState<OnboardingClient[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)

  useEffect(() => {
    fetchOnboardingClients()
  }, [])

  const fetchOnboardingClients = async () => {
    try {
      const response = await fetch("/api/supabase/work-items?titleFilter=onboarding&status=active")

      if (!response.ok) {
        console.error("Failed to fetch onboarding clients")
        setClients([])
        return
      }

      const data = await response.json()

      // Map work items to onboarding client format
      const onboardingClients = data.workItems.map((item: any) => ({
        id: item.id,
        name: item.client_name || item.organization_name || "Unknown Client",
        status: item.status || "N/A",
        projectType: item.work_type || "Bookkeeping",
        phase: item.category || "Onboarding",
        notes: item.notes || "",
        dueDate: item.due_date,
      }))

      setClients(onboardingClients)
    } catch (error) {
      console.error("Error fetching onboarding clients:", error)
      setClients([])
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "accepted":
        return "bg-green-100 text-green-800 border-green-200"
      case "awaiting client":
        return "bg-yellow-100 text-yellow-800 border-yellow-200"
      case "draft":
        return "bg-blue-100 text-blue-800 border-blue-200"
      case "n/a":
        return "bg-red-100 text-red-800 border-red-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  const getPhaseColor = (phase: string) => {
    if (phase.includes("Discovery")) return "bg-green-50 text-green-700"
    if (phase.includes("Proposal") || phase.includes("Onboarding")) return "bg-orange-50 text-orange-700"
    return "bg-gray-50 text-gray-700"
  }

  const displayedClients = showAll ? clients : clients.slice(0, 5)

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Onboarding Clients</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading onboarding clients...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Onboarding Clients</CardTitle>
            <CardDescription>Clients in proposal and onboarding stages</CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="text-sm">
              {clients.length} clients
            </Badge>
            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent>
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No onboarding clients found</p>
          ) : (
            <>
              <div className="space-y-2">
                {displayedClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm truncate">{client.name}</p>
                        <Badge variant="outline" className="text-xs">
                          {client.projectType}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-xs ${getStatusColor(client.status)}`}>{client.status}</Badge>
                        <Badge variant="outline" className={`text-xs ${getPhaseColor(client.phase)}`}>
                          {client.phase}
                        </Badge>
                        {client.dueDate && (
                          <span className="text-xs text-muted-foreground">
                            Due: {new Date(client.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {client.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{client.notes}</p>}
                    </div>

                    <Button variant="ghost" size="sm" className="ml-2 shrink-0">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {clients.length > 5 && (
                <Button variant="outline" size="sm" onClick={() => setShowAll(!showAll)} className="w-full mt-4">
                  {showAll ? "Show Less" : `Show All (${clients.length - 5} more)`}
                </Button>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
