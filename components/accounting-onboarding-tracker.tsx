"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react"

interface OnboardingClient {
  name: string
  proposalCreated: boolean
  proposalAccepted: boolean
  status: string
  projectType: string
  phase: string
  notes: string
  expirationDate?: string
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
      // Mock data based on the spreadsheet images
      // In production, this would fetch from Karbon API filtered by onboarding status
      const mockClients: OnboardingClient[] = [
        {
          name: "Ola Loa Swim Academy",
          proposalCreated: true,
          proposalAccepted: true,
          status: "Accepted",
          projectType: "Bookkeeping",
          phase: "Phase 1: Discovery",
          notes: "Finalizing 2024 & 2025 YTD Financials",
        },
        {
          name: "Buffaloes Tires",
          proposalCreated: true,
          proposalAccepted: true,
          status: "Accepted",
          projectType: "Bookkeeping",
          phase: "Phase 1: Discovery",
          notes: "Working w/ P24 to Categorize 2025",
        },
        {
          name: "VerEstate Title",
          proposalCreated: true,
          proposalAccepted: true,
          status: "Accepted",
          projectType: "Payroll",
          phase: "Proposal Stage",
          notes: "On hold for payroll",
        },
        {
          name: "Cultivate Code",
          proposalCreated: false,
          proposalAccepted: false,
          status: "N/A",
          projectType: "Bookkeeping",
          phase: "Proposal Stage",
          notes: "Waiting on Caroline and Dat",
        },
        {
          name: "Melon Marketing",
          proposalCreated: false,
          proposalAccepted: false,
          status: "N/A",
          projectType: "Bookkeeping",
          phase: "Proposal Stage",
          notes: "Waiting on Caroline and Dat",
        },
        {
          name: "Giang Enterprise",
          proposalCreated: false,
          proposalAccepted: false,
          status: "Awaiting client",
          projectType: "Bookkeeping",
          phase: "Proposal Stage",
          notes: "Andrew To Follow Up",
          expirationDate: "10/3/2025",
        },
      ]

      setClients(mockClients)
    } catch (error) {
      console.error("Error fetching onboarding clients:", error)
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
    if (phase.includes("Proposal")) return "bg-orange-50 text-orange-700"
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
          <div className="space-y-2">
            {displayedClients.map((client, index) => (
              <div
                key={index}
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
                    {client.expirationDate && (
                      <span className="text-xs text-muted-foreground">Exp: {client.expirationDate}</span>
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
        </CardContent>
      )}
    </Card>
  )
}
