"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Users, CheckSquare, TrendingUp, Clock, Building2, ExternalLink, RefreshCw, Loader2 } from "lucide-react"
import { categorizeServiceLine, getServiceLineColor, type ServiceLine } from "@/lib/service-lines"
import Link from "next/link"

interface SupabaseWorkItem {
  id: string
  karbon_work_item_key: string
  title: string
  client_name: string | null
  karbon_client_key: string | null
  client_group_name: string | null
  status: string | null
  primary_status: string | null
  workflow_status: string | null
  work_type: string | null
  due_date: string | null
  assignee_name: string | null
  karbon_modified_at: string | null
  karbon_url: string | null
}

interface DerivedClient {
  clientName: string
  clientKey: string | null
  clientGroup: string | null
  workItemCount: number
  activeWorkItems: number
}

interface ServiceLineDashboardProps {
  serviceLine: ServiceLine
  title: string
  description: string
  serviceLineKeywords: string[]
  showAddClient?: boolean
  /**
   * When supplied, the dashboard switches to a strict Karbon work_type
   * filter and **skips** the keyword-based categorizer below. Use this for
   * service lines whose Karbon import populates a canonical work_type
   * prefix (e.g. "ACCT | " for all Accounting work) — it's far more
   * accurate than title heuristics, which both let non-ACCT items leak in
   * (because their titles happen to contain "BK", "PR", etc.) and miss
   * ACCT items whose titles don't match the keyword list.
   *
   * Pass the trailing space if you want to match the full "ACCT | " prefix
   * rather than every work_type that starts with "ACCT" (e.g. don't want
   * to accidentally include something like "ACCTPLUS").
   */
  workTypePrefix?: string
  /**
   * Strict allow-list of exact Karbon `work_type` values. Takes priority
   * over `workTypePrefix` when both are set — preferred when the caller
   * has a curated list of canonical work_types (e.g. the six
   * `ACCT | *` values from lib/accounting-work-types) and wants to make
   * sure no untriaged additions to the source can ever sneak in.
   */
  workTypes?: readonly string[]
}

export function ServiceLineDashboard({
  serviceLine,
  title,
  description,
  serviceLineKeywords,
  workTypePrefix,
  workTypes,
}: ServiceLineDashboardProps) {
  const [workItems, setWorkItems] = useState<SupabaseWorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Memoize the joined allow-list so the effect's dependency array is a
  // stable string instead of a fresh array reference on every render.
  const workTypesKey = useMemo(() => (workTypes ? workTypes.join(",") : ""), [workTypes])

  useEffect(() => {
    fetchData()
    // Re-fetch if the caller swaps either of the two work_type filters —
    // most callers pin the prop, so this rarely fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workTypePrefix, workTypesKey])

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      let response: Response
      if (workTypesKey) {
        // Strictest path: caller supplied an explicit allow-list of
        // exact Karbon work_type values. Filtered at the Postgres layer
        // via `IN (...)`, then `status=all` so the component can do its
        // own active/completed split for the KPI tiles.
        const url = `/api/supabase/work-items?workTypes=${encodeURIComponent(
          workTypesKey,
        )}&status=all`
        response = await fetch(url)
      } else if (workTypePrefix) {
        // Strict path: filter at the Postgres layer using Karbon's canonical
        // work_type column. We pass `status=all` so we get both active and
        // completed rows — the component already does its own
        // active/completed split downstream for KPI tiles.
        const url = `/api/supabase/work-items?workTypePrefix=${encodeURIComponent(
          workTypePrefix,
        )}&status=all`
        response = await fetch(url)
      } else {
        // Legacy path used by the Tax dashboard and home-page tabs that
        // still rely on title-keyword categorization. Pulls a wide slice
        // and lets the client filter.
        response = await fetch("/api/work-items?limit=5000")
      }

      if (!response.ok) {
        throw new Error("Failed to fetch work items")
      }

      const data = await response.json()
      // The two endpoints return the items under different keys
      // (`workItems` for the Supabase route, `work_items` for the legacy
      // route). Tolerate both so we don't have to fork the render path.
      setWorkItems(data.workItems || data.work_items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data")
    } finally {
      setLoading(false)
    }
  }

  // Filter work items by service line, excluding completed/cancelled.
  //
  // When `workTypePrefix` is set, the API has already filtered by
  // work_type for us, so the only client-side work left is dropping
  // completed/cancelled rows for the "active" KPI tiles. When it isn't,
  // we fall back to the title-keyword categorizer for legacy callers.
  const filteredWorkItems = useMemo(() => {
    return workItems.filter((item) => {
      const status = (item.status || item.primary_status || "").toLowerCase()
      if (
        status.includes("completed") ||
        status.includes("complete") ||
        status.includes("cancelled") ||
        status.includes("canceled")
      ) {
        return false
      }
      if (workTypesKey || workTypePrefix) return true
      const sl = categorizeServiceLine(item.title || "", item.client_name || "")
      return serviceLineKeywords.includes(sl)
    })
  }, [workItems, serviceLineKeywords, workTypePrefix, workTypesKey])

  const activeWorkItems = useMemo(() => {
    return filteredWorkItems.filter((item) => {
      const status = (item.status || item.primary_status || "").toLowerCase()
      return !status.includes("completed") && !status.includes("cancelled")
    })
  }, [filteredWorkItems])

  const recentWorkItems = useMemo(() => {
    return [...filteredWorkItems]
      .sort((a, b) => {
        const dateA = new Date(a.karbon_modified_at || 0).getTime()
        const dateB = new Date(b.karbon_modified_at || 0).getTime()
        return dateB - dateA
      })
      .slice(0, 5)
  }, [filteredWorkItems])

  // Derive client data from work items
  const clients = useMemo(() => {
    const map = new Map<string, DerivedClient>()
    filteredWorkItems.forEach((item) => {
      const name = item.client_name
      if (!name) return
      if (!map.has(name)) {
        map.set(name, {
          clientName: name,
          clientKey: item.karbon_client_key,
          clientGroup: item.client_group_name,
          workItemCount: 0,
          activeWorkItems: 0,
        })
      }
      const client = map.get(name)!
      client.workItemCount++
      const status = (item.status || item.primary_status || "").toLowerCase()
      if (!status.includes("completed") && !status.includes("cancelled")) {
        client.activeWorkItems++
      }
    })
    return Array.from(map.values())
  }, [filteredWorkItems])

  const activeClients = useMemo(() => clients.filter((c) => c.activeWorkItems > 0), [clients])

  const formatDate = (dateString?: string | null) => {
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
        <div className="flex items-center justify-center py-12 gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading dashboard...</p>
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
                <p className="text-3xl font-bold text-gray-900">{clients.length}</p>
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
                  key={item.karbon_work_item_key || item.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        {item.karbon_url ? (
                          <a
                            href={item.karbon_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                              {item.title}
                              <ExternalLink className="h-4 w-4 text-gray-400" />
                            </h3>
                          </a>
                        ) : (
                          <h3 className="font-semibold text-gray-900">{item.title}</h3>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                        {item.client_name && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-4 w-4" />
                            {item.client_name}
                          </span>
                        )}
                        {(item.status || item.primary_status) && (
                          <Badge variant="secondary" className="text-xs">
                            {item.status || item.primary_status}
                          </Badge>
                        )}
                        {item.due_date && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            Due: {formatDate(item.due_date)}
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
          {clients.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No clients found for this service line</p>
            </div>
          ) : (
            <div className="space-y-3">
              {clients
                .sort((a, b) => b.workItemCount - a.workItemCount)
                .slice(0, 5)
                .map((client) => (
                  <div
                    key={client.clientName}
                    className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                  >
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
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
