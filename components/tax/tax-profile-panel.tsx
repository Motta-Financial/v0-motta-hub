"use client"

import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Globe,
  Sparkles,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { fmtMoney } from "@/components/tax/tax-shared"

type TaxProfile = {
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
  latestEffectiveRate: number | null
  primaryPreparerName: string | null
  preparerHistory: string[]
  profileCompleteness: number
  needsAttention: boolean
  attentionReasons: string[]
  aiSummary: string | null
  aiKeywords: string[]
  agiTrend: Record<string, number>
}

/**
 * The Tax Profile panel — the analytical sibling of the Financial
 * Snapshot KPIs. The /api/tax/clients/[clientId] endpoint already
 * computes everything here (filing status, schedule flags, foreign
 * accounts, preparer history, AI summary, attention reasons), but
 * none of it was rendered before — operators were stuck with the raw
 * KPI strip. This component surfaces it as four compact subsections:
 *
 *   1. Filing characteristics  - status, schedules, foreign accounts
 *   2. AI summary              - GPT-generated narrative + keywords
 *   3. Attention flags         - missing email, pending docs, gaps
 *   4. Profile completeness    - 0-100 score with tone
 *
 * We intentionally keep this distinct from the multi-year chart and
 * the per-year returns list so the page reads as
 *   Snapshot → Trend → Profile → Returns → Documents
 * which is how a partner thinks when reviewing a client.
 */
export function TaxProfilePanel({ profile }: { profile: TaxProfile }) {
  const yoy = computeYoyAgiDelta(profile.agiTrend)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left column: filing characteristics + completeness */}
      <Card className="lg:col-span-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tax Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">
              Primary Filing
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.primaryFilingStatus && (
                <Badge variant="outline" className="text-xs">
                  {profile.primaryFilingStatus}
                </Badge>
              )}
              {profile.primaryReturnType && (
                <Badge
                  variant="outline"
                  className="text-xs bg-blue-50 text-blue-900 border-blue-200"
                >
                  Form {profile.primaryReturnType}
                </Badge>
              )}
              {!profile.primaryFilingStatus && !profile.primaryReturnType && (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">
              Schedules &amp; Flags
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ScheduleChip
                label="Schedule C"
                active={profile.hasScheduleC}
                title="Self-employment / sole proprietor income"
              />
              <ScheduleChip
                label="Schedule E"
                active={profile.hasScheduleE}
                title="Rental real estate, royalties, partnerships, S-corps"
              />
              <ScheduleChip
                label="Schedule F"
                active={profile.hasScheduleF}
                title="Farm income"
              />
              <ScheduleChip
                label="Foreign"
                active={profile.hasForeignAccounts}
                title="Foreign accounts (FBAR / Form 8938)"
                icon={<Globe className="h-3 w-3" />}
              />
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">
              Filing History
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">First year</div>
                <div className="font-medium tabular-nums">
                  {profile.firstYearFiled ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Last year</div>
                <div className="font-medium tabular-nums">
                  {profile.lastYearFiled ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Consecutive</div>
                <div className="font-medium tabular-nums">
                  {profile.consecutiveYears}{" "}
                  {profile.consecutiveYears === 1 ? "year" : "years"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Effective rate</div>
                <div className="font-medium tabular-nums">
                  {profile.latestEffectiveRate != null
                    ? `${(profile.latestEffectiveRate * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-stone-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Profile Completeness
              </span>
              <span
                className={cn(
                  "text-xs font-semibold tabular-nums",
                  profile.profileCompleteness >= 80
                    ? "text-emerald-700"
                    : profile.profileCompleteness >= 50
                      ? "text-amber-700"
                      : "text-rose-700",
                )}
              >
                {profile.profileCompleteness}%
              </span>
            </div>
            <Progress value={profile.profileCompleteness} className="h-1.5" />
          </div>
        </CardContent>
      </Card>

      {/* Middle column: AI summary + preparer history */}
      <Card className="lg:col-span-1">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-violet-600" />
            ALFRED Summary
          </CardTitle>
          {yoy && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs gap-1",
                yoy.direction === "up"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-rose-50 text-rose-700 border-rose-200",
              )}
              title={`AGI change from ${yoy.fromYear} (${fmtMoney(yoy.fromValue)}) to ${yoy.toYear} (${fmtMoney(yoy.toValue)})`}
            >
              {yoy.direction === "up" ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {yoy.pct > 0 ? "+" : ""}
              {yoy.pct.toFixed(1)}% AGI
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {profile.aiSummary ? (
            <p className="text-sm text-stone-700 leading-relaxed">
              {profile.aiSummary}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              ALFRED has not generated a summary for this client yet. Summaries
              are written when a return is finalized in ProConnect.
            </p>
          )}

          {profile.aiKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {profile.aiKeywords.slice(0, 8).map((kw) => (
                <Badge
                  key={kw}
                  variant="outline"
                  className="text-[10px] bg-violet-50 text-violet-700 border-violet-200"
                >
                  {kw}
                </Badge>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-stone-100">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <User className="h-3 w-3" />
              Preparer History
            </div>
            {profile.preparerHistory.length > 0 ? (
              <div className="text-xs space-y-1">
                {profile.primaryPreparerName && (
                  <div>
                    <span className="text-muted-foreground">Primary:</span>{" "}
                    <span className="font-medium">
                      {profile.primaryPreparerName}
                    </span>
                  </div>
                )}
                {profile.preparerHistory.length > 1 && (
                  <div className="text-muted-foreground">
                    Also: {profile.preparerHistory.slice(1, 4).join(", ")}
                    {profile.preparerHistory.length > 4 &&
                      ` +${profile.preparerHistory.length - 4} more`}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground italic">
                No preparer assigned
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Right column: attention flags */}
      <Card
        className={cn(
          "lg:col-span-1",
          profile.needsAttention
            ? "bg-amber-50/50 border-amber-200"
            : "bg-emerald-50/40 border-emerald-200",
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-1.5">
            {profile.needsAttention ? (
              <AlertTriangle className="h-4 w-4 text-amber-700" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            )}
            {profile.needsAttention ? "Needs Attention" : "All Clear"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {profile.attentionReasons.length > 0 ? (
            <ul className="space-y-2">
              {profile.attentionReasons.map((reason, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-amber-900"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-900">
              No outstanding profile issues. Contact info, recent filings, and
              document intake are all up to date.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ScheduleChip({
  label,
  active,
  title,
  icon,
}: {
  label: string
  active: boolean
  title: string
  icon?: React.ReactNode
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs gap-1",
        active
          ? "bg-blue-50 text-blue-900 border-blue-200"
          : "bg-stone-50 text-stone-500 border-stone-200 line-through opacity-60",
      )}
      title={title}
    >
      {icon}
      {label}
    </Badge>
  )
}

/**
 * Compute YoY % change in AGI between the two most recent filed years.
 * Returns null when fewer than 2 years are available — we never
 * fabricate a delta from a single data point.
 */
function computeYoyAgiDelta(
  agiTrend: Record<string, number>,
): { fromYear: number; toYear: number; fromValue: number; toValue: number; pct: number; direction: "up" | "down" } | null {
  const years = Object.keys(agiTrend)
    .map(Number)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => b - a)

  if (years.length < 2) return null

  const toYear = years[0]
  const fromYear = years[1]
  const toValue = agiTrend[toYear]
  const fromValue = agiTrend[fromYear]

  if (!fromValue || !toValue) return null

  const pct = ((toValue - fromValue) / Math.abs(fromValue)) * 100
  return {
    fromYear,
    toYear,
    fromValue,
    toValue,
    pct,
    direction: pct >= 0 ? "up" : "down",
  }
}
