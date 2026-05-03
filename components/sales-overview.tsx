"use client"

/**
 * Sales hub landing page (/sales)
 * ────────────────────────────────────────────────────────────────────────
 * High-level entry point that summarises the four sub-sections (Dashboard,
 * Proposals, Invoices, Services) and gives partners one-click access to
 * each. Uses the existing /api/sales/dashboard endpoint for the trailing-12
 * snapshot — no extra round-trips.
 */

import Link from "next/link"
import useSWR from "swr"
import {
  BarChart3,
  FileText,
  Receipt,
  Briefcase,
  ArrowRight,
  TrendingUp,
  Trophy,
  Hourglass,
  CircleDollarSign,
  Repeat,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function fmtMoney(n: number | null | undefined) {
  const v = Number(n) || 0
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v)
}

interface DashboardSummary {
  proposals: Array<{
    proposal_id: string
    status: string
    total_value: number
    annualized_recurring: number
  }>
}

export function SalesOverview() {
  const { data: dash } = useSWR<DashboardSummary>(
    `/api/sales/dashboard`,
    fetcher,
  )
  const { data: invoices } = useSWR<{
    stats: { totalAmount: number; totalPaid: number; totalOutstanding: number; total: number }
  }>(`/api/sales/invoices?page=1&pageSize=1`, fetcher)
  const { data: services } = useSWR<{
    stats: { totalServices: number; activeServices: number; acceptedRevenue: number }
  }>(`/api/sales/services`, fetcher)
  const { data: recurring } = useSWR<{
    totals: {
      mrr: number
      arr: number
      distinct_clients: number
    }
    departments: Array<{ department: string; mrr: number; client_count: number }>
  }>(`/api/sales/recurring-revenue`, fetcher)

  const proposals = dash?.proposals || []
  const totalProposals = proposals.length
  const wonProposals = proposals.filter(
    (p) => p.status === "accepted" || p.status === "completed",
  )
  const sentProposals = proposals.filter((p) => p.status === "sent")
  const wonValue = wonProposals.reduce((s, p) => s + (p.total_value || 0), 0)
  const pipelineValue = sentProposals.reduce((s, p) => s + (p.total_value || 0), 0)
  const arr = wonProposals.reduce((s, p) => s + (p.annualized_recurring || 0), 0)

  const sections = [
    {
      title: "Sales Dashboard",
      description:
        "Pipeline analytics, win rates, and geographic / service breakdowns over your filtered timeframe.",
      href: "/sales/dashboard",
      icon: BarChart3,
      tone: "blue",
      stats: dash
        ? [
            { label: "Trailing 12 mo", value: `${totalProposals.toLocaleString()} proposals` },
            { label: "Win rate", value: winRate(wonProposals.length, proposals.length) },
          ]
        : null,
    },
    {
      title: "Proposals",
      description:
        "Browse, filter, and search every Ignition proposal with sortable columns and status badges.",
      href: "/sales/proposals",
      icon: FileText,
      tone: "emerald",
      stats: dash
        ? [
            { label: "Won", value: fmtMoney(wonValue) },
            { label: "In flight", value: fmtMoney(pipelineValue) },
          ]
        : null,
    },
    {
      title: "Invoices",
      description:
        "Billed amounts, payments collected, and outstanding balances across all invoices.",
      href: "/sales/invoices",
      icon: Receipt,
      tone: "amber",
      stats: invoices
        ? [
            { label: "Total billed", value: fmtMoney(invoices.stats.totalAmount) },
            { label: "Outstanding", value: fmtMoney(invoices.stats.totalOutstanding) },
          ]
        : null,
    },
    {
      title: "Services",
      description:
        "Service catalog with usage counts, win rates, and revenue per offering.",
      href: "/sales/services",
      icon: Briefcase,
      tone: "stone",
      stats: services
        ? [
            {
              label: "Catalog",
              value: `${services.stats.totalServices.toLocaleString()} (${services.stats.activeServices} active)`,
            },
            { label: "Accepted revenue", value: fmtMoney(services.stats.acceptedRevenue) },
          ]
        : null,
    },
    {
      title: "Recurring Revenue",
      description:
        "Curated MRR for Accounting and Tax. Sourced from the partner-maintained CSV — Ignition one-time engagements are excluded.",
      href: "/sales/recurring-revenue",
      icon: Repeat,
      tone: "emerald",
      stats: recurring
        ? [
            { label: "Combined MRR", value: fmtMoney(recurring.totals.mrr) },
            {
              label: "Recurring clients",
              value: recurring.totals.distinct_clients.toLocaleString(),
            },
          ]
        : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">Sales</h1>
        <p className="text-sm text-muted-foreground">
          Everything pipeline, billing, and service-catalog related — pulled live from Ignition.
        </p>
      </div>

      {/* Headline KPIs across the trailing 12 months */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Won (12 mo)"
          value={dash ? fmtMoney(wonValue) : null}
          subtitle={dash ? `${wonProposals.length} deals` : undefined}
          icon={Trophy}
          tone="emerald"
        />
        <KpiCard
          label="Pipeline"
          value={dash ? fmtMoney(pipelineValue) : null}
          subtitle={dash ? `${sentProposals.length} sent` : undefined}
          icon={Hourglass}
          tone="amber"
        />
        <KpiCard
          label="ARR"
          value={dash ? fmtMoney(arr) : null}
          subtitle="annualized recurring"
          icon={TrendingUp}
          tone="blue"
        />
        <KpiCard
          label="Outstanding"
          value={invoices ? fmtMoney(invoices.stats.totalOutstanding) : null}
          subtitle="invoice balances"
          icon={CircleDollarSign}
          tone="rose"
        />
      </div>

      {/* Section tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="group">
            <Card className="h-full hover:border-stone-400 hover:shadow-sm transition-all">
              <CardContent className="p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "p-2 rounded-md shrink-0",
                        section.tone === "blue" && "bg-blue-100 text-blue-900",
                        section.tone === "emerald" && "bg-emerald-100 text-emerald-900",
                        section.tone === "amber" && "bg-amber-100 text-amber-900",
                        section.tone === "stone" && "bg-stone-100 text-stone-900",
                      )}
                    >
                      <section.icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-stone-900 text-base">
                        {section.title}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                        {section.description}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-stone-400 group-hover:text-stone-900 group-hover:translate-x-0.5 transition-all shrink-0 mt-2" />
                </div>

                {section.stats ? (
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t">
                    {section.stats.map((stat) => (
                      <div key={stat.label}>
                        <div className="text-xs uppercase text-muted-foreground tracking-wide">
                          {stat.label}
                        </div>
                        <div className="text-sm font-semibold tabular-nums">
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t">
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

function winRate(won: number, total: number): string {
  const lost = total - won
  if (won + lost === 0) return "—"
  // Use only decided deals (won + explicitly tracked statuses on the dashboard
  // already filter archived) so this number stays meaningful.
  const decided = total
  return `${Math.round((won / decided) * 100)}%`
}

function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tone,
}: {
  label: string
  value: string | null
  subtitle?: string
  icon: any
  tone: "stone" | "emerald" | "amber" | "rose" | "blue"
}) {
  const toneStyles: Record<string, string> = {
    stone: "text-stone-900 bg-stone-100",
    emerald: "text-emerald-900 bg-emerald-100",
    amber: "text-amber-900 bg-amber-100",
    rose: "text-rose-900 bg-rose-100",
    blue: "text-blue-900 bg-blue-100",
  }
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn("p-2 rounded-md", toneStyles[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </div>
          {value ? (
            <div className="text-xl font-semibold tabular-nums truncate">{value}</div>
          ) : (
            <Skeleton className="h-6 w-24 mt-1" />
          )}
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
