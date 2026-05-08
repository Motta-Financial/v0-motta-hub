// Shared helpers for the Accounting Project Plan view (mirrors the FY2026
// project-plan Excel workbook). Status buckets and service-type buckets here
// match the workbook's Dashboard / Team Workload / Kanban tabs so the numbers
// reconcile back to the source of truth.
import { useMemo } from "react"
import { useKarbonWorkItems, type KarbonWorkItem } from "@/contexts/karbon-work-items-context"

// ---- ACCT scope filter
//
// The Project Plan view is scoped to the Accounting department, so we
// restrict every tab to Karbon work_types that begin with the canonical
// "ACCT | " prefix (Bookkeeping, Payroll, 1099s, FP&A, Onboarding, etc.).
// Centralizing this lets every tab share the same filter without
// duplicating the rule — change it here and all six tabs follow.
export function isAccountingWorkItem(item: KarbonWorkItem): boolean {
  const wt = (item.work_type || item.WorkType || "").trim().toUpperCase()
  // Trailing space matters: prevents accidental matches like "ACCTPLUS".
  return wt.startsWith("ACCT |")
}

// Hook used by every Project Plan tab in place of useKarbonWorkItems.
// Returns the same shape but with both the active and the all-items lists
// pre-filtered to Accounting work types. Memoized so adding the filter
// doesn't re-run downstream useMemo bodies on unrelated re-renders.
export function useAccountingWorkItems() {
  const { activeWorkItems, allWorkItems, isLoading, error, refresh } = useKarbonWorkItems()
  const acctActive = useMemo(
    () => activeWorkItems.filter(isAccountingWorkItem),
    [activeWorkItems],
  )
  const acctAll = useMemo(
    () => allWorkItems.filter(isAccountingWorkItem),
    [allWorkItems],
  )
  return { activeWorkItems: acctActive, allWorkItems: acctAll, isLoading, error, refresh }
}

// ---- Status buckets (Excel: Not Started / To Do / In Progress / Waiting / Complete)

export type StatusBucket = "Not Started" | "To Do" | "In Progress" | "Waiting" | "Complete"

export const STATUS_BUCKETS: StatusBucket[] = [
  "Not Started",
  "To Do",
  "In Progress",
  "Waiting",
  "Complete",
]

export const STATUS_COLORS: Record<StatusBucket, { bg: string; text: string; border: string; dot: string }> = {
  "Not Started": {
    bg: "bg-slate-50",
    text: "text-slate-700",
    border: "border-slate-200",
    dot: "bg-slate-400",
  },
  "To Do": {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  "In Progress": {
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
    dot: "bg-blue-500",
  },
  Waiting: {
    bg: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-200",
    dot: "bg-rose-500",
  },
  Complete: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
}

// Karbon ships a long tail of statuses ("Ready To Start", "In Progress",
// "Awaiting Reply", "Hold", "Completed - Lost | Pricing", "Planning", etc.).
// We collapse them into the five Excel buckets so the dashboard reconciles.
export function bucketStatus(item: KarbonWorkItem): StatusBucket {
  const raw = (
    item.workflow_status ||
    item.primary_status ||
    item.status ||
    item.WorkStatus ||
    ""
  )
    .toString()
    .toLowerCase()

  if (!raw.trim()) return "Not Started"
  if (raw.includes("complete")) return "Complete"
  if (
    raw.includes("wait") ||
    raw.includes("hold") ||
    raw.includes("info") ||
    raw.includes("block") ||
    raw.includes("pending")
  ) {
    return "Waiting"
  }
  if (raw.includes("progress") || raw.includes("active") || raw.includes("review")) {
    return "In Progress"
  }
  if (raw.includes("ready") || raw.includes("to do") || raw.includes("queued") || raw.includes("planned")) {
    return "To Do"
  }
  return "Not Started"
}

// ---- Service type buckets (mirrors workbook's "Clients by Service Type" panel)

export type ServiceType =
  | "Monthly Bookkeeping"
  | "Quarterly Filings"
  | "Payroll"
  | "1099s"
  | "Advisory / CFO Services"
  | "Onboarding"
  | "Tax"
  | "Internal Ops"
  | "Sales & Marketing"
  | "Talent"
  | "Other"

export const SERVICE_TYPE_ORDER: ServiceType[] = [
  "Monthly Bookkeeping",
  "Quarterly Filings",
  "Payroll",
  "1099s",
  "Advisory / CFO Services",
  "Onboarding",
  "Tax",
  "Internal Ops",
  "Sales & Marketing",
  "Talent",
  "Other",
]

export function bucketServiceType(item: KarbonWorkItem): ServiceType {
  const wt = (item.work_type || item.WorkType || "").trim()
  const title = (item.title || item.Title || "").trim()

  const wtLower = wt.toLowerCase()
  const titleLower = title.toLowerCase()

  if (wtLower === "acct | bookkeeping" || titleLower.startsWith("bkpg |")) return "Monthly Bookkeeping"
  if (wtLower.includes("quarterly") || titleLower.includes("| quarterly")) return "Quarterly Filings"
  if (wtLower === "acct | payroll" || titleLower.startsWith("pay |") || titleLower.startsWith("pyrl |")) return "Payroll"
  if (wtLower === "acct | 1099s" || titleLower.startsWith("1099")) return "1099s"
  if (wtLower === "acct | fp&a" || titleLower.startsWith("advs |") || titleLower.includes("cfo")) {
    return "Advisory / CFO Services"
  }
  if (wtLower.startsWith("acct | onboarding") || titleLower.includes("onboarding")) return "Onboarding"
  if (
    wtLower.startsWith("tax") ||
    wtLower.includes("1040") ||
    wtLower.includes("1120") ||
    wtLower.includes("1065") ||
    wtLower.includes("990") ||
    titleLower.startsWith("tax |")
  ) {
    return "Tax"
  }
  if (wtLower.includes("sales") || wtLower.includes("mkting") || titleLower.startsWith("biz dev")) {
    return "Sales & Marketing"
  }
  if (wtLower.includes("talent") || titleLower.startsWith("talent")) return "Talent"
  if (wtLower.startsWith("motta") || wtLower.includes("internal")) return "Internal Ops"
  return "Other"
}

// ---- Bookkeeping checklist template (10 steps, Phase 1 / Phase 2)

export type ChecklistPhase = "Phase 1 — P24 (Preparer)" | "Phase 2 — Reviewer"

export interface ChecklistStep {
  step: number
  task: string
  phase: ChecklistPhase
  assignedTo: string
}

export const BOOKKEEPING_CHECKLIST: ChecklistStep[] = [
  {
    step: 1,
    task: "Review work item for the month or quarter",
    phase: "Phase 1 — P24 (Preparer)",
    assignedTo: "P24",
  },
  {
    step: 2,
    task: "Enter in and categorize all transactions for the month",
    phase: "Phase 1 — P24 (Preparer)",
    assignedTo: "P24",
  },
  {
    step: 3,
    task: "If you're not 100% on certain transactions, please code them to uncategorized expense",
    phase: "Phase 1 — P24 (Preparer)",
    assignedTo: "P24",
  },
  {
    step: 4,
    task: "Gather all statements (download from 1Password or request from client)",
    phase: "Phase 1 — P24 (Preparer)",
    assignedTo: "P24",
  },
  {
    step: 5,
    task: "Reconcile all accounts",
    phase: "Phase 1 — P24 (Preparer)",
    assignedTo: "P24",
  },
  {
    step: 6,
    task: "Review monthly and quarterly accounting",
    phase: "Phase 2 — Reviewer",
    assignedTo: "Andrew / Caleb / Amy / Matt",
  },
  {
    step: 7,
    task: "If transactions need to be reclassified, send the Excel spreadsheet request to client",
    phase: "Phase 2 — Reviewer",
    assignedTo: "Andrew / Caleb / Amy / Matt",
  },
  {
    step: 8,
    task: "Reclassify uncategorized transactions",
    phase: "Phase 2 — Reviewer",
    assignedTo: "Andrew / Caleb / Amy / Matt",
  },
  {
    step: 9,
    task: "Send monthly and quarterly reports",
    phase: "Phase 2 — Reviewer",
    assignedTo: "Andrew / Caleb / Amy / Matt",
  },
  {
    step: 10,
    task: "Monthly or quarterly meeting completed (if applicable)",
    phase: "Phase 2 — Reviewer",
    assignedTo: "Andrew / Caleb / Amy / Matt",
  },
]

// Pretty-print a date column. Karbon emits ISO strings; we want short form
// for the dense table layouts ("Jan 5, 2026"). Returns "—" for empty.
export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function getClientLabel(item: KarbonWorkItem): string {
  return (
    item.client_name ||
    item.ClientName ||
    item.client_group_name ||
    item.ClientGroupName ||
    "Unknown Client"
  )
}

export function getAssigneeLabel(item: KarbonWorkItem): string {
  return item.assignee_name || item.AssigneeName || "Unassigned"
}
