"use client"

import { useState } from "react"
import useSWR from "swr"
import { Check, Copy, ExternalLink, ShieldAlert, ShieldCheck, Webhook } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * "Jotform Integration" status card on the /intake page.
 *
 * Surfaces just enough integration health for an admin to confirm,
 * at a glance, that:
 *   1. The Hub webhook is the only one registered on the form
 *      (no rogue n8n / Zapier / test endpoints)
 *   2. Real deliveries are landing — last success timestamp + 24h
 *      delivery counters
 *   3. The webhook URL is copyable so it can be re-pasted into
 *      Jotform's UI if anything ever changes there
 *
 * Data comes from `/api/jotform/intake/webhook-status`. Polled on
 * mount via SWR; revalidates on focus so flipping back to this tab
 * after submitting a test refreshes the counters.
 */

type Status = {
  form: {
    id: string
    title: string
    kind?: string
    status: string | null
    live_submission_count: number | null
    stored_submission_count: number
    last_synced_at: string | null
  }
  jotform_api: { ok: boolean; error: string | null }
  webhook: {
    expected_url: string | null
    hub_registered: boolean
    other_webhooks_count: number
    other_webhooks: string[]
    registered_webhooks: string[]
    list_error: string | null
  }
  deliveries: {
    events_24h: number
    failed_24h: number
    last_success_at: string | null
    last_failure_at: string | null
    last_failure_error: string | null
  }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function relativeTime(iso: string | null): string {
  if (!iso) return "never"
  const d = new Date(iso)
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`
  const days = Math.floor(ms / 86_400_000)
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Props:
 *   - `formId` — Jotform form ID. Defaults to the legacy intake form
 *      so existing call sites don't need to change. The /feedback
 *      page passes the feedback form's ID and gets the same UI
 *      pointed at its own status endpoint + webhook URL.
 */
export function JotformStatusCard({ formId }: { formId?: string } = {}) {
  // Backward compatibility: if no formId is passed, hit the original
  // intake-specific endpoint. Once a formId is provided we route to
  // the generic per-form endpoint.
  const endpoint = formId
    ? `/api/jotform/forms/${formId}/webhook-status`
    : "/api/jotform/intake/webhook-status"
  const { data, error, isLoading } = useSWR<Status>(endpoint, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  })
  const [copied, setCopied] = useState(false)

  const url = data?.webhook.expected_url ?? ""
  const handleCopy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // navigator.clipboard can fail in non-secure contexts; fail
      // silently — user can still triple-click + copy from the
      // visible URL field.
    }
  }

  if (isLoading || !data) {
    return (
      <Card className="border-border/60">
        <CardContent className="flex items-center gap-3 px-5 py-4">
          <div className="h-9 w-9 animate-pulse rounded-md bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 animate-pulse rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex items-center gap-3 px-5 py-4 text-sm text-destructive">
          <ShieldAlert className="h-5 w-5" />
          Couldn&apos;t reach the Jotform integration health endpoint.
        </CardContent>
      </Card>
    )
  }

  // Health derivation: green if webhook registered AND no failures
  // in 24h AND Jotform API responded; amber if registered but
  // failures present OR no deliveries yet; red if NOT registered or
  // there are rogue extra webhooks.
  const isHealthy =
    data.webhook.hub_registered &&
    data.webhook.other_webhooks_count === 0 &&
    data.deliveries.failed_24h === 0 &&
    data.jotform_api.ok
  const isDegraded =
    data.webhook.hub_registered &&
    (data.deliveries.failed_24h > 0 || data.webhook.other_webhooks_count > 0)
  const tone = !data.webhook.hub_registered
    ? "destructive"
    : isHealthy
      ? "healthy"
      : isDegraded
        ? "degraded"
        : "healthy"

  return (
    <Card
      className={cn(
        "overflow-hidden border-border/60",
        tone === "healthy" && "border-emerald-200/60",
        tone === "degraded" && "border-amber-300/60",
        tone === "destructive" && "border-destructive/40",
      )}
    >
      <CardContent className="space-y-4 px-5 py-4">
        {/* ─────────── Header row: title + status badge ─────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md",
                tone === "healthy" && "bg-emerald-50 text-emerald-600",
                tone === "degraded" && "bg-amber-50 text-amber-600",
                tone === "destructive" && "bg-destructive/10 text-destructive",
              )}
            >
              <Webhook className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-foreground">Jotform Integration</div>
              <div className="text-xs text-muted-foreground">
                {data.form.title} · Form ID {data.form.id}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tone === "healthy" && (
              <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-3 w-3" />
                Healthy
              </Badge>
            )}
            {tone === "degraded" && (
              <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700">
                <ShieldAlert className="h-3 w-3" />
                Needs attention
              </Badge>
            )}
            {tone === "destructive" && (
              <Badge variant="destructive" className="gap-1">
                <ShieldAlert className="h-3 w-3" />
                Webhook not registered
              </Badge>
            )}
          </div>
        </div>

        {/* ─────────── Counters ─────────── */}
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Stored in Hub</dt>
            <dd className="font-mono text-base font-semibold tabular-nums text-foreground">
              {data.form.stored_submission_count}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Live count (Jotform)</dt>
            <dd className="font-mono text-base font-semibold tabular-nums text-foreground">
              {data.form.live_submission_count ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Deliveries (24h)</dt>
            <dd
              className={cn(
                "font-mono text-base font-semibold tabular-nums",
                data.deliveries.failed_24h > 0 ? "text-amber-700" : "text-foreground",
              )}
            >
              {data.deliveries.events_24h}
              {data.deliveries.failed_24h > 0 && (
                <span className="ml-1 text-xs font-normal text-amber-700">
                  ({data.deliveries.failed_24h} failed)
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last delivery</dt>
            <dd className="text-sm font-medium text-foreground">
              {relativeTime(data.deliveries.last_success_at)}
            </dd>
          </div>
        </dl>

        {/* ─────────── Webhook URL row ─────────── */}
        <div>
          <div className="text-xs text-muted-foreground">Webhook URL registered with Jotform</div>
          <div className="mt-1 flex items-stretch gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-foreground">
              {url || "—"}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!url}
              className="gap-1"
              title="Copy webhook URL"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1">
              <a
                href={`https://www.jotform.com/build/${data.form.id}/settings/integrations/webhook`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open Jotform webhook settings"
              >
                <ExternalLink className="h-4 w-4" />
                Manage in Jotform
              </a>
            </Button>
          </div>
        </div>

        {/* ─────────── Warnings ─────────── */}
        {data.webhook.other_webhooks_count > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
            <strong className="font-semibold">Heads up:</strong> Jotform has{" "}
            {data.webhook.other_webhooks_count} other webhook
            {data.webhook.other_webhooks_count === 1 ? "" : "s"} registered alongside the Hub:
            <ul className="mt-1 list-disc pl-5">
              {data.webhook.other_webhooks.map((u) => (
                <li key={u} className="break-all font-mono">
                  {u}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.deliveries.last_failure_at && data.deliveries.failed_24h > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
            <strong className="font-semibold">Last failure</strong> {relativeTime(data.deliveries.last_failure_at)}
            {data.deliveries.last_failure_error ? `: ${data.deliveries.last_failure_error}` : ""}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
