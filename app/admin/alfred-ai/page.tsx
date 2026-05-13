"use client"

import { useState } from "react"
import useSWR, { useSWRConfig } from "swr"
import {
  Bot,
  RefreshCw,
  Settings,
  BarChart3,
  Check,
  X,
  Pencil,
  Save,
  ExternalLink,
  AlertCircle,
} from "lucide-react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AIConfig {
  useCase: string
  displayName: string
  description: string | null
  sourceLocation: string | null
  model: string
  systemPrompt: string | null
  isActive: boolean
  isModelOverridden: boolean
  isPromptOverridden: boolean
}

interface ModelOption {
  id: string
  label: string
  provider: "OpenAI" | "Anthropic"
}

interface UsageStats {
  summary: {
    totalRequests: number
    successfulRequests: number
    failedRequests: number
    successRate: number
    totalTokens: number
    avgLatencyMs: number
  }
  byUseCase: Array<{
    useCase: string
    displayName: string
    requests: number
    successRate: number
    totalTokens: number
    avgLatencyMs: number
  }>
  byModel: Array<{
    model: string
    requests: number
    successRate: number
    totalTokens: number
  }>
  recentActivity: Array<{
    id: string
    useCase: string
    model: string
    success: boolean
    totalTokens: number | null
    latencyMs: number | null
    errorMessage: string | null
    userEmail: string | null
    createdAt: string
  }>
  timeRange: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AlfredAISetupPage() {
  const { toast } = useToast()
  const { mutate: globalMutate } = useSWRConfig()
  const [refreshingAll, setRefreshingAll] = useState(false)

  async function handleRefreshAll() {
    setRefreshingAll(true)
    try {
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/api/admin/ai"),
        undefined,
        { revalidate: true }
      )
      toast({ title: "Refreshed", description: "Latest AI data loaded." })
    } catch (e) {
      toast({
        title: "Refresh failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setRefreshingAll(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">ALFRED AI Setup</h1>
            <p className="mt-1 text-sm text-stone-600">
              Configure AI models and prompts for each use case. All AI calls flow through
              the Vercel AI Gateway with zero-config OIDC authentication. Update models or
              prompts here without redeploying.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={refreshingAll}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshingAll ? "animate-spin" : ""}`}
            />
            {refreshingAll ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        <Tabs defaultValue="configuration" className="w-full">
          <TabsList>
            <TabsTrigger value="configuration" className="gap-2">
              <Settings className="h-4 w-4" />
              Configuration
            </TabsTrigger>
            <TabsTrigger value="usage" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Usage Stats
            </TabsTrigger>
          </TabsList>

          <TabsContent value="configuration" className="mt-4">
            <ConfigurationTab />
          </TabsContent>

          <TabsContent value="usage" className="mt-4">
            <UsageStatsTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Tab
// ─────────────────────────────────────────────────────────────────────────────

function ConfigurationTab() {
  const { data, isLoading, mutate } = useSWR<{
    configs: AIConfig[]
    models: ModelOption[]
  }>("/api/admin/ai/config", fetcher, { refreshInterval: 30_000 })

  const configs = data?.configs ?? []
  const models = data?.models ?? []

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Configurations</CardTitle>
          <CardDescription>Loading configurations...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-stone-500" />
            AI Use Cases
          </CardTitle>
          <CardDescription>
            Each row represents an AI-powered feature. Update the model or system prompt
            to change behavior without redeploying. Changes take effect within 60 seconds
            (memory cache TTL).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {configs.map((config) => (
              <ConfigRow
                key={config.useCase}
                config={config}
                models={models}
                onUpdate={() => mutate()}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Row Component
// ─────────────────────────────────────────────────────────────────────────────

function ConfigRow({
  config,
  models,
  onUpdate,
}: {
  config: AIConfig
  models: ModelOption[]
  onUpdate: () => void
}) {
  const { toast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editModel, setEditModel] = useState(config.model)
  const [editPrompt, setEditPrompt] = useState(config.systemPrompt ?? "")
  const [editActive, setEditActive] = useState(config.isActive)

  function handleEdit() {
    setEditModel(config.model)
    setEditPrompt(config.systemPrompt ?? "")
    setEditActive(config.isActive)
    setIsEditing(true)
  }

  function handleCancel() {
    setIsEditing(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/ai/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useCase: config.useCase,
          model: editModel,
          systemPrompt: editPrompt.trim() || null,
          isActive: editActive,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Save failed")
      }
      toast({ title: "Saved", description: `${config.displayName} updated.` })
      setIsEditing(false)
      onUpdate()
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const modelLabel =
    models.find((m) => m.id === config.model)?.label ?? config.model

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-stone-900">{config.displayName}</h3>
            {!config.isActive && (
              <Badge variant="secondary" className="bg-stone-100 text-stone-600">
                Disabled
              </Badge>
            )}
            {config.isModelOverridden && (
              <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                Custom Model
              </Badge>
            )}
            {config.isPromptOverridden && (
              <Badge variant="secondary" className="bg-purple-50 text-purple-700">
                Custom Prompt
              </Badge>
            )}
          </div>
          <p className="text-sm text-stone-600 mt-1">{config.description}</p>
          {config.sourceLocation && (
            <p className="text-xs text-stone-400 mt-1 font-mono">
              {config.sourceLocation}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <Button variant="outline" size="sm" onClick={handleEdit}>
              <Pencil className="mr-2 h-3 w-3" />
              Edit
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={saving}
              >
                <X className="mr-2 h-3 w-3" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-3 w-3" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-4 pt-2 border-t border-stone-100">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`model-${config.useCase}`}>Model</Label>
              <Select value={editModel} onValueChange={setEditModel}>
                <SelectTrigger id={`model-${config.useCase}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="flex items-center gap-2">
                        {m.label}
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {m.provider}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                id={`active-${config.useCase}`}
                checked={editActive}
                onCheckedChange={setEditActive}
              />
              <Label htmlFor={`active-${config.useCase}`}>
                {editActive ? "Active" : "Disabled"}
              </Label>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`prompt-${config.useCase}`}>
              System Prompt Override
            </Label>
            <Textarea
              id={`prompt-${config.useCase}`}
              placeholder="Leave empty to use the default hardcoded prompt..."
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              rows={6}
              className="font-mono text-sm"
            />
            <p className="text-xs text-stone-500">
              Leave empty to use the default prompt from the source code.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-stone-100 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-stone-500">Model:</span>
            <Badge variant="outline" className="font-mono text-xs">
              {modelLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-stone-500">Prompt:</span>
            <span className="text-stone-700">
              {config.isPromptOverridden ? (
                <span className="text-purple-700">Custom ({config.systemPrompt?.length} chars)</span>
              ) : (
                "Default"
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Stats Tab
// ─────────────────────────────────────────────────────────────────────────────

function UsageStatsTab() {
  const [timeRange, setTimeRange] = useState("7d")
  const { data, isLoading } = useSWR<UsageStats>(
    `/api/admin/ai/usage?range=${timeRange}`,
    fetcher,
    { refreshInterval: 60_000 }
  )

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage Statistics</CardTitle>
          <CardDescription>Loading usage data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Time range selector */}
      <div className="flex items-center gap-2">
        <Label>Time range:</Label>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Requests"
          value={data.summary.totalRequests.toLocaleString()}
          sub={`${data.summary.successRate.toFixed(1)}% success rate`}
          tone={data.summary.successRate >= 95 ? "good" : data.summary.successRate >= 80 ? "warn" : "bad"}
        />
        <StatCard
          label="Total Tokens"
          value={data.summary.totalTokens.toLocaleString()}
          sub="Input + output"
          tone="neutral"
        />
        <StatCard
          label="Avg Latency"
          value={`${Math.round(data.summary.avgLatencyMs)}ms`}
          sub="Response time"
          tone={data.summary.avgLatencyMs <= 2000 ? "good" : data.summary.avgLatencyMs <= 5000 ? "warn" : "bad"}
        />
        <StatCard
          label="Errors"
          value={data.summary.failedRequests.toLocaleString()}
          sub={`of ${data.summary.totalRequests} requests`}
          tone={data.summary.failedRequests === 0 ? "good" : "bad"}
        />
      </div>

      {/* Usage by use case */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage by Feature</CardTitle>
          <CardDescription>
            Breakdown of AI requests across different use cases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Success Rate</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Avg Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byUseCase.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-stone-500">
                    No usage data yet
                  </TableCell>
                </TableRow>
              ) : (
                data.byUseCase.map((row) => (
                  <TableRow key={row.useCase}>
                    <TableCell className="font-medium">{row.displayName}</TableCell>
                    <TableCell className="text-right">
                      {row.requests.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          row.successRate >= 95
                            ? "text-emerald-700"
                            : row.successRate >= 80
                            ? "text-amber-700"
                            : "text-rose-700"
                        }
                      >
                        {row.successRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.totalTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {Math.round(row.avgLatencyMs)}ms
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Usage by model */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage by Model</CardTitle>
          <CardDescription>
            Breakdown of AI requests across different models
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Success Rate</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byModel.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-stone-500">
                    No usage data yet
                  </TableCell>
                </TableRow>
              ) : (
                data.byModel.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell className="font-mono text-sm">{row.model}</TableCell>
                    <TableCell className="text-right">
                      {row.requests.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          row.successRate >= 95
                            ? "text-emerald-700"
                            : row.successRate >= 80
                            ? "text-amber-700"
                            : "text-rose-700"
                        }
                      >
                        {row.successRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.totalTokens.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <CardDescription>
            Last 50 AI requests
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Feature</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentActivity.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-stone-500">
                    No recent activity
                  </TableCell>
                </TableRow>
              ) : (
                data.recentActivity.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-stone-500">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{row.useCase}</TableCell>
                    <TableCell className="font-mono text-xs">{row.model}</TableCell>
                    <TableCell>
                      {row.success ? (
                        <Badge className="bg-emerald-100 text-emerald-800">
                          <Check className="mr-1 h-3 w-3" />
                          Success
                        </Badge>
                      ) : (
                        <Badge className="bg-rose-100 text-rose-800">
                          <AlertCircle className="mr-1 h-3 w-3" />
                          Error
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.totalTokens?.toLocaleString() ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.latencyMs ? `${row.latencyMs}ms` : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat Card Component (same pattern as Ignition admin)
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string | number
  sub?: string
  tone: "good" | "warn" | "bad" | "neutral"
}) {
  const toneColors = {
    good: "bg-emerald-50 border-emerald-200",
    warn: "bg-amber-50 border-amber-200",
    bad: "bg-rose-50 border-rose-200",
    neutral: "bg-stone-50 border-stone-200",
  }
  const valueColors = {
    good: "text-emerald-800",
    warn: "text-amber-800",
    bad: "text-rose-800",
    neutral: "text-stone-900",
  }

  return (
    <div className={`rounded-lg border p-4 ${toneColors[tone]}`}>
      <div className="text-xs font-medium text-stone-600">{label}</div>
      <div className={`text-2xl font-bold ${valueColors[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </div>
  )
}
