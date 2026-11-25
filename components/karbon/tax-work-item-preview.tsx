"use client"

/**
 * One-line preview of what the Hub sets on a tax-preparation work item
 * right after it is created in Karbon: the 12/31 start date, the
 * statutory due / deadline date, and the lead status.
 *
 * The dates come from the same pure rules the server applies
 * (`lib/karbon/tax-work-item-defaults.ts`), so what the teammate reads
 * here is what `lib/karbon/finalize-work-item.ts` will PATCH.
 */

import {
  AWAITING_MEETING_SECONDARY_STATUS,
  MEETING_SCHEDULED_SECONDARY_STATUS,
  formatIsoDateForDisplay,
  resolveTaxYear,
  taxReturnSchedule,
  type TaxReturnKind,
} from "@/lib/karbon/tax-work-item-defaults"

interface Props {
  /** Return family; the one-click button is always a 1040. */
  kind?: TaxReturnKind
  /** What the teammate typed in the fiscal-year field ("2026", "LEAD"). */
  fiscalYear?: string | null
  /** Work item title, when the year lives there instead (the builder). */
  title?: string | null
  /**
   * The teammate picked their own start / due date. A picked date is
   * kept, so the preview only promises the dates the Hub will fill in.
   * (The deadline is never picked in the Hub — it is always the filing
   * date.)
   */
  startPicked?: boolean
  duePicked?: boolean
  /**
   * Describe the lead status too. Only for prospect work items — an
   * existing client's new return is not a lead.
   */
  showStatus?: boolean
  className?: string
}

const strong = "font-medium text-foreground"

export function TaxWorkItemPreview({
  kind = "1040",
  fiscalYear,
  title,
  startPicked = false,
  duePicked = false,
  showStatus = true,
  className,
}: Props) {
  const { taxYear, source } = resolveTaxYear({ fiscalYear, title })
  const schedule = taxReturnSchedule(kind, taxYear)

  const statusSentence = showStatus
    ? ` Status: “${MEETING_SCHEDULED_SECONDARY_STATUS}” if a Calendly meeting is booked, otherwise “${AWAITING_MEETING_SECONDARY_STATUS}” — and it moves to “${MEETING_SCHEDULED_SECONDARY_STATUS}” on its own once they book.`
    : ""

  const kept =
    startPicked && duePicked
      ? " Your start and due dates are kept."
      : startPicked
        ? " Your start date is kept."
        : duePicked
          ? " Your due date is kept."
          : ""

  return (
    <p className={className ?? "text-[11px] leading-relaxed text-muted-foreground"}>
      {schedule ? (
        <>
          Once created, the Hub sets it up in Karbon:{" "}
          {!startPicked ? (
            <>
              starts <span className={strong}>{formatIsoDateForDisplay(schedule.startDate)}</span>,{" "}
            </>
          ) : null}
          {duePicked ? "deadline" : "due and deadline"}{" "}
          <span className={strong}>{formatIsoDateForDisplay(schedule.deadlineDate)}</span>
          {source === "default" ? ` (no year entered, so tax year ${taxYear})` : ""}.{kept}
        </>
      ) : (
        <>
          Dates are not set automatically for this return type — exempt organizations file on
          their own fiscal-year schedule, so pick the start and due dates above.
        </>
      )}
      {statusSentence}
    </p>
  )
}
