"use client"

import { useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, RefreshCw, Database, FileText, Users, Building2 } from "lucide-react"

interface DataAnalysis {
  totalWorkItems: number
  uniqueWorkTypes: string[]
  workTypeBreakdown: Record<string, number>
  uniquePrimaryStatuses: string[]
  statusBreakdown: Record<string, number>
  uniqueSecondaryStatuses: string[]
  uniqueWorkStatuses: string[]
  uniqueAssignees: string[]
  uniqueClients: string[]
  totalUniqueClients: number
  uniqueClientGroups: string[]
  totalUniqueClientGroups: number
  sampleRawItems: any[]
}

export default function KarbonDataPage() {
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<DataAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/karbon/work-items?debug=true")
      const data = await response.json()
      if (data.error) {
        setError(data.error)
      } else {
        setAnalysis(data.analysis)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data")
    } finally {
      setLoading(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Karbon Data Analysis</h1>
            <p className="text-sm text-muted-foreground">View the structure and contents of your Karbon work items</p>
          </div>
          <Button onClick={fetchData} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {loading ? "Fetching..." : "Fetch Latest Data"}
          </Button>
        </div>

        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-4">
              <p className="text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {analysis && (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3">
              <Card className="p-0">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-blue-600" />
                    <div>
                      <p className="text-xs text-muted-foreground">Total Work Items</p>
                      <p className="text-xl font-bold">{analysis.totalWorkItems.toLocaleString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="p-0">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-green-600" />
                    <div>
                      <p className="text-xs text-muted-foreground">Work Types</p>
                      <p className="text-xl font-bold">{analysis.uniqueWorkTypes.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="p-0">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-purple-600" />
                    <div>
                      <p className="text-xs text-muted-foreground">Unique Clients</p>
                      <p className="text-xl font-bold">{analysis.totalUniqueClients.toLocaleString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="p-0">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-orange-600" />
                    <div>
                      <p className="text-xs text-muted-foreground">Client Groups</p>
                      <p className="text-xl font-bold">{analysis.totalUniqueClientGroups}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Work Types Breakdown */}
            <Card>
              <CardHeader className="py-3 pb-2">
                <CardTitle className="text-base">Work Types Breakdown</CardTitle>
                <CardDescription className="text-xs">
                  Distribution of work items by WorkType field from Karbon
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {Object.entries(analysis.workTypeBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                        <span className="font-medium truncate mr-2">{type}</span>
                        <Badge variant="secondary" className="text-xs">
                          {count}
                        </Badge>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Status Breakdown */}
            <Card>
              <CardHeader className="py-3 pb-2">
                <CardTitle className="text-base">Status Breakdown</CardTitle>
                <CardDescription className="text-xs">Distribution of work items by PrimaryStatus field</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {Object.entries(analysis.statusBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                        <span className="font-medium truncate mr-2">{status}</span>
                        <Badge variant="secondary" className="text-xs">
                          {count}
                        </Badge>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Unique Values */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="py-3 pb-2">
                  <CardTitle className="text-base">Assignees ({analysis.uniqueAssignees.length})</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1">
                    {analysis.uniqueAssignees.map((assignee) => (
                      <Badge key={assignee} variant="outline" className="text-xs">
                        {assignee}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 pb-2">
                  <CardTitle className="text-base">Client Groups ({analysis.totalUniqueClientGroups})</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1">
                    {analysis.uniqueClientGroups.map((group) => (
                      <Badge key={group} variant="outline" className="text-xs">
                        {group}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sample Raw Data */}
            <Card>
              <CardHeader className="py-3 pb-2">
                <CardTitle className="text-base">Sample Raw Work Item</CardTitle>
                <CardDescription className="text-xs">
                  First work item from Karbon API showing all available fields
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="bg-muted rounded p-3 overflow-auto max-h-96">
                  <pre className="text-xs">{JSON.stringify(analysis.sampleRawItems[0], null, 2)}</pre>
                </div>
              </CardContent>
            </Card>

            {/* Available Fields */}
            {analysis.sampleRawItems[0]?._availableFields && (
              <Card>
                <CardHeader className="py-3 pb-2">
                  <CardTitle className="text-base">
                    Available Fields ({analysis.sampleRawItems[0]._availableFields.length})
                  </CardTitle>
                  <CardDescription className="text-xs">All fields available on Karbon WorkItems</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1">
                    {analysis.sampleRawItems[0]._availableFields.map((field: string) => (
                      <Badge key={field} variant="secondary" className="text-xs font-mono">
                        {field}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {!analysis && !loading && !error && (
          <Card>
            <CardContent className="py-8 text-center">
              <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                Click "Fetch Latest Data" to pull and analyze your Karbon work items
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
