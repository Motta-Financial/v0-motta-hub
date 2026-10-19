"use client"

/**
 * Form 1065 viewer — /tax/returns/[returnId]/1065
 *
 * Lays out a partnership return's exported ProConnect entries by form
 * section (lib/forms/form-1065.ts via /api/forms/1065/[returnId]). Read-only:
 * edits go through the field viewer, which carries the write safeguards.
 *
 * Every total on this page is the Hub's sum of the entries, never
 * ProConnect's computed figure — the Export API does not return those for
 * the current year. Each total says what it includes and leaves out, and
 * the prior-year card shows ProConnect's own figures for comparison.
 */

import useSWR from "swr"
import Link from "next/link"
import { AlertCircle, Calendar, ExternalLink, FileText, Printer, Table2, User, Users } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtMoney } from "@/components/tax/tax-shared"
import { cn } from "@/lib/utils"
import type { AmountLine, Form1065Total, Form1065View, ScheduleLRow } from "@/lib/forms/form-1065"

type Response = {
  returnId: string
  returnName: string | null
  clientName: string | null
  taxYear: number
  exportedAt: string | null
  deletedAt: string | null
  catalog: { loaded: boolean; assumedFromTaxYear: number | null }
  view: Form1065View
}

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`)
  return r.json()
}

const pct = (n: number | null) => (n == null ? "—" : `${Number(n.toFixed(4))}%`)

function Notice({ tone = "amber", title, children }: { tone?: "amber" | "muted"; title: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border p-3 text-sm",
        tone === "amber"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          : "border-dashed text-muted-foreground",
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div>
        <p className="font-medium">{title}</p>
        {children && <div className="text-xs opacity-90">{children}</div>}
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="print:shadow-none print:border print:break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

function LineCode({ children }: { children: React.ReactNode }) {
  return <code className="text-[10px] text-muted-foreground">{children}</code>
}

function AmountLines({ lines, empty }: { lines: AmountLine[]; empty: string }) {
  if (lines.length === 0) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>
  return (
    <table className="w-full text-sm">
      <tbody>
        {lines.map((l) => (
          <LineRows key={l.code} line={l} />
        ))}
      </tbody>
    </table>
  )
}

function LineRows({ line }: { line: AmountLine }) {
  const counted = line.factor != null && line.factor !== 1 && line.factor !== -1 ? line.amount * line.factor : null
  return (
    <>
      <tr className="border-t align-top">
        <td className="w-12 py-1.5 pr-2 text-xs text-muted-foreground">{line.formLine ?? ""}</td>
        <td className="py-1.5 pr-3">
          <div>{line.label}</div>
          <div className="flex flex-wrap items-center gap-2">
            <LineCode>{line.code}</LineCode>
            {line.note && <span className="text-[11px] text-muted-foreground">{line.note}</span>}
          </div>
        </td>
        <td className="whitespace-nowrap py-1.5 text-right font-mono tabular-nums">
          {line.factor === -1 ? `(${fmtMoney(line.amount)})` : fmtMoney(line.amount)}
          {counted != null && (
            <div className="text-[11px] text-muted-foreground">counts {fmtMoney(counted)}</div>
          )}
        </td>
      </tr>
      {line.details.map((d) => (
        <tr key={`${line.code}-${d.suffix}`} className="text-xs text-muted-foreground">
          <td />
          <td className="py-0.5 pl-4 pr-3">
            {d.label ?? "Detail"} <LineCode>{d.suffix}</LineCode>
          </td>
          <td className="py-0.5 text-right font-mono tabular-nums">{fmtMoney(d.amount)}</td>
        </tr>
      ))}
    </>
  )
}

function TotalRow({ total }: { total: Form1065Total }) {
  return (
    <div className="mt-2 border-t-2 pt-2">
      <div className="flex items-baseline justify-between gap-3 text-sm font-semibold">
        <span>{total.label}</span>
        <span className="font-mono tabular-nums">{total.amount == null ? "—" : fmtMoney(total.amount)}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{total.basis}</p>
    </div>
  )
}

function ScheduleLTable({ rows, totalLabel, totals, title }: { rows: ScheduleLRow[]; totalLabel: string; totals: [number, number]; title: string }) {
  const money = (n: number | null, less: boolean) => (n == null ? "" : less ? `(${fmtMoney(n)})` : fmtMoney(n))
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="w-12 py-1 font-medium">Line</th>
          <th className="py-1 font-medium">{title}</th>
          <th className="py-1 text-right font-medium">Beginning</th>
          <th className="py-1 text-right font-medium">End of year</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.beginCode} className={cn("border-t", r.begin == null && r.end == null && "text-muted-foreground/70 print:hidden")}>
            <td className="py-1 text-xs text-muted-foreground">{r.formLine}</td>
            <td className="py-1 pr-3">
              {r.label}
              {r.fromDepreciation && (
                <span className="ml-1 text-xs text-muted-foreground" title="ProConnect computes the ending amount from the depreciation module">
                  *
                </span>
              )}{" "}
              <LineCode>
                {r.beginCode}/{r.endCode}
              </LineCode>
            </td>
            <td className="py-1 text-right font-mono tabular-nums">{money(r.begin, r.less)}</td>
            <td className="py-1 text-right font-mono tabular-nums">{money(r.end, r.less)}</td>
          </tr>
        ))}
        <tr className="border-t-2 font-semibold">
          <td />
          <td className="py-1.5">{totalLabel}</td>
          <td className="py-1.5 text-right font-mono tabular-nums">{fmtMoney(totals[0])}</td>
          <td className="py-1.5 text-right font-mono tabular-nums">{fmtMoney(totals[1])}</td>
        </tr>
      </tbody>
    </table>
  )
}

export function Form1065Viewer({ returnId, clientId }: { returnId: string; clientId?: string }) {
  const { data, error, isLoading } = useSWR<Response>(`/api/forms/1065/${returnId}`, fetcher)
  const fieldViewerHref = `/tax/returns/${returnId}${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`

  if (error) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Notice title="Could not load this Form 1065">
          <p>{error.message}</p>
          <Link href={fieldViewerHref} className="mt-2 inline-block underline">
            Open the field viewer instead
          </Link>
        </Notice>
      </div>
    )
  }
  if (isLoading || !data) {
    return (
      <div className="min-h-screen space-y-4 bg-background p-6">
        <Skeleton className="h-12 w-96" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const v = data.view
  const pctWarn =
    v.partners.length > 0 &&
    [v.partnerTotals.profit, v.partnerTotals.loss, v.partnerTotals.capital].some((t) => t != null && Math.abs(t - 100) > 0.01)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card print:static print:border-none">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="rounded-lg p-3 print:hidden" style={{ backgroundColor: "#2a3314", color: "#9CA757" }}>
                <FileText className="h-6 w-6" />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h1 className="text-xl font-semibold tracking-tight">Form 1065 — U.S. Return of Partnership Income</h1>
                <span className="flex items-center gap-1 whitespace-nowrap text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Tax Year {data.taxYear}
                </span>
                {(v.entity.name ?? data.clientName) && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <User className="h-3.5 w-3.5" />
                    {v.entity.name ?? data.clientName}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" />
                Print
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={fieldViewerHref}>
                  <Table2 className="mr-1.5 h-4 w-4" />
                  All fields
                </Link>
              </Button>
              {clientId && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/tax/clients/${clientId}`}>
                    <ExternalLink className="mr-1.5 h-4 w-4" />
                    Client Profile
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        {data.deletedAt && <Notice title="This return was deleted in ProConnect">The last export is shown.</Notice>}
        {data.catalog.assumedFromTaxYear && (
          <Notice title={`Labels come from Intuit's TY${data.catalog.assumedFromTaxYear} catalog`}>
            Intuit sent no 1065 field catalog for TY{data.taxYear} and says earlier years are very similar. A field
            ProConnect renamed since then could be mislabelled; amounts are this return&apos;s real entries.
          </Notice>
        )}
        {!data.catalog.loaded && (
          <Notice tone="muted" title={`No 1065 field catalog is loaded for TY${data.taxYear}`}>
            Lines show their ProConnect codes instead of labels.
          </Notice>
        )}
        <p className="text-xs text-muted-foreground">
          Shows what was entered in ProConnect as of the export
          {data.exportedAt ? ` on ${new Date(data.exportedAt).toLocaleDateString()}` : ""}. ProConnect&apos;s calculated
          figures (ordinary income, depreciation, ending capital) are not in the export, so totals here are sums of the
          entries; each says what it leaves out.
        </p>

        <Section title="Partnership">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {(
              [
                ["Name", v.entity.name],
                ["DBA", v.entity.dba],
                ["EIN", v.entity.ein],
                ["Address", v.entity.address],
                ["Business activity", v.entity.businessActivity],
                ["Product or service", v.entity.productOrService],
                ["Business code", v.entity.businessCode],
                ["Date business began", v.entity.dateBegan],
              ] as const
            )
              .filter(([, val]) => val)
              .map(([k, val]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{val}</dd>
                </div>
              ))}
          </dl>
        </Section>

        <Section
          title={`Partners (${v.partners.length})`}
          description="From ProConnect's Partner Information and Partner Percentages screens."
        >
          {v.partners.length === 0 ? (
            <p className="text-sm text-muted-foreground">No partners entered.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 font-medium">Partner</th>
                    <th className="py-1 font-medium">Tax ID</th>
                    <th className="py-1 text-right font-medium">Profit</th>
                    <th className="py-1 text-right font-medium">Loss</th>
                    <th className="py-1 text-right font-medium">Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {v.partners.map((p) => {
                    const shown = p.shown
                    return (
                      <tr key={p.prefix} className="border-t">
                        <td className="py-1.5 pr-3">
                          <div className="flex items-center gap-2">
                            <Users className="h-3.5 w-3.5 text-muted-foreground print:hidden" />
                            {p.name ?? <span className="text-muted-foreground">Unnamed</span>}
                            {p.generalPartner && <Badge variant="outline" className="text-[10px]">GP / manager</Badge>}
                          </div>
                          <LineCode>{p.prefix}</LineCode>
                          {p.shownIsBeginning && <span className="ml-2 text-[11px] text-muted-foreground">beginning %</span>}
                        </td>
                        <td className="py-1.5 font-mono text-xs">{p.taxId ?? "—"}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{pct(shown.profit)}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{pct(shown.loss)}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{pct(shown.capital)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-t-2 font-semibold">
                    <td className="py-1.5" colSpan={2}>
                      Total
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{pct(v.partnerTotals.profit)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{pct(v.partnerTotals.loss)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{pct(v.partnerTotals.capital)}</td>
                  </tr>
                </tbody>
              </table>
              {pctWarn && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Percentages don&apos;t add to 100% — a partner or a percentage may be missing in ProConnect.
                </p>
              )}
            </div>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Income" description="Form 1065 page 1 — Income screen entries">
            <AmountLines lines={v.income.lines} empty="No income entered on the Income screen." />
            <TotalRow total={v.income.total} />
          </Section>
          <Section title="Deductions" description="Form 1065 page 1 — Deductions screen entries">
            <AmountLines lines={v.deductions.lines} empty="No deductions entered." />
            <TotalRow total={v.deductions.total} />
          </Section>
        </div>

        <Card className="print:shadow-none print:border">
          <CardContent className="py-4">
            <TotalRow total={v.ordinaryIncome} />
          </CardContent>
        </Card>

        <Section
          title="Schedule L — Balance sheet per books"
          description={
            v.scheduleL.endingIncomplete
              ? "Lines marked * are computed by ProConnect from the depreciation module, which this return uses — the ending column can be incomplete."
              : "Lines marked * are computed by ProConnect from the depreciation module when it is used."
          }
        >
          {!v.scheduleL.entered ? (
            <p className="text-sm text-muted-foreground">No balance sheet entered.</p>
          ) : (
            <div className="space-y-4 overflow-x-auto">
              <ScheduleLTable
                title="Assets"
                rows={v.scheduleL.assets}
                totalLabel="14 Total assets"
                totals={[v.scheduleL.totals.assetsBegin, v.scheduleL.totals.assetsEnd]}
              />
              <ScheduleLTable
                title="Liabilities and capital"
                rows={v.scheduleL.liabilities}
                totalLabel="22 Total liabilities and capital"
                totals={[v.scheduleL.totals.liabilitiesBegin, v.scheduleL.totals.liabilitiesEnd]}
              />
              <p className="text-xs text-muted-foreground">
                Partners&apos; capital (line 21) is computed by ProConnect from Schedule M-2 unless overridden, so it
                appears here only when entered.
              </p>
            </div>
          )}
        </Section>

        <Section title="Schedule M-2 — Partners' capital accounts">
          {!v.m2.entered ? (
            <p className="text-sm text-muted-foreground">No capital account entries.</p>
          ) : (
            <>
              <AmountLines lines={v.m2.lines} empty="" />
              <div className="mt-2 border-t pt-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span>
                    <span className="mr-2 text-xs text-muted-foreground">3</span>Net income per books
                  </span>
                  <span className="text-muted-foreground">computed by ProConnect</span>
                </div>
                <div className="mt-1 flex justify-between gap-3 font-semibold">
                  <span>
                    <span className="mr-2 text-xs font-normal text-muted-foreground">9</span>Ending capital
                  </span>
                  <span className="font-mono tabular-nums">
                    {v.m2.endingOverride != null ? fmtMoney(v.m2.endingOverride) : <span className="font-sans font-normal text-muted-foreground">computed by ProConnect</span>}
                  </span>
                </div>
                {v.m2.endingOverride != null && <p className="text-xs text-muted-foreground">Entered as an override (c107).</p>}
              </div>
            </>
          )}
        </Section>

        {v.priorYear.length > 0 && (
          <Section
            title={`Prior year (TY${data.taxYear - 1}) — ProConnect's figures`}
            description="ProConnect's own calculated totals for last year, carried on this return's prior-year summary."
          >
            <AmountLines lines={v.priorYear} empty="" />
          </Section>
        )}

        {v.unmapped.length > 0 && (
          <Section
            title="Other screens with entries"
            description={
              <>
                Not laid out on this page yet — see them in the{" "}
                <Link href={fieldViewerHref} className="underline">
                  field viewer
                </Link>
                .
              </>
            }
          >
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {v.unmapped.map((u) => (
                <li key={u.seriesId} className="flex justify-between gap-3">
                  <span>
                    {u.title ?? "Unlabelled screen"} <LineCode>{u.seriesId}</LineCode>
                  </span>
                  <span className="text-xs text-muted-foreground">{u.cells} cells</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </main>
    </div>
  )
}
