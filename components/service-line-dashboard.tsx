"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Users, CheckSquare, TrendingUp, Clock, Building2, ExternalLink, RefreshCw, AlertCircle } from "lucide-react"
import type { KarbonClient } from "@/lib/karbon-types"
import { getServiceLineColor, type ServiceLine } from "@/lib/service-lines"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"
import Link from "next/link"

interface WorkItem {
  WorkKey: string
  Title: string
  ServiceLine: string
  WorkStatus: string
  PrimaryStatus: string
  ClientName?: string
  ClientKey?: string
  DueDate?: string
  ModifiedDate?: string
}

interface ServiceLineDashboardProps {
  serviceLine: ServiceLine
  title: string
  description: string
  serviceLineKeywords: string[]
}

export function ServiceLineDashboard({
  serviceLine,
  title,
  description,
  serviceLineKeywords,
}: ServiceLineDashboardProps) {
  const [clients, setClients] = useState<KarbonClient[]>([])
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [credentialsMissing, setCredentialsMissing] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    setCredentialsMissing(false)

    try {
      const [clientsResponse, workItemsResponse] = await Promise.all([
        fetch("/api/karbon/clients"),
        fetch("/api/karbon/work-items"),
      ])

      if (clientsResponse.status === 401 || workItemsResponse.status === 401) {
        setCredentialsMissing(true)
        setClients([])
        setWorkItems([])
        setLoading(false)
        return
      }

      if (!clientsResponse.ok || !workItemsResponse.ok) {
        throw new Error("Failed to fetch data")
      }

      const clientsData = await clientsResponse.json()
      const workItemsData = await workItemsResponse.json()

      setClients(clientsData.clients || [])
      setWorkItems(workItemsData.workItems || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data")
    } finally {
      setLoading(false)
    }
  }

  const filteredClients = clients.filter((client) =>
    (client.serviceLinesUsed || []).some((sl) => serviceLineKeywords.includes(sl)),
  )

  const filteredWorkItems = workItems.filter((item) => serviceLineKeywords.includes(item.ServiceLine))

  const activeWorkItems = filteredWorkItems.filter((item) => {
    const status = item.PrimaryStatus?.toLowerCase() || ""
    return !status.includes("completed") && !status.includes("cancelled")
  })

  const recentWorkItems = [...filteredWorkItems]
    .sort((a, b) => {
      const dateA = new Date(a.ModifiedDate || 0).getTime()
      const dateB = new Date(b.ModifiedDate || 0).getTime()
      return dateB - dateA
    })
    .slice(0, 5)

  const activeClients = filteredClients.filter((client) => client.activeWorkItems > 0)

  const formatDate = (dateString?: string) => {
    if (!dateString) return null
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
            <p className="text-gray-600 mt-1">{description}</p>
          </div>
        </div>
        <div className="text-center py-12">
          <p className="text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (credentialsMissing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
            <p className="text-gray-600 mt-1">{description}</p>
          </div>
        </div>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-amber-900 mb-2">Karbon API Credentials Required</h3>
                <p className="text-amber-800 text-sm mb-4">
                  To view live data from Karbon, you need to configure your API credentials. Add the following
                  environment variables to your project:
                </p>
                <ul className="list-disc list-inside text-amber-800 text-sm space-y-1 mb-4">
                  <li>
                    <code className="bg-amber-100 px-1 py-0.5 rounded">KARBON_ACCESS_KEY</code>
                  </li>
                  <li>
                    <code className="bg-amber-100 px-1 py-0.5 rounded">KARBON_BEARER_TOKEN</code>
                  </li>
                </ul>
                <p className="text-amber-800 text-sm">Once configured, refresh the page to load your Karbon data.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card className="bg-white shadow-sm border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Clients</p>
                  <p className="text-3xl font-bold text-gray-400">-</p>
                </div>
                <Users className="h-10 w-10 text-gray-300" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Clients</p>
                  <p className="text-3xl font-bold text-gray-400">-</p>
                </div>
                <TrendingUp className="h-10 w-10 text-gray-300" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Work Items</p>
                  <p className="text-3xl font-bold text-gray-400">-</p>
                </div>
                <CheckSquare className="h-10 w-10 text-gray-300" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Work Items</p>
                  <p className="text-3xl font-bold text-gray-400">-</p>
                </div>
                <Clock className="h-10 w-10 text-gray-300" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
            <p className="text-gray-600 mt-1">{description}</p>
          </div>
        </div>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-6">
            <p className="text-red-700">{error}</p>
            <Button onClick={fetchData} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-600 mt-1">{description}</p>
        </div>
        <Button onClick={fetchData} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Clients</p>
                <p className="text-3xl font-bold text-gray-900">{filteredClients.length}</p>
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
                <p className="text-3xl font-bold text-gray-900">{activeClients.length}</p>
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
                <p className="text-3xl font-bold text-gray-900">{filteredWorkItems.length}</p>
              </div>
              <CheckSquare className="h-10 w-10 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Work Items</p>
                <p className="text-3xl font-bold text-gray-900">{activeWorkItems.length}</p>
              </div>
              <Clock className="h-10 w-10 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white shadow-sm border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-gray-900">Recent Work Items</CardTitle>
              <CardDescription>Latest activity in {title}</CardDescription>
            </div>
            <Link href="/work-items">
              <Button variant="outline" size="sm">
                View All
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recentWorkItems.length === 0 ? (
            <div className="text-center py-8">
              <CheckSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No work items found for this service line</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentWorkItems.map((item) => (
                <div
                  key={item.WorkKey}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <a
                          href={getKarbonWorkItemUrl(item.WorkKey)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                            {item.Title}
                            <ExternalLink className="h-4 w-4 text-gray-400" />
                          </h3>
                        </a>
                        <Badge variant="outline" className="text-xs font-mono">
                          {item.WorkKey}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                        {item.ClientName && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-4 w-4" />
                            {item.ClientName}
                          </span>
                        )}
                        {item.PrimaryStatus && (
                          <Badge variant="secondary" className="text-xs">
                            {item.PrimaryStatus}
                          </Badge>
                        )}
                        {item.DueDate && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            Due: {formatDate(item.DueDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white shadow-sm border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-gray-900">Top Clients</CardTitle>
              <CardDescription>Clients with the most work items</CardDescription>
            </div>
            <Link href="/clients">
              <Button variant="outline" size="sm">
                View All
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {filteredClients.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No clients found for this service line</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredClients
                .sort((a, b) => b.workItemCount - a.workItemCount)
                .slice(0, 5)
                .map((client) => (
                  <Link key={client.clientKey} href={`/clients/${client.clientKey}`} className="block">
                    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 truncate">{client.clientName}</h3>
                          {client.clientGroup && <p className="text-sm text-gray-500 mt-1">{client.clientGroup}</p>}
                          <div className="flex items-center gap-4 text-sm text-gray-500 mt-2">
                            <span className="flex items-center gap-1">
                              <CheckSquare className="h-4 w-4" />
                              {client.workItemCount} work items
                            </span>
                            {client.activeWorkItems > 0 && (
                              <span className="flex items-center gap-1">
                                <TrendingUp className="h-4 w-4" />
                                {client.activeWorkItems} active
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge className={getServiceLineColor(serviceLine)} variant="outline">
                          {serviceLine}
                        </Badge>
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
