"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { RefreshCw, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react"

interface WorkStatus {
  id: string
  karbon_status_key: string
  name: string
  description: string | null
  is_active: boolean
  is_default_filter: boolean
  display_order: number | null
}

export function WorkStatusManager() {
  const [statuses, setStatuses] = useState<WorkStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{ synced: number; total: number } | null>(null)

  const fetchStatuses = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/karbon/work-statuses")
      if (!response.ok) throw new Error("Failed to fetch statuses")
      const data = await response.json()
      setStatuses(data.statuses || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load statuses")
    } finally {
      setLoading(false)
    }
  }

  const syncFromKarbon = async () => {
    try {
      setSyncing(true)
      setError(null)
      setSyncResult(null)
      const response = await fetch("/api/karbon/work-statuses?sync=true")
      if (!response.ok) throw new Error("Failed to sync from Karbon")
      const data = await response.json()
      setStatuses(data.statuses || [])
      setSyncResult({ synced: data.synced || 0, total: data.statuses?.length || 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync")
    } finally {
      setSyncing(false)
    }
  }

  const toggleFilter = async (statusKey: string, currentValue: boolean) => {
    try {
      setUpdating(statusKey)
      const response = await fetch("/api/karbon/work-statuses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          karbon_status_key: statusKey,
          is_default_filter: !currentValue,
        }),
      })
      if (!response.ok) throw new Error("Failed to update status")

      setStatuses((prev) =>
        prev.map((s) => (s.karbon_status_key === statusKey ? { ...s, is_default_filter: !currentValue } : s)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update")
    } finally {
      setUpdating(null)
    }
  }

  useEffect(() => {
    fetchStatuses()
  }, [])

  const includedCount = statuses.filter((s) => s.is_default_filter).length
  const excludedCount = statuses.filter((s) => !s.is_default_filter).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Work Statuses</h1>
          <p className="mt-2 text-gray-600">
            Manage Karbon work item statuses and configure which statuses count as "active" work items.
          </p>
        </div>
        <Button
          onClick={syncFromKarbon}
          disabled={syncing}
          style={{ backgroundColor: "#6B745D" }}
          className="text-white hover:opacity-90"
        >
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Sync from Karbon
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      )}

      {syncResult && (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          <CheckCircle2 className="h-5 w-5" />
          <span>
            Successfully synced {syncResult.synced} statuses from Karbon ({syncResult.total} total)
          </span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Total Statuses</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{statuses.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Included in Active Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{includedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Excluded from Active Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-400">{excludedCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status Configuration</CardTitle>
          <CardDescription>
            Toggle which statuses should be included when counting "active" work items in Motta Hub. Excluded statuses
            (like Completed, Cancelled, On Hold) won't appear in default work item counts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : statuses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No work statuses found. Sync from Karbon to populate the list.</p>
              <Button onClick={syncFromKarbon} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Now
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {statuses.map((status) => (
                <div
                  key={status.karbon_status_key}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {status.is_default_filter ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-gray-300" />
                    )}
                    <div>
                      <p className="font-medium">{status.name}</p>
                      {status.description && <p className="text-sm text-gray-500">{status.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant={status.is_default_filter ? "default" : "secondary"}>
                      {status.is_default_filter ? "Included" : "Excluded"}
                    </Badge>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id={`filter-${status.karbon_status_key}`}
                        checked={status.is_default_filter}
                        onCheckedChange={() => toggleFilter(status.karbon_status_key, status.is_default_filter)}
                        disabled={updating === status.karbon_status_key}
                      />
                      <Label htmlFor={`filter-${status.karbon_status_key}`} className="sr-only">
                        Include in active filter
                      </Label>
                    </div>
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
