"use client"

/**
 * Reporting Data tab on /admin/ignition.
 *
 * Surfaces the Ignition Reporting-API tables that don't have their own
 * dedicated UI: contacts, deals (by stage + recent), pipeline definitions,
 * payment transactions, and the disbursals archive. Without this tab those
 * tables get populated by the OAuth sync but stay invisible to users. The
 * disbursals card is a read-only view onto the frozen Zapier-era archive
 * — see its CardDescription for details.
 *
 * Data source: /api/ignition/reporting-overview (single GET, all sections
 * fetched in parallel server-side, capped at 25 recent rows each).
 */

import useSWR from "swr"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertTriangle, Users, Briefcase, Layers, Receipt, Banknote } from "lucide-react"

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j?.error || `HTTP ${r.status}`)
    }
    return r.json()
  })

interface ReportingOverview {
  contacts: {
    total: number
    recent: Array<{
      ignition_contact_id: string
      full_name: string | null
      email: string | null
      ignition_client_id: string | null
      created_at: string | null
    }>
  }
  deals: {
    total: number
    byStage: Array<{
      stage_id: string
      stage_name: string
      pipeline_name: string
      sort_order: number
      count: number
    }>
    recent: Array<{
      deal_id: string
      deal_name: string | null
      stage_name: string | null
      ignition_client_id: string | null
      value_amount: number | null
      currency: string | null
      status: string | null
      updated_at: string | null
    }>
  }
  dealStages: {
    total: number
    stages: Array<{
      stage_id: string
      name: string
      pipeline_name: string
      sort_order: number | null
    }>
  }
  paymentTransactions: {
    total: number
    recent: Array<{
      transaction_id: string
      transaction_type: string | null
      gross_amount: number | null
      fees: number | null
      net_amount: number | null
      currency: string | null
      payment_date: string | null
    }>
  }
  disbursals: {
    total: number
    recent: Array<{
      disbursal_id: string
      amount: number | null
      currency: string | null
      status: string | null
      disbursal_date: string | null
    }>
  }
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    // Bad currency code — fall back to plain formatting rather than crash.
    return `${(currency || "").toUpperCase()} ${amount.toFixed(2)}`
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

export function IgnitionReportingDataTab() {
  const { data, error, isLoading } = useSWR<ReportingOverview>(
    "/api/ignition/reporting-overview",
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 },
  )

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load Reporting data</AlertTitle>
        <AlertDescription className="font-mono text-xs">
          {error instanceof Error ? error.message : String(error)}
        </AlertDescription>
      </Alert>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>What is this tab?</AlertTitle>
        <AlertDescription>
          These tables are populated by the Ignition Reporting API backfill
          (Connection tab &rarr; Run backfill). They live in Supabase but
          don&apos;t have a dedicated UI elsewhere yet — this view confirms
          the data is being pulled in and gives you a quick look at the most
          recent rows for each resource.
        </AlertDescription>
      </Alert>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryTile
          icon={Users}
          label="Contacts"
          value={data.contacts.total}
          sub="Per-person records linked to clients"
        />
        <SummaryTile
          icon={Briefcase}
          label="Deals"
          value={data.deals.total}
          sub="Open + closed across all pipelines"
        />
        <SummaryTile
          icon={Layers}
          label="Pipeline stages"
          value={data.dealStages.total}
          sub="Defined in Ignition"
        />
        <SummaryTile
          icon={Receipt}
          label="Payment transactions"
          value={data.paymentTransactions.total}
          sub="From /reporting/collections"
        />
        <SummaryTile
          icon={Banknote}
          label="Disbursals"
          value={data.disbursals.total}
          sub="Payouts to your bank"
        />
      </div>

      {/* Deals: by-stage breakdown + recent */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deal pipeline</CardTitle>
          <CardDescription>
            Counts grouped by stage across every Ignition pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.deals.byStage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals synced yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Deals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deals.byStage.map((row) => (
                  <TableRow key={`${row.pipeline_name}-${row.stage_id || row.stage_name}`}>
                    <TableCell className="text-muted-foreground">{row.pipeline_name}</TableCell>
                    <TableCell className="font-medium">{row.stage_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent deals */}
      {data.deals.recent.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent deals</CardTitle>
            <CardDescription>
              Latest {data.deals.recent.length} deals by update time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deals.recent.map((d) => (
                  <TableRow key={d.deal_id}>
                    <TableCell className="font-medium">{d.deal_name || d.deal_id}</TableCell>
                    <TableCell className="text-muted-foreground">{d.stage_name || "—"}</TableCell>
                    <TableCell>
                      {d.status ? (
                        <Badge variant="outline" className="font-normal">
                          {d.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(d.value_amount, d.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(d.updated_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {/* Pipeline stage definitions */}
      {data.dealStages.stages.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline definitions</CardTitle>
            <CardDescription>
              Stages defined in Ignition, in display order.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Sort order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dealStages.stages.map((s) => (
                  <TableRow key={s.stage_id}>
                    <TableCell className="text-muted-foreground">{s.pipeline_name}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.sort_order ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {/* Recent contacts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
          <CardDescription>
            {data.contacts.total.toLocaleString()} contacts on file. Showing the
            {" "}
            {data.contacts.recent.length} most recent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.contacts.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts synced yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.contacts.recent.map((c) => (
                  <TableRow key={c.ignition_contact_id}>
                    <TableCell className="font-medium">{c.full_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {c.ignition_client_id || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(c.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Payment transactions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment transactions</CardTitle>
          <CardDescription>
            Individual transactions from /reporting/collections. Each row is a
            charge or refund (not a batched payout — see Disbursals for that).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.paymentTransactions.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions synced yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.paymentTransactions.recent.map((t) => (
                  <TableRow key={t.transaction_id}>
                    <TableCell>
                      {t.transaction_type ? (
                        <Badge variant="outline" className="font-normal">
                          {t.transaction_type}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.gross_amount, t.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(t.fees, t.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(t.net_amount, t.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.payment_date)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Disbursals (frozen archive) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Disbursals
            <Badge variant="outline" className="ml-2 font-normal">
              Historical archive
            </Badge>
          </CardTitle>
          <CardDescription>
            Batched payouts from Ignition to your bank account. This table is
            a frozen historical archive — it was populated by the retired
            Zapier bridge and the Reporting API has no equivalent endpoint.
            New payout data should be derived from the Payment Transactions
            card above (group by <code className="rounded bg-stone-200 px-1 text-xs">payment_date</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.disbursals.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No disbursals in the archive.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Disbursal</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.disbursals.recent.map((d) => (
                  <TableRow key={d.disbursal_id}>
                    <TableCell className="font-mono text-xs">{d.disbursal_id}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(d.amount, d.currency)}
                    </TableCell>
                    <TableCell>
                      {d.status ? (
                        <Badge variant="outline" className="font-normal">
                          {d.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(d.disbursal_date)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  sub: string
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
