"use client"

import { useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Play, CheckCircle, XCircle, AlertCircle } from "lucide-react"

interface MigrationResult {
  message: string
  dryRun: boolean
  results: {
    total: number
    success: number
    failed: number
    errors: string[]
    samples: any[]
  }
}

export default function MigrateOrgsPage() {
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<any>(null)

  const runDryRun = async () => {
    setIsRunning(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/api/migrate/karbon-organizations?dryRun=true&limit=5")
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Migration failed")
      }

      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsRunning(false)
    }
  }

  const runFullMigration = async () => {
    if (!confirm("Are you sure you want to run the full migration? This will update all organizations in Supabase.")) {
      return
    }

    setIsRunning(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/api/migrate/karbon-organizations")
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Migration failed")
      }

      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsRunning(false)
    }
  }

  const testKarbonApi = async () => {
    setIsRunning(true)
    setTestResult(null)
    setError(null)

    try {
      // Test fetching a single org from Karbon
      const response = await fetch("/api/karbon/organizations?debug=true&limit=3")
      const data = await response.json()
      setTestResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Karbon Organizations Migration</h1>
          <p className="text-muted-foreground mt-2">Fetch organization details from Karbon API and update Supabase</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Test Karbon API</CardTitle>
              <CardDescription>Fetch sample data to verify API connection</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={testKarbonApi} disabled={isRunning}>
                {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Test API
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dry Run (5 orgs)</CardTitle>
              <CardDescription>Preview migration without making changes</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={runDryRun} disabled={isRunning} variant="outline">
                {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Dry Run
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Full Migration</CardTitle>
              <CardDescription>Update all organizations in Supabase</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={runFullMigration} disabled={isRunning} variant="default">
                {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run Migration
              </Button>
            </CardContent>
          </Card>
        </div>

        {error && (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <XCircle className="h-5 w-5" />
                Error
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm bg-muted p-4 rounded overflow-auto">{error}</pre>
            </CardContent>
          </Card>
        )}

        {testResult && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-blue-500" />
                Karbon API Test Result
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.results.failed === 0 ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-500" />
                )}
                Migration Results
                {result.dryRun && <Badge variant="outline">Dry Run</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-muted rounded">
                  <div className="text-2xl font-bold">{result.results.total}</div>
                  <div className="text-sm text-muted-foreground">Total</div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded">
                  <div className="text-2xl font-bold text-green-600">{result.results.success}</div>
                  <div className="text-sm text-muted-foreground">Success</div>
                </div>
                <div className="text-center p-4 bg-red-50 rounded">
                  <div className="text-2xl font-bold text-red-600">{result.results.failed}</div>
                  <div className="text-sm text-muted-foreground">Failed</div>
                </div>
              </div>

              {result.results.samples?.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Sample Data</h3>
                  <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
                    {JSON.stringify(result.results.samples, null, 2)}
                  </pre>
                </div>
              )}

              {result.results.errors?.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2 text-red-600">Errors ({result.results.errors.length})</h3>
                  <div className="max-h-48 overflow-auto">
                    {result.results.errors.slice(0, 10).map((err, i) => (
                      <div key={i} className="text-sm text-red-600 py-1">
                        {err}
                      </div>
                    ))}
                    {result.results.errors.length > 10 && (
                      <div className="text-sm text-muted-foreground">
                        ...and {result.results.errors.length - 10} more errors
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
