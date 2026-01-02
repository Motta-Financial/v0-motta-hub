"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Webhook, Plus, Trash2, CheckCircle2, Loader2, AlertCircle, Copy, Play, Zap, ExternalLink } from "lucide-react"

const SUPABASE_EDGE_FUNCTION_URL = "https://gylupzxitoebhqjnvzuw.supabase.co/functions/v1/karbon-work-sync"

const WEBHOOK_TYPES = [
  {
    value: "Work",
    label: "Work Items",
    description: "All work item events: Created, Updated, StatusChanged, Deleted",
  },
  {
    value: "Contact",
    label: "Contacts",
    description: "Contact events: Updated, ClientTeamChanged",
  },
  {
    value: "Note",
    label: "Notes",
    description: "Note events: Created, Updated",
  },
]

const STORAGE_KEY = "karbon-webhook-subscriptions"

interface LocalSubscription {
  webhookType: string
  targetUrl: string
  createdAt: string
}

export function WebhookManagement() {
  const [subscriptions, setSubscriptions] = useState<LocalSubscription[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedWebhookType, setSelectedWebhookType] = useState("Work")
  const [customUrl, setCustomUrl] = useState("")

  const defaultWebhookUrl = SUPABASE_EDGE_FUNCTION_URL

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        setSubscriptions(JSON.parse(stored))
      } catch {
        // Invalid JSON, ignore
      }
    }
  }, [])

  const saveSubscriptions = (subs: LocalSubscription[]) => {
    setSubscriptions(subs)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs))
  }

  const createSubscription = async () => {
    try {
      setCreating(true)
      setError(null)

      const targetUrl = customUrl || defaultWebhookUrl

      const response = await fetch("/api/webhooks/karbon/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookType: selectedWebhookType,
          targetUrl,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        const newSub: LocalSubscription = {
          webhookType: selectedWebhookType,
          targetUrl,
          createdAt: new Date().toISOString(),
        }
        saveSubscriptions([...subscriptions.filter((s) => s.webhookType !== selectedWebhookType), newSub])

        setSuccess(`Successfully created webhook for ${selectedWebhookType}`)
        setDialogOpen(false)
        setCustomUrl("")
      } else {
        setError(data.error || "Failed to create subscription")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create subscription")
    } finally {
      setCreating(false)
    }
  }

  const deleteSubscription = async (webhookType: string) => {
    try {
      setDeleting(webhookType)
      setError(null)

      const response = await fetch("/api/webhooks/karbon/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookType }),
      })

      const data = await response.json()

      if (response.ok) {
        saveSubscriptions(subscriptions.filter((s) => s.webhookType !== webhookType))
        setSuccess("Subscription deleted successfully")
      } else {
        saveSubscriptions(subscriptions.filter((s) => s.webhookType !== webhookType))
        setSuccess("Subscription removed from tracking")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete subscription")
    } finally {
      setDeleting(null)
    }
  }

  const triggerManualSync = async () => {
    try {
      setSyncing(true)
      setError(null)

      const response = await fetch(SUPABASE_EDGE_FUNCTION_URL, {
        method: "GET",
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setSuccess(`Manual sync completed: ${data.synced || 0} synced, ${data.errors || 0} errors`)
      } else {
        setError(data.error || "Failed to sync work items")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync work items")
    } finally {
      setSyncing(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setSuccess("Copied to clipboard")
  }

  const getWebhookTypeBadgeColor = (webhookType: string) => {
    switch (webhookType) {
      case "Work":
        return "bg-blue-100 text-blue-800"
      case "Contact":
        return "bg-purple-100 text-purple-800"
      case "Note":
        return "bg-green-100 text-green-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  // Clear messages after 5 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [success])

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 10000)
      return () => clearTimeout(timer)
    }
  }, [error])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Karbon Webhooks</h1>
          <p className="text-muted-foreground mt-1">Manage webhook subscriptions to sync Karbon data in real-time</p>
        </div>
        <Button variant="outline" onClick={triggerManualSync} disabled={syncing}>
          <Play className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Manual Sync"}
        </Button>
      </div>

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800">Success</AlertTitle>
          <AlertDescription className="text-green-700">{success}</AlertDescription>
        </Alert>
      )}

      <Alert>
        <Zap className="h-4 w-4" />
        <AlertTitle>Powered by Supabase Edge Functions</AlertTitle>
        <AlertDescription>
          Webhook events are processed by a Supabase Edge Function for low-latency, globally distributed sync.
          Subscriptions are tracked locally since Karbon&apos;s API doesn&apos;t provide a list endpoint.
        </AlertDescription>
      </Alert>

      {/* Edge Function Endpoint Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Webhook className="h-5 w-5 text-blue-600" />
            Supabase Edge Function Endpoint
          </CardTitle>
          <CardDescription>This URL receives Karbon webhook events and syncs to your database</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg border">
            <code className="flex-1 text-sm font-mono text-muted-foreground break-all">
              {SUPABASE_EDGE_FUNCTION_URL}
            </code>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(SUPABASE_EDGE_FUNCTION_URL)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            GET requests trigger a manual sync. POST requests process Karbon webhook payloads.
          </p>
        </CardContent>
      </Card>

      {/* Subscriptions Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Registered Subscriptions</CardTitle>
          <CardDescription>
            {subscriptions.length} webhook subscription{subscriptions.length !== 1 ? "s" : ""} tracked
          </CardDescription>
          <CardAction>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Subscription
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Webhook Subscription</DialogTitle>
                  <DialogDescription>Register a new webhook with Karbon to receive real-time updates</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="webhookType">Webhook Type</Label>
                    <Select value={selectedWebhookType} onValueChange={setSelectedWebhookType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select webhook type" />
                      </SelectTrigger>
                      <SelectContent>
                        {WEBHOOK_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div className="flex flex-col">
                              <span>{type.label}</span>
                              <span className="text-xs text-muted-foreground">{type.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="targetUrl">Target URL (optional)</Label>
                    <Input
                      id="targetUrl"
                      placeholder={defaultWebhookUrl}
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave blank to use the Supabase Edge Function. Must use https://
                    </p>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createSubscription} disabled={creating}>
                    {creating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        Create Subscription
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardAction>
        </CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <div className="text-center py-8">
              <Webhook className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No webhooks registered</h3>
              <p className="text-muted-foreground mb-4">
                Create a webhook subscription to start receiving real-time updates from Karbon
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Subscription
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => (
                <div key={sub.webhookType} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-4">
                    <Badge className={getWebhookTypeBadgeColor(sub.webhookType)}>{sub.webhookType}</Badge>
                    <div>
                      <code className="text-xs font-mono text-muted-foreground">
                        {sub.targetUrl.length > 50 ? `${sub.targetUrl.slice(0, 50)}...` : sub.targetUrl}
                      </code>
                      <p className="text-xs text-muted-foreground mt-1">
                        Created {new Date(sub.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 mr-4">
                      <div className="w-2 h-2 bg-green-400 rounded-full" />
                      <span className="text-sm text-muted-foreground">Active</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => copyToClipboard(sub.targetUrl)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => deleteSubscription(sub.webhookType)}
                      disabled={deleting === sub.webhookType}
                    >
                      {deleting === sub.webhookType ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Setup Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Setup</CardTitle>
          <CardDescription>Register webhooks for common Karbon entities</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {WEBHOOK_TYPES.map((type) => {
              const isRegistered = subscriptions.some((s) => s.webhookType === type.value)

              return (
                <div
                  key={type.value}
                  className={`p-4 rounded-lg border ${isRegistered ? "bg-green-50 border-green-200" : "bg-muted border-border"}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Badge className={getWebhookTypeBadgeColor(type.value)}>{type.label}</Badge>
                    {isRegistered && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{type.description}</p>
                  {!isRegistered && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full bg-transparent"
                      onClick={() => {
                        setSelectedWebhookType(type.value)
                        setDialogOpen(true)
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Register
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Help Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Need Help?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            If webhook creation fails, your Karbon API application may need webhook permissions enabled. Contact Karbon
            support to request this configuration.
          </p>
          <Button variant="link" className="p-0 h-auto" asChild>
            <a href="https://developers.karbonhq.com" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" />
              Karbon Developer Documentation
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
