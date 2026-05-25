"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Landmark,
  Link2,
  Mail,
  MapPin,
  Network,
  Phone,
  Receipt,
  TrendingUp,
  User,
  Wallet,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  KpiCard,
  FormBadge,
  EfileBadge,
  fmtMoney,
  fmtNumber,
} from "@/components/tax/tax-shared"
import { cn } from "@/lib/utils"
import { SensitiveValue } from "@/components/security/sensitive-value"
import { ClientRelationshipsCard } from "@/components/tax/client-relationships-card"
import { TaxFinancialTrendChart } from "@/components/tax/tax-financial-trend-chart"
import { TaxProfilePanel } from "@/components/tax/tax-profile-panel"

type TaxProfileResponse = {
  client: {
    id: string
    proconnectClientId: string
    proconnectEntityId: string | null
    topLevelEntityId: string | null
    clientType: "PERSON" | "ORGANIZATION"
    clientState: string | null
    displayName: string | null
    businessName: string | null
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
    address: { city: string | null; state: string | null; zip: string | null }
    taxId: string | null
    createdAt: string | null
    updatedAt: string | null
  }
  engagements: Array<{
    id: string
    engagement_id: string
    proconnect_client_id: string
    tax_year: number | null
    return_type: string | null
    form_type: string | null
    engagement_name: string | null
    engagement_state: string | null
    efile_status: string | null
    work_status: string | null
    custom_status_name: string | null
    custom_status_color: string | null
    preparer_name: string | null
    preparer_email: string | null
    created_at: string | null
    updated_at: string | null
    is1040: boolean
    totalIncome: number | null
    agi: number | null
    taxableIncome: number | null
    totalTax: number | null
    refundAmount: number | null
    amountOwed: number | null
    filingStatus: string | null
    hasScheduleC: boolean | null
    hasScheduleE: boolean | null
  }>
  summary: {
    totalReturns: number
    years: number[]
    byYear: Record<number, number>
    formCounts: Record<string, number>
    statusCounts: Record<string, number>
    efileCounts: Record<string, number>
    preparers: string[]
  }
  hubLinkage: {
    internalClientId: string
    karbonClientId: string | null
    ignitionClientId: string | null
    karbonUrl: string | null
    linkedSystems: string[]
  } | null
  taxProfile: {
    totalReturns: number
    taxYearsFiled: number[]
    firstYearFiled: number | null
    lastYearFiled: number | null
    consecutiveYears: number
    primaryFilingStatus: string | null
    primaryReturnType: string | null
    hasScheduleC: boolean
    hasScheduleE: boolean
    hasScheduleF: boolean
    hasForeignAccounts: boolean
    incomeTrend: Record<string, number>
    agiTrend: Record<string, number>
    taxTrend: Record<string, number>
    refundTrend: Record<string, number>
    latestTotalIncome: number | null
    latestAgi: number | null
    latestTaxableIncome: number | null
    latestTotalTax: number | null
    latestEffectiveRate: number | null
    latestRefundOrOwed: number | null
    primaryPreparerName: string | null
    preparerHistory: string[]
    profileCompleteness: number
    needsAttention: boolean
    attentionReasons: string[]
    aiSummary: string | null
    aiKeywords: string[]
  } | null
  documents: Array<{
    id: string
    taxYear: number
    documentType: string
    documentSubtype: string | null
    issuerName: string | null
    reportedAmount: number | null
    status: string
    fileName: string | null
    createdAt: string
  }>
}

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<TaxProfileResponse>
  })

/**
 * Tax Client Profile — now a "Financial Dashboard with a Tax Profile".
 *
 * The page is organized top-to-bottom the way a partner reviews a
 * client at the start of an engagement:
 *
 *   1. Identity strip      — name, type, hub linkage, return-to-list
 *   2. Financial Snapshot  — 4 KPI cards driven by the LATEST 1040
 *                            (income, AGI, total tax, refund/owed)
 *   3. Tax Profile panel   — filing status, schedules, attention flags,
 *                            ALFRED summary, completeness, YoY AGI delta
 *   4. Trend chart         — multi-year income/AGI/tax/refund area chart
 *   5. Tabbed detail       — Returns by year, Documents, Identifiers,
 *                            Relationships
 *
 * The data was already fully computed server-side in
 * /api/tax/clients/[clientId] — this rewrite mostly surfaces fields
 * that were previously hidden (taxProfile, agiTrend, attentionReasons,
 * aiSummary, etc.) and reorders the layout so the most decision-
 * relevant numbers are above the fold.
 */
export function TaxClientProfile({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useSWR(
    `/api/tax/clients/${clientId}`,
    fetcher,
  )
  const [activeTab, setActiveTab] = useState("returns")

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-700" />
            <div>
              <div className="font-medium text-rose-900">
                Failed to load client profile
              </div>
              <div className="text-sm text-rose-700">{error.message}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading || !data) {
    return <TaxClientProfileSkeleton />
  }

  const { client, engagements, summary, hubLinkage, taxProfile, documents } =
    data
  const isSubEntity =
    client.proconnectEntityId &&
    client.topLevelEntityId &&
    client.proconnectEntityId !== client.topLevelEntityId

  // Latest year refund/owed handling — both fields are positive numbers
  // server-side; we infer the sign for display.
  const latestRefund = taxProfile?.latestRefundOrOwed ?? null
  const refundPositive = latestRefund != null && latestRefund > 0

  return (
    <div className="p-6 space-y-6 pb-12">
      {/* ─── Back nav ─── */}
      <Link
        href="/tax/clients"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to All Clients
      </Link>

      {/* ─── Identity header ─── */}
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <div
            className={cn(
              "p-3 rounded-lg shrink-0",
              client.clientType === "PERSON"
                ? "bg-blue-100 text-blue-700"
                : "bg-violet-100 text-violet-700",
            )}
          >
            {client.clientType === "PERSON" ? (
              <User className="h-6 w-6" />
            ) : (
              <Building2 className="h-6 w-6" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              {client.displayName || client.businessName || "Unnamed Client"}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  client.clientType === "PERSON"
                    ? "bg-blue-50 text-blue-900 border-blue-200"
                    : "bg-violet-50 text-violet-900 border-violet-200",
                )}
              >
                {client.clientType === "PERSON" ? "Individual" : "Organization"}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  client.clientState === "ACTIVE"
                    ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                    : "bg-stone-50 text-stone-700 border-stone-200",
                )}
              >
                {client.clientState || "Unknown"}
              </Badge>
              {isSubEntity && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="text-xs bg-violet-50 text-violet-700 border-violet-200 gap-1"
                      >
                        <Network className="h-3 w-3" />
                        Sub-entity
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      Sub-entity of a parent ProConnect record
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {hubLinkage?.karbonUrl && (
                <a
                  href={hubLinkage.karbonUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs bg-stone-100 hover:bg-stone-200 px-2 py-0.5 rounded-md transition-colors"
                >
                  <Link2 className="h-3 w-3" />
                  Karbon
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {hubLinkage?.ignitionClientId && (
                <span className="inline-flex items-center gap-1 text-xs bg-stone-100 px-2 py-0.5 rounded-md">
                  <Link2 className="h-3 w-3" />
                  Ignition
                </span>
              )}
              {hubLinkage?.internalClientId && (
                <Link
                  href={`/clients/${hubLinkage.internalClientId}`}
                  className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-2 py-0.5 rounded-md transition-colors"
                >
                  <Link2 className="h-3 w-3" />
                  Hub Profile
                </Link>
              )}
            </div>

            {/* Inline contact rail */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
              {client.email && (
                <a
                  href={`mailto:${client.email}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Mail className="h-3 w-3" />
                  {client.email}
                </a>
              )}
              {client.phone && (
                <a
                  href={`tel:${client.phone}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Phone className="h-3 w-3" />
                  {client.phone}
                </a>
              )}
              {(client.address.city || client.address.state) && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {[client.address.city, client.address.state]
                    .filter(Boolean)
                    .join(", ")}
                  {client.address.zip ? ` ${client.address.zip}` : ""}
                </span>
              )}
              {client.taxId && (
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  TIN:{" "}
                  <SensitiveValue
                    value={client.taxId}
                    label="Tax ID"
                    buttonSize="sm"
                  />
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Financial Snapshot KPIs (latest year) ─── */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Financial Snapshot
          </h2>
          {taxProfile?.lastYearFiled && (
            <span className="text-xs text-muted-foreground">
              Latest filed: TY {taxProfile.lastYearFiled}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Total Income"
            value={fmtMoney(taxProfile?.latestTotalIncome ?? null)}
            subtitle={
              taxProfile?.lastYearFiled
                ? `TY ${taxProfile.lastYearFiled}`
                : "No filings"
            }
            icon={DollarSign}
            tone="stone"
          />
          <KpiCard
            label="AGI"
            value={fmtMoney(taxProfile?.latestAgi ?? null)}
            subtitle="Adjusted gross income"
            icon={Wallet}
            tone="blue"
          />
          <KpiCard
            label="Total Tax"
            value={fmtMoney(taxProfile?.latestTotalTax ?? null)}
            subtitle={
              taxProfile?.latestEffectiveRate != null
                ? `${(taxProfile.latestEffectiveRate * 100).toFixed(1)}% effective`
                : "Effective rate n/a"
            }
            icon={Landmark}
            tone="rose"
          />
          <KpiCard
            label={refundPositive ? "Refund" : "Amount Owed"}
            value={
              latestRefund != null ? fmtMoney(Math.abs(latestRefund)) : "—"
            }
            subtitle={refundPositive ? "Federal refund" : "Federal owed"}
            icon={refundPositive ? TrendingUp : Receipt}
            tone={refundPositive ? "emerald" : "amber"}
          />
        </div>
      </section>

      {/* ─── Tax Profile Panel (3-up) ─── */}
      {taxProfile && <TaxProfilePanel profile={taxProfile} />}

      {/* ─── Multi-year Trend Chart ─── */}
      {taxProfile && (
        <TaxFinancialTrendChart
          incomeTrend={taxProfile.incomeTrend}
          agiTrend={taxProfile.agiTrend}
          taxTrend={taxProfile.taxTrend}
          refundTrend={taxProfile.refundTrend}
        />
      )}

      {/* ─── Quick stats strip ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Returns"
          value={fmtNumber(summary.totalReturns)}
          subtitle={`${summary.years.length} tax year${summary.years.length !== 1 ? "s" : ""}`}
          icon={FileText}
          tone="stone"
        />
        <KpiCard
          label="E-filed"
          value={fmtNumber(
            Object.entries(summary.efileCounts)
              .filter(([k]) => /accept|complete|filed|transmit/i.test(k))
              .reduce((s, [, v]) => s + v, 0),
          )}
          subtitle={`${summary.efileCounts["(not filed)"] || 0} not filed`}
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="Consecutive"
          value={
            taxProfile
              ? `${taxProfile.consecutiveYears}y`
              : `${summary.years.length}y`
          }
          subtitle={
            taxProfile?.firstYearFiled
              ? `Since ${taxProfile.firstYearFiled}`
              : "Filing streak"
          }
          icon={Calendar}
          tone="blue"
        />
        <KpiCard
          label="Preparers"
          value={fmtNumber(summary.preparers.length)}
          subtitle={summary.preparers.slice(0, 2).join(", ") || "None assigned"}
          icon={User}
          tone="stone"
        />
      </div>

      {/* ─── Tabbed Detail ─── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="returns">
            Returns
            {summary.totalReturns > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
                {summary.totalReturns}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="documents">
            Documents
            {documents.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
                {documents.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="identifiers">IDs</TabsTrigger>
        </TabsList>

        <TabsContent value="returns" className="mt-4 space-y-4">
          <ReturnsByYear
            years={summary.years}
            byYearCount={summary.byYear}
            engagements={engagements}
            clientId={clientId}
          />
          {Object.keys(summary.formCounts).length > 0 && (
            <FormBreakdownCard
              formCounts={summary.formCounts}
              total={summary.totalReturns}
            />
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <DocumentsTable documents={documents} />
        </TabsContent>

        <TabsContent value="relationships" className="mt-4">
          <ClientRelationshipsCard clientId={clientId} />
        </TabsContent>

        <TabsContent value="identifiers" className="mt-4">
          <IdentifiersCard
            client={client}
            hubLinkage={hubLinkage}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Returns by year
// ─────────────────────────────────────────────────────────────────────

function ReturnsByYear({
  years,
  byYearCount,
  engagements,
  clientId,
}: {
  years: number[]
  byYearCount: Record<number, number>
  engagements: TaxProfileResponse["engagements"]
  clientId: string
}) {
  const [expandedYears, setExpandedYears] = useState<Set<number>>(
    () => new Set(years.slice(0, 1)), // expand most recent year by default
  )

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  if (years.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No tax returns on file for this client.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tax Returns by Year</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {years.map((year) => {
          const yearEngagements = engagements.filter((e) => e.tax_year === year)
          const isExpanded = expandedYears.has(year)
          return (
            <Collapsible
              key={year}
              open={isExpanded}
              onOpenChange={() => toggleYear(year)}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-between h-auto py-3 px-4 hover:bg-stone-50"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-lg font-semibold">{year}</span>
                    <Badge variant="outline" className="text-xs">
                      {byYearCount[year]} return
                      {byYearCount[year] !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {yearEngagements.map((eng) => (
                      <FormBadge
                        key={eng.id}
                        form={eng.return_type || "?"}
                      />
                    ))}
                  </div>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-7 mr-4 mb-4 space-y-3">
                  {yearEngagements.map((eng) => (
                    <ReturnCard
                      key={eng.id}
                      engagement={eng}
                      clientId={clientId}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </CardContent>
    </Card>
  )
}

function ReturnCard({
  engagement,
  clientId,
}: {
  engagement: TaxProfileResponse["engagements"][0]
  clientId: string
}) {
  const handleView1040 = () => {
    const url = `/tax/returns/${engagement.engagement_id}/1040?clientId=${clientId}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <Card className="border-stone-200">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FormBadge form={engagement.return_type || "?"} />
              <span className="font-medium">
                {engagement.return_type || "Unknown"} — TY {engagement.tax_year}
              </span>
              <EfileBadge status={engagement.efile_status} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {engagement.preparer_name && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {engagement.preparer_name}
                </span>
              )}
              {engagement.custom_status_name && (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        engagement.custom_status_color || "#a8a29e",
                    }}
                  />
                  {engagement.custom_status_name}
                </span>
              )}
              {engagement.updated_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Updated{" "}
                  {new Date(engagement.updated_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Inline financial summary — always visible since this is
                the financial dashboard story */}
            {(engagement.totalIncome != null ||
              engagement.agi != null ||
              engagement.totalTax != null ||
              engagement.refundAmount != null ||
              engagement.amountOwed != null) && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-stone-100">
                {engagement.totalIncome != null && (
                  <ReturnStat
                    label="Total Income"
                    value={fmtMoney(engagement.totalIncome)}
                  />
                )}
                {engagement.agi != null && (
                  <ReturnStat label="AGI" value={fmtMoney(engagement.agi)} />
                )}
                {engagement.totalTax != null && (
                  <ReturnStat
                    label="Total Tax"
                    value={fmtMoney(engagement.totalTax)}
                  />
                )}
                {engagement.refundAmount != null &&
                  engagement.refundAmount > 0 && (
                    <ReturnStat
                      label="Refund"
                      value={fmtMoney(engagement.refundAmount)}
                      tone="emerald"
                    />
                  )}
                {engagement.amountOwed != null &&
                  engagement.amountOwed > 0 && (
                    <ReturnStat
                      label="Amount Owed"
                      value={fmtMoney(engagement.amountOwed)}
                      tone="rose"
                    />
                  )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {engagement.is1040 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleView1040}
                className="gap-1.5"
              >
                <FileText className="h-4 w-4" />
                View 1040
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ReturnStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "emerald" | "rose"
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-medium tabular-nums",
          tone === "emerald" && "text-emerald-700",
          tone === "rose" && "text-rose-700",
        )}
      >
        {value}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Form breakdown
// ─────────────────────────────────────────────────────────────────────

function FormBreakdownCard({
  formCounts,
  total,
}: {
  formCounts: Record<string, number>
  total: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Returns by Form Type</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4">
          {Object.entries(formCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([form, count]) => (
              <div key={form} className="flex items-center gap-2">
                <FormBadge form={form} />
                <span className="text-sm font-medium tabular-nums">
                  {count}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({((count / total) * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────

function DocumentsTable({
  documents,
}: {
  documents: TaxProfileResponse["documents"]
}) {
  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No documents on file. Documents appear here once received from the
          client or imported from ProConnect.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Documents on File</span>
          <Badge variant="outline" className="text-xs">
            {documents.length} document{documents.length !== 1 ? "s" : ""}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Issuer</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium tabular-nums">
                    {doc.taxYear}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {doc.documentType}
                      {doc.documentSubtype && ` (${doc.documentSubtype})`}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {doc.issuerName || "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {doc.reportedAmount ? fmtMoney(doc.reportedAmount) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        doc.status === "verified" &&
                          "bg-emerald-50 text-emerald-700 border-emerald-200",
                        doc.status === "entered" &&
                          "bg-blue-50 text-blue-700 border-blue-200",
                        doc.status === "received" &&
                          "bg-stone-50 text-stone-700 border-stone-200",
                        doc.status === "pending" &&
                          "bg-amber-50 text-amber-700 border-amber-200",
                        doc.status === "issue" &&
                          "bg-rose-50 text-rose-700 border-rose-200",
                      )}
                    >
                      {doc.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Identifiers (debug / research)
// ─────────────────────────────────────────────────────────────────────

function IdentifiersCard({
  client,
  hubLinkage,
}: {
  client: TaxProfileResponse["client"]
  hubLinkage: TaxProfileResponse["hubLinkage"]
}) {
  return (
    <Card className="border-stone-200 bg-stone-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-stone-700">
          Client Identifiers
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Cross-system IDs for research, debugging, and ALFRED context.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <IdField
            label="ProConnect Client ID"
            value={client.proconnectClientId}
            mono
          />
          {client.proconnectEntityId && (
            <IdField
              label="Entity ID"
              value={client.proconnectEntityId}
              mono
            />
          )}
          {client.topLevelEntityId &&
            client.topLevelEntityId !== client.proconnectEntityId && (
              <IdField
                label="Top-Level Entity"
                value={client.topLevelEntityId}
                mono
              />
            )}
          {hubLinkage?.internalClientId && (
            <IdField
              label="Hub Contact ID"
              value={hubLinkage.internalClientId}
              mono
            />
          )}
          {hubLinkage?.karbonClientId && (
            <IdField
              label="Karbon Key"
              value={hubLinkage.karbonClientId}
              mono
            />
          )}
          {hubLinkage?.ignitionClientId && (
            <IdField
              label="Ignition Client ID"
              value={hubLinkage.ignitionClientId}
              mono
            />
          )}
          {client.taxId && (
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Tax ID
              </div>
              <div className="text-xs mt-1">
                <SensitiveValue
                  value={client.taxId}
                  label="Tax ID"
                  hiddenAs="last4"
                  className="text-xs"
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function IdField({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className={cn("text-xs mt-1", mono && "font-mono")}>{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────

function TaxClientProfileSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-4 w-32" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
      <Skeleton className="h-72" />
      <Skeleton className="h-64" />
    </div>
  )
}
