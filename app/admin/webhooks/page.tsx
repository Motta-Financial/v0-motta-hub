"use client"

/**
 * /admin/webhooks — Unified webhook integrations console.
 *
 * Single pane of glass for every external system that pushes data
 * into MOTTA HUB. Surfaces health + raw URLs + last-delivery info so
 * an admin can confirm at a glance that no integration is silently
 * failing. Each card links out to the deeper config page when one
 * exists (Karbon Sync, Jotform integration settings, etc.).
 *
 * Sources:
 *   - Karbon       → /api/karbon/webhooks (subscriptions + recent events)
 *   - Jotform      → /api/jotform/forms/[formId]/webhook-status (per form)
 *   - Calendly     → /api/calendly/diagnostics
 *   - Zoom         → /api/zoom/webhook (env-based + last-event log)
 *   - Ignition     → /api/ignition/webhook/[event] (env-based)
 *
 * The Karbon and Jotform sections reuse existing presentational
 * components (KarbonSyncAdminPage's stat cards / JotformStatusCard)
 * so this page stays a thin aggregator — adding a new integration
 * just means dropping in a new card.
 */

import useSWR from "swr"
import Link from "next/link"
import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { JotformStatusCard } from "@/components/intake/jotform-status-card"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowUpRight,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  FileText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Video,
  Webhook as WebhookIcon,
  Zap,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Form IDs are duplicated from the surfaces that own them — the
// constants live next to the page that renders the form so we keep
// this admin file decoupled from the runtime forms code.
const INTAKE_FORM_ID = "" // Defaults inside JotformStatusCard
const FEEDBACK_FORM_ID = "240915444941155"

export default function WebhookIntegrationsAdminPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-balance text-2xl font-semibold tracking-tight">
              Webhook Integrations
            </h1>
            <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
              Every external system that pushes data into MOTTA HUB lives here. Use the cards
              below to verify each subscription is registered, see recent delivery counts, and
              jump to the deeper config page when something needs attention.
            </p>
          </div>
        </header>

        {/* ─────────────── Karbon ─────────────── */}
        <KarbonCard />

        {/* ─────────────── Jotform forms ─────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Jotform forms
          </div>
          <p className="text-xs text-muted-foreground">
            Every embedded Jotform on mottafinancial.com posts new submissions to MOTTA HUB.
          </p>
          {/* JotformStatusCard already does its own polling + UI. We
              render two instances side-by-side for the two forms in
              production — Intake (default form ID baked into the
              endpoint) and Client Feedback. */}
          <div className="space-y-3">
            <JotformStatusCard />
            <JotformStatusCard formId={FEEDBACK_FORM_ID} />
          </div>
        </section>

        {/* ─────────────── Calendly ─────────────── */}
        <CalendlyCard />

        {/* ─────────────── Zoom ─────────────── */}
        <ZoomCard />

        {/* ─────────────── Ignition ─────────────── */}
        <IgnitionCard />
      </div>
    </DashboardLayout>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Karbon — quick summary card with deep-link to the full page
// ─────────────────────────────────────────────────────────────────────

function KarbonCard() {
  const { data, isLoading } = useSWR<{
    subscriptions: Array<{ status: string; failure_count: number; last_event_at: string | null }>
    recent_events: Array<{ status: string }>
  }>("/api/karbon/webhooks", fetcher, { refreshInterval: 120_000 })

  const subs = data?.subscriptions ?? []
  const events = data?.recent_events ?? []
  const active = subs.filter((s) => s.status === "active").length
  const failing = subs.filter((s) => s.status === "failing" || s.failure_count > 0).length
  const failedEvents = events.filter((e) => e.status === "failed").length
  const lastEvent =
    subs
      .map((s) => s.last_event_at)
      .filter((iso): iso is string => Boolean(iso))
      .sort()
      .reverse()[0] ?? null

  const tone: "ok" | "warn" | "err" =
    subs.length === 0 || failing > 0 ? "err" : failedEvents > 0 ? "warn" : "ok"

  return (
    <Card className={toneBorder(tone)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Karbon Live Sync</CardTitle>
            <ToneBadge tone={tone} okLabel="Healthy" />
          </div>
          <CardDescription className="mt-1">
            Practice-management webhooks for clients, work items, and contacts.
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1">
          <Link href="/admin/karbon-sync">
            Open
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Active subs" value={active} sub={`${subs.length} total`} />
            <Stat label="Failing subs" value={failing} sub={failing > 0 ? "needs re-subscribe" : "all healthy"} />
            <Stat label="Failed (recent)" value={failedEvents} sub={failedEvents > 0 ? "retry from console" : "no failures"} />
            <Stat
              label="Last event"
              value={lastEvent ? formatDistanceToNow(new Date(lastEvent), { addSuffix: true }) : "—"}
              monoValue={false}
            />
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Calendly
// ─────────────────────────────────────────────────────────────────────

type CalendlyDiagnostics = {
  webhook?: {
    registered: boolean
    target_url: string | null
    scope: string | null
    state: string | null
    last_event_at: string | null
  }
  events_24h?: number
  failed_24h?: number
  oauth_connected?: boolean
  error?: string
}

function CalendlyCard() {
  const { data, isLoading } = useSWR<CalendlyDiagnostics>(
    "/api/calendly/diagnostics",
    fetcher,
    { refreshInterval: 120_000 },
  )

  const registered = data?.webhook?.registered ?? false
  const failed = data?.failed_24h ?? 0
  const tone: "ok" | "warn" | "err" = !registered ? "err" : failed > 0 ? "warn" : "ok"

  return (
    <Card className={toneBorder(tone)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Calendly</CardTitle>
            <ToneBadge tone={tone} okLabel="Healthy" />
          </div>
          <CardDescription className="mt-1">
            Inbound discovery-call bookings and reschedule events.
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1">
          <Link href="/settings/calendly">
            Manage
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : data?.error ? (
          <p className="text-sm text-amber-700">
            Couldn&apos;t reach Calendly diagnostics: {data.error}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                label="Webhook"
                value={registered ? "Registered" : "Not registered"}
                monoValue={false}
              />
              <Stat
                label="OAuth"
                value={data?.oauth_connected ? "Connected" : "Not connected"}
                monoValue={false}
              />
              <Stat label="Events (24h)" value={data?.events_24h ?? 0} />
              <Stat label="Failed (24h)" value={failed} />
            </dl>
            {data?.webhook?.target_url && (
              <CopyRow label="Target URL" value={data.webhook.target_url} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Zoom
// ─────────────────────────────────────────────────────────────────────

function ZoomCard() {
  // The Zoom webhook lives at /api/zoom/webhook. There's no read-side
  // diagnostics endpoint yet, so we render a static "expected URL" +
  // a copy affordance and link to docs. A future improvement would be
  // to log inbound events into a `zoom_webhook_events` table and
  // surface counters here.
  const expectedUrl = useExpectedUrl("/api/zoom/webhook")

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <Video className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Zoom</CardTitle>
            <Badge variant="outline" className="text-xs">
              Receiver only
            </Badge>
          </div>
          <CardDescription className="mt-1">
            Recording-completed events used to attach Loom-equivalent recordings to Karbon
            work items.
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1">
          <a
            href="https://marketplace.zoom.us/develop/apps"
            target="_blank"
            rel="noopener noreferrer"
          >
            Manage in Zoom
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      </CardHeader>
      <CardContent>
        <CopyRow label="Webhook URL" value={expectedUrl} />
        <p className="mt-2 text-xs text-muted-foreground">
          Set this URL in your Zoom Marketplace app under <em>Feature → Event Subscriptions</em>.
          The receiver verifies the <code>ZOOM_WEBHOOK_SECRET_TOKEN</code> on every request.
        </p>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Ignition
// ─────────────────────────────────────────────────────────────────────

function IgnitionCard() {
  const expectedBase = useExpectedUrl("/api/ignition/webhook")

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Ignition</CardTitle>
            <Badge variant="outline" className="text-xs">
              Receiver only
            </Badge>
          </div>
          <CardDescription className="mt-1">
            Proposal lifecycle events (sent / accepted / signed / paid) flow into the Ignition
            admin queue.
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1">
          <Link href="/admin/ignition">
            Open queue
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <CopyRow
          label="Base webhook URL"
          value={expectedBase ? `${expectedBase}/{event}` : ""}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Replace <code>{"{event}"}</code> with each Ignition event slug (e.g.{" "}
          <code>proposal.signed</code>). Requests are authenticated with{" "}
          <code>IGNITION_WEBHOOK_SECRET</code>.
        </p>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  monoValue = true,
}: {
  label: string
  value: number | string
  sub?: string
  monoValue?: boolean
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          monoValue
            ? "font-mono text-base font-semibold tabular-nums text-foreground"
            : "text-sm font-medium text-foreground"
        }
      >
        {value}
      </div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

function ToneBadge({ tone, okLabel }: { tone: "ok" | "warn" | "err"; okLabel: string }) {
  if (tone === "err") {
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert className="h-3 w-3" />
        Needs attention
      </Badge>
    )
  }
  if (tone === "warn") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700">
        <ShieldAlert className="h-3 w-3" />
        Degraded
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
      <ShieldCheck className="h-3 w-3" />
      {okLabel}
    </Badge>
  )
}

function toneBorder(tone: "ok" | "warn" | "err"): string {
  if (tone === "err") return "border-destructive/40 bg-destructive/5"
  if (tone === "warn") return "border-amber-300/60 bg-amber-50/40"
  return ""
}

function CopyRow({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              /* ignore — non-secure context */
            }
          }}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  )
}

/**
 * Compute the production webhook URL on the client side. The server
 * doesn't have a single env var for this (preview vs production
 * deploy URLs differ) so we derive it from the current origin.
 * Returns "" during SSR to avoid a hydration mismatch.
 */
function useExpectedUrl(path: string): string {
  const [origin, setOrigin] = useState("")
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])
  return origin ? `${origin}${path}` : ""
}
