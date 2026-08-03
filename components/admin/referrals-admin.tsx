"use client"

import useSWR from "swr"
import { useState } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Inbox,
  Link2,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
} from "lucide-react"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

type DashData = {
  totals: Record<string, number>
  topReferrers: Array<{
    id: string
    name: string
    legacy_id: string | null
    state: string | null
    contact_referrals: number
    jotform_referrals: number
    total: number
  }>
  workQueue: Array<{
    id: string
    source: string
    match_status: string
    match_confidence: number | null
    raw_text: string | null
    legacy_id: string | null
    candidates: Array<{ id: string; name: string; score: number }> | null
    created_at: string
    referee: { kind: "contact" | "jotform"; id: string; name: string }
  }>
  dataQuality: {
    contacts_total: number
    contacts_missing_legacy_id: number
    contacts_missing_state: number
    contacts_missing_phone: number
    jotform_unlinked: number
  }
}

const fetcher = async (url: string): Promise<DashData> => {
  const r = await fetch(url, { cache: "no-store" })
  if (!r.ok) throw new Error(`Failed to load referrals (${r.status})`)
  return r.json()
}

const STATUS_LABEL: Record<string, string> = {
  matched_existing: "Matched",
  unmatched_not_in_hub: "Not in Hub",
  unmatched_ambiguous: "Ambiguous",
  unmatched_external: "External Source",
}

function fmtPct(n: number, total: number) {
  if (!total) return "0%"
  return `${Math.round((n / total) * 100)}%`
}

export function ReferralsAdmin() {
  const { data, isLoading, mutate } = useSWR<DashData>(
    "/api/admin/referrals",
    fetcher,
    { revalidateOnFocus: false },
  )
  const [query, setQuery] = useState("")

  const totals = data?.totals ?? {}
  const totalReferrals = Object.values(totals).reduce((a, b) => a + b, 0)
  const matched = totals.matched_existing ?? 0
  const notInHub = totals.unmatched_not_in_hub ?? 0
  const ambiguous = totals.unmatched_ambiguous ?? 0
  const external = totals.unmatched_external ?? 0
  const unresolved = notInHub + ambiguous + external

  const filteredQueue = (data?.workQueue ?? []).filter((r) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      r.raw_text?.toLowerCase().includes(q) ||
      r.legacy_id?.toLowerCase().includes(q) ||
      r.referee.name.toLowerCase().includes(q)
    )
  })

  const dq = data?.dataQuality

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Referrals
          </h1>
          <p className="text-sm text-muted-foreground">
            Top referrers, unresolved review queue, and data-quality flags.
            See <span className="font-mono text-xs">motta-hub-data-model.md §4</span> for the
            resolution state machine.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          className="gap-2"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Total Referrals"
          value={totalReferrals}
          tone="neutral"
          icon={<Link2 className="h-4 w-4" />}
        />
        <KpiCard
          label="Matched"
          value={matched}
          sub={fmtPct(matched, totalReferrals)}
          tone="ok"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <KpiCard
          label="Needs Review"
          value={unresolved}
          sub={fmtPct(unresolved, totalReferrals)}
          tone="warn"
          icon={<HelpCircle className="h-4 w-4" />}
        />
        <KpiCard
          label="External Sources"
          value={external}
          sub="Google, Yelp, etc."
          tone="muted"
          icon={<ExternalLink className="h-4 w-4" />}
        />
      </div>

      {/* ── Tabs: Top Referrers / Work Queue / Data Quality ──── */}
      <Tabs defaultValue="top">
        <TabsList>
          <TabsTrigger value="top" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Top Referrers
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-2">
            <Inbox className="h-4 w-4" />
            Work Queue
            {unresolved > 0 ? (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {unresolved}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="dq" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Data Quality
          </TabsTrigger>
        </TabsList>

        {/* ── Top Referrers ─────────────────────────────────── */}
        <TabsContent value="top" className="mt-4">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Referrer</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Legacy ID</th>
                  <th className="px-4 py-3 font-medium text-right">From Clients</th>
                  <th className="px-4 py-3 font-medium text-right">From Intake</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data?.topReferrers.length === 0 && !isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      No matched referrers yet.
                    </td>
                  </tr>
                ) : null}
                {data?.topReferrers.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <a
                        href={`/contacts/${p.id}`}
                        className="hover:underline"
                      >
                        {p.name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.state ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {p.legacy_id ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.contact_referrals}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.jotform_referrals}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {p.total}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/contacts/${p.id}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        {/* ── Work Queue ────────────────────────────────────── */}
        <TabsContent value="queue" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search raw text, legacy ID, or referee name..."
                className="pl-8"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {filteredQueue.length} unresolved
            </p>
          </div>

          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Referee</th>
                  <th className="px-4 py-3 font-medium">Referrer (raw)</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Candidates</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.length === 0 && !isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      Queue is clear.
                    </td>
                  </tr>
                ) : null}
                {filteredQueue.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 align-top hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <a
                        href={
                          r.referee.kind === "contact"
                            ? `/contacts/${r.referee.id}`
                            : `/sales/intake?id=${r.referee.id}`
                        }
                        className="font-medium hover:underline"
                      >
                        {r.referee.name}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        {r.referee.kind === "contact" ? "Contact" : "Intake submission"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.raw_text ? (
                        <span className="font-medium text-foreground">{r.raw_text}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {r.legacy_id ? (
                        <div className="font-mono text-xs text-muted-foreground">
                          {r.legacy_id}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.match_status} />
                      {r.match_confidence != null ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          conf {Math.round(r.match_confidence * 100)}%
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.source === "karbon_custom_field"
                        ? "Karbon"
                        : r.source === "jotform_intake"
                          ? "Jotform"
                          : r.source}
                    </td>
                    <td className="px-4 py-3">
                      {r.candidates && r.candidates.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {r.candidates.slice(0, 3).map((c) => (
                            <a
                              key={c.id}
                              href={`/contacts/${c.id}`}
                              className="inline-flex items-center gap-1 text-xs hover:underline"
                            >
                              <span>{c.name}</span>
                              <span className="text-muted-foreground">
                                ({Math.round(c.score * 100)}%)
                              </span>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        {/* ── Data Quality ──────────────────────────────────── */}
        <TabsContent value="dq" className="mt-4">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              These checks come straight from §6 of the data model spec — they
              flag the rows that block legacy-ID derivation or referrer
              resolution.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <DqRow
                label="Contacts missing legacy_motta_client_id"
                value={dq?.contacts_missing_legacy_id ?? 0}
                of={dq?.contacts_total}
                hint="Usually means missing state, last name, or phone."
              />
              <DqRow
                label="Contacts with no state"
                value={dq?.contacts_missing_state ?? 0}
                of={dq?.contacts_total}
              />
              <DqRow
                label="Contacts with no phone"
                value={dq?.contacts_missing_phone ?? 0}
                of={dq?.contacts_total}
              />
              <DqRow
                label="Jotform intakes not linked to a contact"
                value={dq?.jotform_unlinked ?? 0}
                hint="Backed by /sales/intake unlinked filter."
                href="/sales/intake?filter=unlinked"
              />
            </dl>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ── small subcomponents ────────────────────────────────────── */

function KpiCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string
  value: number
  sub?: string
  icon: React.ReactNode
  tone: "ok" | "warn" | "muted" | "neutral"
}) {
  const toneCls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "muted"
          ? "border-muted bg-muted/40 text-muted-foreground"
          : "border-border bg-background text-foreground"
  return (
    <Card className="p-4">
      <div
        className={cn(
          "mb-3 inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium",
          toneCls,
        )}
      >
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {value.toLocaleString()}
      </div>
      {sub ? (
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      ) : null}
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status
  if (status === "matched_existing")
    return (
      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
        {label}
      </Badge>
    )
  if (status === "unmatched_external")
    return (
      <Badge variant="secondary" className="bg-muted/60">
        {label}
      </Badge>
    )
  return (
    <Badge variant="secondary" className="bg-amber-50 text-amber-700">
      {label}
    </Badge>
  )
}

function DqRow({
  label,
  value,
  of,
  hint,
  href,
}: {
  label: string
  value: number
  of?: number
  hint?: string
  href?: string
}) {
  const inner = (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3 hover:bg-muted/30">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </div>
      <div className="text-right">
        <div className="text-lg font-semibold tabular-nums text-foreground">
          {value.toLocaleString()}
        </div>
        {of ? (
          <div className="text-xs text-muted-foreground">of {of.toLocaleString()}</div>
        ) : null}
      </div>
    </div>
  )
  if (href) return <a href={href}>{inner}</a>
  return inner
}
