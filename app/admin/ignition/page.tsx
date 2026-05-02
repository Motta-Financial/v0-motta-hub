"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  RefreshCw,
  Search,
  Webhook,
  Workflow,
} from "lucide-react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useToast } from "@/hooks/use-toast"
import { MatchPickerDialog } from "@/components/ignition/match-picker-dialog"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Each Ignition Zap event we support, in the order users should set them up.
// `path` becomes the URL slug: /api/ignition/webhook/<path>.
const ZAP_EVENTS: Array<{
  trigger: string
  path: string
  description: string
}> = [
  {
    trigger: "New Client",
    path: "client.created",
    description: "Fires when a new client is added in Ignition.",
  },
  {
    trigger: "Updated Client",
    path: "client.updated",
    description: "Fires when client details (email, address, etc.) change.",
  },
  {
    trigger: "Proposal Awaiting Acceptance",
    path: "proposal.awaiting_acceptance",
    description: "Fires the moment a proposal is sent to a client.",
  },
  {
    trigger: "Proposal Accepted",
    path: "proposal.accepted",
    description: "Fires when a client accepts a proposal — the most important trigger.",
  },
  {
    trigger: "Proposal Completed",
    path: "proposal.completed",
    description: "Fires when all services on a proposal have been delivered/billed.",
  },
  {
    trigger: "Service Accepted",
    path: "service.accepted",
    description: "Fires per-line-item — captures the individual services purchased.",
  },
  {
    trigger: "New Invoice",
    path: "invoice.created",
    description: "Fires when Ignition creates an invoice from an accepted proposal.",
  },
  {
    trigger: "Invoice Paid",
    path: "invoice.paid",
    description: "Fires when a client invoice is fully paid.",
  },
  {
    trigger: "New Payment",
    path: "payment.received",
    description: "Fires when a Stripe payment lands — captures fees, net, charge IDs.",
  },
  {
    trigger: "Failed Payment",
    path: "payment.failed",
    description: "Fires on declined/failed payment attempts so you can follow up.",
  },
]

type Stats = {
  totals: {
    clients: number
    matched: number
    unmatched: number
    proposals: number
    invoices: number
    payments: number
  }
  matchBreakdown: Array<{ method: string; count: number; avg_confidence: number }>
  recentEvents: Array<{
    event_type: string
    processing_status: string
    received_at: string
    processing_error: string | null
  }>
}

type UnmatchedClient = {
  ignition_client_id: string
  name: string
  email: string | null
  business_name: string | null
  proposal_count: number
  total_proposal_value: number
  top_match_kind: string | null
  top_match_id: string | null
  top_match_name: string | null
  top_match_email: string | null
  top_match_confidence: number | null
  top_match_method: string | null
}

export default function IgnitionAdminPage() {
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [pickerClient, setPickerClient] = useState<UnmatchedClient | null>(null)

  const { data: stats, isLoading: statsLoading, mutate: refetchStats } = useSWR<Stats>(
    "/api/ignition/stats",
    fetcher,
    { refreshInterval: 30_000 },
  )

  const {
    data: unmatchedData,
    isLoading: unmatchedLoading,
    mutate: refetchUnmatched,
  } = useSWR<{ clients: UnmatchedClient[] }>(
    `/api/ignition/clients/unmatched?search=${encodeURIComponent(search)}&limit=100`,
    fetcher,
    { refreshInterval: 30_000 },
  )

  const unmatched = unmatchedData?.clients ?? []

  const baseUrl = useMemo(() => {
    if (typeof window === "undefined") return ""
    return window.location.origin
  }, [])

  function copyText(text: string, label: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} copied`, description: text })
    })
  }

  // Match-rate derived stat — the headline number for "is the integration healthy?"
  const matchRate =
    stats && stats.totals.clients > 0
      ? Math.round((stats.totals.matched / stats.totals.clients) * 100)
      : null

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">Ignition Integration</h1>
            <p className="mt-1 text-sm text-stone-600">
              Real-time sync of Ignition proposals, clients, invoices, and payments via Zapier
              webhooks. Map Ignition clients to your Karbon contacts and organizations below.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchStats()
              refetchUnmatched()
              toast({ title: "Refreshed" })
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Clients synced"
            value={stats?.totals.clients ?? 0}
            sub={
              matchRate !== null
                ? `${stats?.totals.matched ?? 0} mapped (${matchRate}%)`
                : "Awaiting first sync"
            }
            tone={matchRate !== null && matchRate >= 80 ? "good" : matchRate !== null ? "warn" : "neutral"}
            loading={statsLoading}
          />
          <StatCard
            label="Proposals"
            value={stats?.totals.proposals ?? 0}
            sub="Across all statuses"
            tone="neutral"
            loading={statsLoading}
          />
          <StatCard
            label="Invoices"
            value={stats?.totals.invoices ?? 0}
            sub="Created + paid"
            tone="neutral"
            loading={statsLoading}
          />
          <StatCard
            label="Payments"
            value={stats?.totals.payments ?? 0}
            sub="Stripe events"
            tone="neutral"
            loading={statsLoading}
          />
        </div>

        <Tabs defaultValue="mapping" className="w-full">
          <TabsList>
            <TabsTrigger value="mapping">
              Client Mapping
              {stats && stats.totals.unmatched > 0 ? (
                <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800">
                  {stats.totals.unmatched}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="setup">Zapier Setup</TabsTrigger>
            <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          </TabsList>

          {/* === MAPPING TAB === */}
          <TabsContent value="mapping" className="mt-4 space-y-4">
            {stats && stats.totals.unmatched === 0 && stats.totals.clients > 0 ? (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle>All Ignition clients are mapped</AlertTitle>
                <AlertDescription>
                  Every Ignition client is linked to a Karbon contact or organization. New clients
                  will be auto-matched as they sync; anything ambiguous will appear here.
                </AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Unmatched clients</span>
                  <Badge variant="outline">{unmatched.length} shown</Badge>
                </CardTitle>
                <CardDescription>
                  Ignition clients that didn&apos;t auto-match a Karbon contact or organization.
                  Pick the correct match (or mark as &quot;no match&quot;) to link their proposals,
                  invoices, and payments to the right entity.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <Input
                    placeholder="Search by name, email, or business..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {unmatchedLoading ? (
                  <div className="rounded-md border border-stone-200 bg-stone-50 p-6 text-center text-sm text-stone-500">
                    Loading unmatched clients...
                  </div>
                ) : unmatched.length === 0 ? (
                  <div className="rounded-md border border-stone-200 bg-stone-50 p-6 text-center text-sm text-stone-500">
                    {search
                      ? `No unmatched clients match "${search}".`
                      : "No unmatched clients. As Ignition data syncs, anything that needs review will appear here."}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border border-stone-200">
                    <table className="min-w-full divide-y divide-stone-200 text-sm">
                      <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-600">
                        <tr>
                          <th className="px-3 py-2 font-medium">Client</th>
                          <th className="px-3 py-2 font-medium">Email</th>
                          <th className="px-3 py-2 font-medium text-right">Proposals</th>
                          <th className="px-3 py-2 font-medium">Suggested match</th>
                          <th className="px-3 py-2 font-medium" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200 bg-white">
                        {unmatched.map((c) => (
                          <tr key={c.ignition_client_id} className="hover:bg-stone-50/60">
                            <td className="px-3 py-2">
                              <div className="font-medium text-stone-900">{c.name || "(no name)"}</div>
                              {c.business_name && c.business_name !== c.name ? (
                                <div className="text-xs text-stone-500">{c.business_name}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-stone-700">
                              {c.email || <span className="text-stone-400">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-stone-700">
                              {c.proposal_count > 0 ? (
                                <>
                                  <div>{c.proposal_count}</div>
                                  <div className="text-xs text-stone-500">
                                    ${Number(c.total_proposal_value || 0).toLocaleString()}
                                  </div>
                                </>
                              ) : (
                                <span className="text-stone-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {c.top_match_name ? (
                                <div>
                                  <div className="text-stone-900">{c.top_match_name}</div>
                                  <div className="flex items-center gap-2 text-xs text-stone-500">
                                    <span>
                                      {c.top_match_kind} · {c.top_match_method}
                                    </span>
                                    <ConfidenceBadge value={c.top_match_confidence} />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs text-stone-400">No suggestions</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setPickerClient(c)}
                              >
                                Review
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Auto-match breakdown */}
            {stats && stats.matchBreakdown.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">How clients were matched</CardTitle>
                  <CardDescription>
                    Auto-matching uses email-exact (1.0 confidence), then business-name fuzzy
                    matching against organizations, then person-name fuzzy matching against contacts.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {stats.matchBreakdown.map((m) => (
                      <div
                        key={m.method}
                        className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2"
                      >
                        <div className="text-xs uppercase tracking-wide text-stone-500">
                          {m.method.replace(/_/g, " ")}
                        </div>
                        <div className="mt-0.5 text-lg font-semibold text-stone-900">{m.count}</div>
                        <div className="text-xs text-stone-500">
                          avg conf {Number(m.avg_confidence || 0).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          {/* === ZAPIER SETUP TAB === */}
          <TabsContent value="setup" className="mt-4 space-y-4">
            <Alert>
              <Workflow className="h-4 w-4" />
              <AlertTitle>One-time Zapier setup</AlertTitle>
              <AlertDescription>
                Ignition has no public REST API — Zapier is the only programmatic way to sync
                proposals and clients. Create one Zap per event below. They all share the same
                authentication header and target this app&apos;s webhook receiver.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Shared settings (used in every Zap)</CardTitle>
                <CardDescription>
                  Paste these into the Zapier &quot;Webhooks by Zapier&quot; → POST action.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <CopyRow
                  label="HTTP method"
                  value="POST"
                  onCopy={(v) => copyText(v, "Method")}
                />
                <CopyRow
                  label="Payload type"
                  value="JSON"
                  onCopy={(v) => copyText(v, "Payload type")}
                />
                <CopyRow
                  label="Header: Content-Type"
                  value="application/json"
                  onCopy={(v) => copyText(v, "Content-Type")}
                />
                <CopyRow
                  label="Header: x-ignition-secret"
                  value="(use your IGNITION_WEBHOOK_SECRET env var)"
                  onCopy={() =>
                    toast({
                      title: "Get your secret from project env",
                      description:
                        "Open Project Settings → Vars → IGNITION_WEBHOOK_SECRET and copy that value into Zapier.",
                    })
                  }
                  hint="Stored as IGNITION_WEBHOOK_SECRET. Never paste the actual value into chat or screenshots."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">One Zap per event</CardTitle>
                <CardDescription>
                  Each event below maps to a unique webhook URL. Click an event to expand the
                  step-by-step setup.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {ZAP_EVENTS.map((evt) => {
                  const url = `${baseUrl}/api/ignition/webhook/${evt.path}`
                  return (
                    <Collapsible key={evt.path}>
                      <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-left transition hover:bg-stone-50">
                        <div className="flex items-center gap-3">
                          <Webhook className="h-4 w-4 text-stone-500" />
                          <div>
                            <div className="text-sm font-medium text-stone-900">{evt.trigger}</div>
                            <div className="text-xs text-stone-500">{evt.description}</div>
                          </div>
                        </div>
                        <ChevronDown className="h-4 w-4 text-stone-400 transition group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-1 space-y-3 rounded-md border border-stone-200 bg-stone-50 p-3">
                          <CopyRow
                            label="Webhook URL"
                            value={url}
                            mono
                            onCopy={(v) => copyText(v, "Webhook URL")}
                          />
                          <ol className="ml-4 list-decimal space-y-1 text-sm text-stone-700">
                            <li>
                              In Zapier, create a Zap with trigger{" "}
                              <span className="font-medium">Ignition → {evt.trigger}</span>.
                            </li>
                            <li>
                              For the action, choose{" "}
                              <span className="font-medium">Webhooks by Zapier → POST</span>.
                            </li>
                            <li>Paste the Webhook URL above.</li>
                            <li>Set Payload Type to JSON.</li>
                            <li>
                              Add header{" "}
                              <code className="rounded bg-stone-200 px-1 text-xs">x-ignition-secret</code>{" "}
                              with your <code className="rounded bg-stone-200 px-1 text-xs">IGNITION_WEBHOOK_SECRET</code>.
                            </li>
                            <li>
                              In the Data section, map all fields from the Ignition trigger as raw
                              keys (no transformations). The receiver auto-detects nested keys.
                            </li>
                            <li>Test the Zap — a 200 response means it&apos;s wired correctly.</li>
                          </ol>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Why Zapier (and not a direct API)?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-stone-700">
                <p>
                  Ignition does not expose a public REST API. Their Zapier app exposes the full set
                  of triggers we need (proposals, clients, services, invoices, payments) and is the
                  only supported programmatic integration vector.
                </p>
                <p>
                  Because you&apos;re on Stripe Express (not Stripe Standard), platform-level Stripe
                  data is also unavailable. The <code className="rounded bg-stone-200 px-1 text-xs">payment.received</code> webhook from
                  Ignition gives us the equivalent record (charge ID, fees, net amount) without
                  needing platform access.
                </p>
                <p className="text-stone-500">
                  Reference:{" "}
                  <a
                    className="inline-flex items-center gap-1 text-stone-700 underline hover:text-stone-900"
                    href="https://zapier.com/apps/ignition/integrations"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ignition on Zapier <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* === ACTIVITY TAB === */}
          <TabsContent value="activity" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent webhook events</CardTitle>
                <CardDescription>
                  The last 50 events received from Zapier. Failed events are kept so you can
                  diagnose mapping or payload issues.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!stats || stats.recentEvents.length === 0 ? (
                  <div className="rounded-md border border-stone-200 bg-stone-50 p-6 text-center text-sm text-stone-500">
                    No webhook events yet. Once your first Zap fires, events will appear here.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border border-stone-200">
                    <table className="min-w-full divide-y divide-stone-200 text-sm">
                      <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-600">
                        <tr>
                          <th className="px-3 py-2 font-medium">Event</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Received</th>
                          <th className="px-3 py-2 font-medium">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200 bg-white">
                        {stats.recentEvents.map((e, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 font-mono text-xs text-stone-800">
                              {e.event_type}
                            </td>
                            <td className="px-3 py-2">
                              {e.processing_status === "processed" ? (
                                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                                  processed
                                </Badge>
                              ) : (
                                <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">
                                  {e.processing_status}
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 text-stone-600">
                              {new Date(e.received_at).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-xs text-rose-700">
                              {e.processing_error || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Mapping picker dialog. Dialog self-fetches the full client + ranked
          candidates from /api/ignition/clients/<id>/match, so we only need to
          hand it the ID. We keep the row object around (pickerClient) just
          to drive open/close state. */}
      <MatchPickerDialog
        ignitionClientId={pickerClient?.ignition_client_id ?? null}
        open={!!pickerClient}
        onOpenChange={(open) => {
          if (!open) setPickerClient(null)
        }}
        onApplied={() => {
          // After a successful mapping change, refetch both lists so the
          // unmatched count and stat cards stay in sync.
          refetchStats()
          refetchUnmatched()
          setPickerClient(null)
        }}
      />
    </DashboardLayout>
  )
}

// Compact stat card matching the karbon-sync admin page conventions.
function StatCard({
  label,
  value,
  sub,
  tone,
  loading,
}: {
  label: string
  value: number | string
  sub?: string
  tone: "good" | "warn" | "neutral"
  loading?: boolean
}) {
  const toneRing =
    tone === "good"
      ? "ring-emerald-200/60 bg-emerald-50/50"
      : tone === "warn"
        ? "ring-amber-200/60 bg-amber-50/50"
        : "ring-stone-200 bg-white"

  return (
    <div className={`rounded-lg p-3 ring-1 ${toneRing}`}>
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-900">
        {loading ? "—" : typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-stone-500">{sub}</div> : null}
    </div>
  )
}

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null
  const v = Number(value)
  const tone =
    v >= 0.9
      ? "bg-emerald-100 text-emerald-800"
      : v >= 0.6
        ? "bg-amber-100 text-amber-800"
        : "bg-stone-100 text-stone-700"
  return (
    <Badge variant="secondary" className={`text-[10px] ${tone}`}>
      {(v * 100).toFixed(0)}%
    </Badge>
  )
}

function CopyRow({
  label,
  value,
  mono,
  hint,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  hint?: string
  onCopy: (value: string) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-stone-500">{label}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onCopy(value)}>
          <Copy className="mr-1 h-3 w-3" />
          Copy
        </Button>
      </div>
      <div
        className={`mt-1 break-all rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1 flex items-start gap-1 text-xs text-stone-500">
          <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{hint}</span>
        </div>
      ) : null}
    </div>
  )
}
