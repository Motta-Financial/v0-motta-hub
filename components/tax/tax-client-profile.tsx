"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  MapPin,
  Network,
  Phone,
  User,
  AlertCircle,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { KpiCard, FormBadge, EfileBadge, fmtMoney, fmtNumber } from "@/components/tax/tax-shared"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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
  hubLinkage: null
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

export function TaxClientProfile({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useSWR(
    `/api/tax/clients/${clientId}`,
    fetcher
  )
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-700" />
            <div>
              <div className="font-medium text-rose-900">Failed to load client profile</div>
              <div className="text-sm text-rose-700">{error.message}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const { client, engagements, summary, taxProfile, documents } = data
  const isSubEntity =
    client.proconnectEntityId &&
    client.topLevelEntityId &&
    client.proconnectEntityId !== client.topLevelEntityId

  return (
    <div className="p-6 space-y-6">
      {/* Back nav + Header */}
      <header className="space-y-4">
        <Link
          href="/tax/clients"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to All Clients
        </Link>

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "p-3 rounded-lg",
                client.clientType === "PERSON"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-violet-100 text-violet-700"
              )}
            >
              {client.clientType === "PERSON" ? (
                <User className="h-6 w-6" />
              ) : (
                <Building2 className="h-6 w-6" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {client.displayName || client.businessName || "Unnamed Client"}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    client.clientType === "PERSON"
                      ? "bg-blue-50 text-blue-900 border-blue-200"
                      : "bg-violet-50 text-violet-900 border-violet-200"
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
                      : "bg-stone-50 text-stone-700 border-stone-200"
                  )}
                >
                  {client.clientState || "Unknown"}
                </Badge>
                {isSubEntity && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className="text-xs bg-violet-50 text-violet-700 border-violet-200">
                          <Network className="h-3 w-3 mr-1" />
                          Sub-entity
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        This is a sub-entity of a parent ProConnect record
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>
          </div>

          {/* Hub linkage badges removed — /tax/* is ProConnect-only. */}
        </div>
      </header>

      {/* Contact Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-start gap-3">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Email</div>
              <div className="text-sm">{client.email || "—"}</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Phone</div>
              <div className="text-sm">{client.phone || "—"}</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Location</div>
              <div className="text-sm">
                {[client.address.city, client.address.state].filter(Boolean).join(", ") || "—"}
                {client.address.zip && (
                  <span className="text-muted-foreground ml-1">{client.address.zip}</span>
                )}
              </div>
            </div>
          </div>
          {client.taxId && (
            <div className="flex items-start gap-3">
              <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Tax ID</div>
                <div className="text-sm font-mono">{client.taxId}</div>
              </div>
            </div>
          )}
          <div className="flex items-start gap-3">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">ProConnect ID</div>
              <div className="text-sm font-mono text-muted-foreground">{client.proconnectClientId}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Returns"
          value={fmtNumber(summary.totalReturns)}
          subtitle={`${summary.years.length} tax year${summary.years.length !== 1 ? "s" : ""}`}
          icon={FileText}
          tone="stone"
        />
        <KpiCard
          label="Latest Year"
          value={summary.years[0]?.toString() || "—"}
          subtitle={summary.years[0] ? `${summary.byYear[summary.years[0]]} return${summary.byYear[summary.years[0]] !== 1 ? "s" : ""}` : ""}
          icon={Calendar}
          tone="blue"
        />
        <KpiCard
          label="E-filed"
          value={fmtNumber(
            Object.entries(summary.efileCounts)
              .filter(([k]) => /accept|complete|filed|transmit/i.test(k))
              .reduce((s, [, v]) => s + v, 0)
          )}
          subtitle={`${summary.efileCounts["(not filed)"] || 0} not filed`}
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="Preparers"
          value={fmtNumber(summary.preparers.length)}
          subtitle={summary.preparers.slice(0, 2).join(", ") || "None assigned"}
          icon={User}
          tone="stone"
        />
      </div>

      {/* Client-Return Relationship Summary */}
      <Card className="bg-gradient-to-r from-stone-50 to-stone-100 border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Tax Return Linkage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">ProConnect Client</div>
              <div className="font-medium">{client.displayName || client.businessName || "Unknown"}</div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">{client.proconnectClientId}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Tax Years on File</div>
              <div className="flex flex-wrap gap-1">
                {summary.years.slice(0, 6).map((year) => (
                  <Badge key={year} variant="outline" className="text-xs">
                    {year} ({summary.byYear[year]})
                  </Badge>
                ))}
                {summary.years.length > 6 && (
                  <Badge variant="outline" className="text-xs bg-stone-100">
                    +{summary.years.length - 6} more
                  </Badge>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Return Types</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(summary.formCounts)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 4)
                  .map(([form, count]) => (
                    <Badge key={form} variant="outline" className="text-xs">
                      {form}: {count}
                    </Badge>
                  ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Returns by Year - Expandable */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tax Returns by Year</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {summary.years.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No tax returns on file for this client.
            </div>
          ) : (
            summary.years.map((year) => {
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
                          {yearEngagements.length} return{yearEngagements.length !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {yearEngagements.map((eng) => (
                          <FormBadge key={eng.id} form={eng.return_type || "?"} />
                        ))}
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-7 mr-4 mb-4 space-y-3">
                      {yearEngagements.map((eng) => (
                        <ReturnCard key={eng.id} engagement={eng} clientId={clientId} />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Form breakdown */}
      {Object.keys(summary.formCounts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Returns by Form Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {Object.entries(summary.formCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([form, count]) => (
                  <div key={form} className="flex items-center gap-2">
                    <FormBadge form={form} />
                    <span className="text-sm font-medium">{count}</span>
                    <span className="text-xs text-muted-foreground">
                      ({((count / summary.totalReturns) * 100).toFixed(0)}%)
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Documents on File */}
      {documents && documents.length > 0 && (
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
                      <TableCell className="font-medium">{doc.taxYear}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {doc.documentType}
                          {doc.documentSubtype && ` (${doc.documentSubtype})`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {doc.issuerName || "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {doc.reportedAmount ? fmtMoney(doc.reportedAmount) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-xs",
                            doc.status === "verified" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                            doc.status === "entered" && "bg-blue-50 text-blue-700 border-blue-200",
                            doc.status === "received" && "bg-stone-50 text-stone-700 border-stone-200",
                            doc.status === "pending" && "bg-amber-50 text-amber-700 border-amber-200",
                            doc.status === "issue" && "bg-rose-50 text-rose-700 border-rose-200"
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
      )}

      {/* Client Identifiers - For Research/Debugging */}
      <Card className="border-stone-200 bg-stone-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-stone-600">Client Identifiers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">ProConnect Client ID</div>
              <div className="font-mono text-xs mt-1">{client.proconnectClientId}</div>
            </div>
            {client.proconnectEntityId && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Entity ID</div>
                <div className="font-mono text-xs mt-1">{client.proconnectEntityId}</div>
              </div>
            )}
            {client.topLevelEntityId && client.topLevelEntityId !== client.proconnectEntityId && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Top-Level Entity</div>
                <div className="font-mono text-xs mt-1">{client.topLevelEntityId}</div>
              </div>
            )}
            {client.taxId && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Tax ID (Last 4)</div>
                <div className="font-mono text-xs mt-1">***-**-{client.taxId.slice(-4)}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Individual return card with expand/view capabilities
function ReturnCard({
  engagement,
  clientId,
}: {
  engagement: TaxProfileResponse["engagements"][0]
  clientId: string
}) {
  const [expanded, setExpanded] = useState(false)

  const handleView1040 = () => {
    // Open 1040 viewer in new tab
    const url = `/tax/returns/${engagement.engagement_id}/1040?clientId=${clientId}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <Card className="border-stone-200">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <FormBadge form={engagement.return_type || "?"} />
              <span className="font-medium">
                {engagement.return_type || "Unknown"} - TY {engagement.tax_year}
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
                    style={{ backgroundColor: engagement.custom_status_color || "#a8a29e" }}
                  />
                  {engagement.custom_status_name}
                </span>
              )}
              {engagement.updated_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Updated {new Date(engagement.updated_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-stone-100">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {engagement.totalIncome != null && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Income</div>
                  <div className="text-sm font-medium">{fmtMoney(engagement.totalIncome)}</div>
                </div>
              )}
              {engagement.agi != null && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">AGI</div>
                  <div className="text-sm font-medium">{fmtMoney(engagement.agi)}</div>
                </div>
              )}
              {engagement.taxableIncome != null && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Taxable Income</div>
                  <div className="text-sm font-medium">{fmtMoney(engagement.taxableIncome)}</div>
                </div>
              )}
              {engagement.totalTax != null && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Tax</div>
                  <div className="text-sm font-medium">{fmtMoney(engagement.totalTax)}</div>
                </div>
              )}
              {engagement.refundAmount != null && engagement.refundAmount > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Refund</div>
                  <div className="text-sm font-medium text-emerald-700">{fmtMoney(engagement.refundAmount)}</div>
                </div>
              )}
              {engagement.amountOwed != null && engagement.amountOwed > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Amount Owed</div>
                  <div className="text-sm font-medium text-rose-700">{fmtMoney(engagement.amountOwed)}</div>
                </div>
              )}
            </div>

            <div className="mt-4 text-xs text-muted-foreground font-mono">
              Engagement ID: {engagement.engagement_id}
            </div>
          </div>
        )}
        </CardContent>
      </Card>
  )
}
