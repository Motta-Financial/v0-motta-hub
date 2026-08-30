"use client"

/**
 * "My tax returns" — a permanent, browsable archive of filed and
 * in-progress returns by tax year. Distinct from the active work-item
 * list above it on the Tax page: this is the client's long-term record,
 * so files here never expire and years accumulate indefinitely.
 */

import { useState } from "react"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import {
  Eye,
  Download,
  FileText,
  ShieldCheck,
  MessageCircle,
  Lock,
  ChevronDown,
  CheckCircle2,
} from "lucide-react"
import { format, parseISO } from "date-fns"
import { toast } from "sonner"
import {
  MOCK_TAX_RETURN_YEARS,
  STATUS_LABEL,
  STATUS_CHIP_STYLE,
  type TaxReturnYear,
} from "@/lib/mock/tax-returns-archive"

const DEEP_GREEN = "#6B745D"
const SAGE = "#8E9B79"
const RECENT_YEARS_SHOWN = 3

export function TaxReturnsArchive() {
  const [years, setYears] = useState<TaxReturnYear[]>(MOCK_TAX_RETURN_YEARS)
  const [showEarlier, setShowEarlier] = useState(false)

  const sorted = [...years].sort((a, b) => b.year - a.year)
  const recent = sorted.slice(0, RECENT_YEARS_SHOWN)
  const earlier = sorted.slice(RECENT_YEARS_SHOWN)

  function handleApprove(id: string) {
    setYears((prev) =>
      prev.map((y) => (y.id === id ? { ...y, status: "filed" as const } : y)),
    )
    toast.success("Return approved", {
      description: "We've let your preparer know to proceed with filing.",
    })
  }

  return (
    <Card className="shadow-sm border-0">
      <CardHeader className="pb-1">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0" style={{ color: DEEP_GREEN }} />
          <h2 className="text-base font-semibold text-gray-900">My tax returns</h2>
        </div>
        <p className="flex items-center gap-1.5 pl-6 text-xs text-gray-400">
          <Lock className="h-3 w-3 shrink-0" />
          These stay available here in the portal — no expiring links.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        {recent.map((y) => (
          <ReturnYearCard key={y.id} year={y} onApprove={handleApprove} />
        ))}

        {earlier.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowEarlier((v) => !v)}
              className="flex w-full items-center gap-1.5 py-1 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showEarlier ? "rotate-180" : ""}`}
              />
              {showEarlier ? "Hide earlier years" : `Show earlier years (${earlier.length})`}
            </button>
            {showEarlier && (
              <div className="mt-3 space-y-4">
                {earlier.map((y) => (
                  <ReturnYearCard key={y.id} year={y} onApprove={handleApprove} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Year card ─────────────────────────────────────────────────────────────────

function ReturnYearCard({
  year,
  onApprove,
}: {
  year: TaxReturnYear
  onApprove: (id: string) => void
}) {
  const chip = STATUS_CHIP_STYLE[year.status]
  const isAwaitingApproval = year.status === "awaiting_approval"

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold leading-none text-gray-900">
            {year.year}
          </span>
          <span className="text-sm text-gray-500">{year.formType}</span>
        </div>
        <span
          className="shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: chip.bg, color: chip.color }}
        >
          {STATUS_LABEL[year.status]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        {year.filedDate && (
          <span>Filed {format(parseISO(year.filedDate), "MMM d, yyyy")}</span>
        )}
        <span>Preparer: {year.preparerName}</span>
      </div>

      {/* Awaiting-approval band */}
      {isAwaitingApproval && (
        <div
          className="flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          style={{ backgroundColor: "#FEF3C7", borderColor: SAGE, color: "#92400E" }}
        >
          <p className="text-xs sm:text-sm">
            Your {year.year} return is ready. Please review it and let us know
            you approve so we can file on your behalf.
          </p>
          <div className="flex shrink-0 gap-2">
            <ApproveReturnDialog year={year} onApprove={onApprove} />
            <Button
              asChild
              size="sm"
              variant="outline"
              className="gap-1.5 rounded-lg bg-white"
              style={{ borderColor: SAGE, color: "#92400E" }}
            >
              <a href="/client-portal/messages">
                <MessageCircle className="h-3.5 w-3.5" />
                Ask a question
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* Documents */}
      <div className="space-y-2">
        {year.documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: "#8E9B791A" }}
              >
                <FileText className="h-4 w-4" style={{ color: DEEP_GREEN }} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {doc.label}
                </p>
                <p className="text-xs text-gray-400">
                  {doc.fileType} · {doc.sizeLabel}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 rounded-lg text-xs"
                style={{ color: DEEP_GREEN }}
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="sr-only sm:not-sr-only">View</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 rounded-lg text-xs"
                style={{ color: DEEP_GREEN }}
              >
                <Download className="h-3.5 w-3.5" />
                <span className="sr-only sm:not-sr-only">Download</span>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Approve confirmation dialog ──────────────────────────────────────────────

function ApproveReturnDialog({
  year,
  onApprove,
}: {
  year: TaxReturnYear
  onApprove: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setConfirmed(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <Button
        size="sm"
        className="gap-1.5 rounded-lg text-white"
        style={{ backgroundColor: DEEP_GREEN }}
        onClick={() => setOpen(true)}
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        Approve return
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve your {year.year} return?</AlertDialogTitle>
          <AlertDialogDescription>
            Approving tells our team you&apos;ve reviewed the {year.year}{" "}
            {year.formType} and that we should proceed with filing it on your
            behalf. This can&apos;t be undone from the portal — if you need a
            change after approving, reach out to your preparer.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-gray-50/50 p-3 text-sm">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
            className="mt-0.5"
          />
          <span className="text-gray-700">
            I&apos;ve reviewed this return and confirm the information is
            correct.
          </span>
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={!confirmed}
            className="gap-1.5 text-white"
            style={{ backgroundColor: DEEP_GREEN }}
            onClick={() => {
              onApprove(year.id)
              setOpen(false)
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Confirm approval
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
