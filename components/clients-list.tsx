"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Search, Users, TrendingUp, CheckCircle, Clock, ArrowRight, Briefcase, AlertCircle } from "lucide-react"
import type { KarbonClient } from "@/lib/karbon-types"
import Link from "next/link"

export function ClientsList() {
  const [clients, setClients] = useState<KarbonClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("all")
  const [activeTab, setActiveTab] = useState<"active" | "prospects">("active")

  useEffect(() => {
    fetchClients()
  }, [])

  const fetchClients = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/karbon/clients")

      if (!response.ok) {
        throw new Error("Failed to fetch clients")
      }

      const data = await response.json()
      setClients(data.clients || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch clients")
    } finally {
      setLoading(false)
    }
  }

  // Filter clients by search query and service line
  const filteredClients = clients.filter((client) => {
    const matchesSearch =
      searchQuery === "" ||
      client.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.clientGroup?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesServiceLine = selectedServiceLine === "all" || client.serviceLinesUsed.includes(selectedServiceLine)

    return matchesSearch && matchesServiceLine
  })

  const sortedFilteredClients = [...filteredClients].sort((a, b) => {
    if (!a.lastActivity && !b.lastActivity) return a.clientName.localeCompare(b.clientName)
    if (!a.lastActivity) return 1
    if (!b.lastActivity) return -1
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  })

  // Get unique service lines
  const allServiceLines = Array.from(new Set(clients.flatMap((client) => client.serviceLinesUsed))).sort()

  // Calculate summary stats
  const totalClients = clients.length
  const activeClientsCount = clients.filter((c) => c.activeWorkItems > 0).length
  const totalWorkItems = clients.reduce((sum, c) => sum + c.workItemCount, 0)

  const activeClients = sortedFilteredClients.filter((client) => !client.isProspect)

  const prospectClients = sortedFilteredClients.filter((client) => client.isProspect)

  const displayedClients = activeTab === "active" ? activeClients : prospectClients

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
        </div>
        <div className="text-center py-12">
          <p className="text-gray-500">Loading clients...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
        </div>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-6">
            <p className="text-red-700">{error}</p>
            <Button onClick={fetchClients} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-600 mt-1">Manage and view all client information</p>
        </div>
        <Button onClick={fetchClients} variant="outline">
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Clients</p>
                <p className="text-3xl font-bold text-gray-900">{totalClients}</p>
              </div>
              <Users className="h-10 w-10 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Clients</p>
                <p className="text-3xl font-bold text-gray-900">{activeClientsCount}</p>
              </div>
              <TrendingUp className="h-10 w-10 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Work Items</p>
                <p className="text-3xl font-bold text-gray-900">{totalWorkItems}</p>
              </div>
              <CheckCircle className="h-10 w-10 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-white shadow-sm border-gray-200">
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search clients by name or group..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9"
              />
            </div>

            {/* Service Line Filter */}
            {allServiceLines.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={selectedServiceLine === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedServiceLine("all")}
                  className="h-7 text-xs"
                >
                  All Service Lines
                </Button>
                {allServiceLines.map((serviceLine) => (
                  <Button
                    key={serviceLine}
                    variant={selectedServiceLine === serviceLine ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedServiceLine(serviceLine)}
                    className="h-7 text-xs"
                  >
                    {serviceLine}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs for Active and Prospect clients */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab("active")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "active"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Active Clients ({activeClients.length})
        </button>
        <button
          onClick={() => setActiveTab("prospects")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "prospects"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Prospect Clients ({prospectClients.length})
        </button>
      </div>

      {/* Clients List */}
      <Card className="bg-white shadow-sm border-gray-200">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-gray-900">
            {activeTab === "active" ? "Active Clients" : "Prospect Clients"} ({displayedClients.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {displayedClients.length === 0 ? (
            <div className="text-center py-12">
              {activeTab === "active" ? (
                <>
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No active clients found matching your filters</p>
                </>
              ) : (
                <>
                  <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No prospect clients found matching your filters</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {displayedClients.map((client) => (
                <Link key={client.clientKey} href={`/clients/${client.clientKey}`} className="block">
                  <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <Avatar className="h-10 w-10">
                          {client.avatarUrl && (
                            <AvatarImage src={client.avatarUrl || "/placeholder.svg"} alt={client.clientName} />
                          )}
                          <AvatarFallback
                            className={`${
                              activeTab === "active" ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"
                            } text-sm font-semibold`}
                          >
                            {client.clientName
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-gray-900 truncate">{client.clientName}</h3>
                            {activeTab === "active" && client.activeWorkItems > 0 && (
                              <Badge variant="default" className="bg-green-100 text-green-700 text-xs">
                                Active
                              </Badge>
                            )}
                            {activeTab === "prospects" && (
                              <Badge variant="default" className="bg-yellow-100 text-yellow-700 text-xs">
                                Prospect
                              </Badge>
                            )}
                          </div>
                          {client.clientGroup && <p className="text-sm text-gray-500 mb-2">{client.clientGroup}</p>}
                          {client.relatedClients && client.relatedClients.length > 0 && (
                            <p className="text-xs text-blue-600 mb-2 flex items-center">
                              <Briefcase className="h-3 w-3 mr-1" />
                              {client.relatedClients.length} related{" "}
                              {client.relatedClients.length === 1 ? "client" : "clients"}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 mb-2">
                            {client.serviceLinesUsed.map((serviceLine) => (
                              <Badge key={serviceLine} variant="secondary" className="text-xs">
                                {serviceLine}
                              </Badge>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <CheckCircle className="h-4 w-4" />
                              {client.workItemCount} work items
                            </span>
                            {activeTab === "active" && (
                              <span className="flex items-center gap-1">
                                <TrendingUp className="h-4 w-4" />
                                {client.activeWorkItems} active
                              </span>
                            )}
                            {client.lastActivity && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {new Date(client.lastActivity).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="h-5 w-5 text-gray-400 flex-shrink-0 ml-4" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
