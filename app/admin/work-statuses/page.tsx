"use client"

import { useState, useEffect } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Check, X, AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface WorkStatus {
  id: string
  karbon_status_key: string
  name: string
  description: string | null
  is_active: boolean
  is_default_filter: boolean
  display_order: number
}

export default function WorkStatusesPage() {
  const [statuses, setStatuses] = useState<WorkStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fetchStatuses = async (fromKarbon = false) => {
    try {
      setLoading(true)
      setError(null)

      const url = fromKarbon ? "/api/karbon/work-statuses?sync=true" : "/api/karbon/work-statuses?source=supabase"

      const response = await fetch(url)
      const data = await response.json()

      if (data.error) {
        setError(data.error)
        return
      }

      setStatuses(data.statuses || [])

      if (fromKarbon && data.synced) {
        setSuccessMessage(`Successfully synced ${data.count} work statuses from Karbon`)
        setTimeout(() => setSuccessMessage(null), 5000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch statuses")
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }

  const handleSyncFromKarbon = async () => {
    setSyncing(true)
    await fetchStatuses(true)
  }

  const handleToggleFilter = async (status: WorkStatus) => {
    try {
      const response = await fetch("/api/karbon/work-statuses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: status.id,
          is_default_filter: !status.is_default_filter,
        }),
      })

      const data = await response.json()

      if (data.error) {
        setError(data.error)
        return
      }

      // Update local state
      setStatuses((prev) =>
        prev.map((s) => (s.id === status.id ? { ...s, is_default_filter: !s.is_default_filter } : s)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status")
    }
  }

  useEffect(() => {
    fetchStatuses()
  }, [])

  const includedCount = statuses.filter((s) => s.is_default_filter).length
  const excludedCount = statuses.filter((s) => !s.is_default_filter).length

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Work Statuses</h1>
            <p className="text-muted-foreground">
              Manage which Karbon work statuses are included when counting active work items
            </p>
          </div>
          <Button onClick={handleSyncFromKarbon} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync from Karbon"}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {successMessage && (
          <Alert>
            <Check className="h-4 w-4" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Statuses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statuses.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Included in Active</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{includedCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Excluded from Active</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">{excludedCount}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Status Filter Configuration</CardTitle>
            <CardDescription>
              Toggle which statuses should be included when calculating active work items. Statuses marked as
              &quot;excluded&quot; will not be counted in the active work items total.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : statuses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No work statuses found. Click &quot;Sync from Karbon&quot; to fetch statuses.
              </div>
            ) : (
              <div className="space-y-2">
                {statuses.map((status) => (
                  <div
                    key={status.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Switch checked={status.is_default_filter} onCheckedChange={() => handleToggleFilter(status)} />
                      <div>
                        <div className="font-medium">{status.name}</div>
                        {status.description && (
                          <div className="text-sm text-muted-foreground">{status.description}</div>
                        )}
                      </div>
                    </div>
                    <Badge variant={status.is_default_filter ? "default" : "secondary"}>
                      {status.is_default_filter ? (
                        <>
                          <Check className="mr-1 h-3 w-3" /> Included
                        </>
                      ) : (
                        <>
                          <X className="mr-1 h-3 w-3" /> Excluded
                        </>
                      )}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
