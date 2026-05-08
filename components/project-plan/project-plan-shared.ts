// Shared helpers for the Accounting Project Plan view (mirrors the FY2026
// project-plan Excel workbook). Status buckets and service-type buckets here
// match the workbook's Dashboard / Team Workload / Kanban tabs so the numbers
// reconcile back to the source of truth.
import { useMemo } from "react"
import useSWR from "swr"
import type { KarbonWorkItem } from "@/contexts/karbon-work-items-context"
import { ACCT_WORK_TYPES, isAccountingWorkType } from "@/lib/accounting-work-types"

// ---- ACCT scope filter
//
// The Project Plan view is scoped to the Accounting department, so we
// restrict every tab to the explicit list of canonical Karbon work_types
// (Bookkeeping, Payroll, 1099s, FP&A, Onboarding (BKPG), Onboarding (PYRL))
// defined in lib/accounting-work-types.ts. Membership is checked against
// that allow-list rather than a "ACCT |" prefix so a new untriaged Karbon
// work type can't sneak into the dashboards without explicit review.
export function isAccountingWorkItem(item: KarbonWorkItem): boolean {
  return isAccountingWorkType(item.work_type || item.WorkType || null)
}

// Fetcher specifically for /api/supabase/work-items — the legacy
// /api/work-items endpoint is capped at PostgREST's default 1000-row
// page, which clips the Project Plan to ~11 active ACCT items even
// though there are >250 in production. /api/supabase/work-items
// paginates server-side so we get the full population in one call.
const acctFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.error || message
    } catch {
      // Non-JSON error response — keep the original statusText.
    }
    throw new Error(message)
  }
  return res.json()
}

// Map a /api/supabase/work-items row into the KarbonWorkItem shape so
// every Project Plan tab keeps using the same fields it already reads
// (both the snake_case and legacy PascalCase aliases).
function mapSupabaseRowToKarbon(item: any): KarbonWorkItem {
  return {
    id: item.id,
    karbon_work_item_key: item.karbon_work_item_key,
    title: item.title,
    client_name: item.client_name ?? item.clientName ?? null,
    work_type: item.work_type,
    workflow_status: item.workflow_status,
    status: item.status,
    primary_status: item.primary_status,
    secondary_status: item.secondary_status,
    due_date: item.due_date,
    start_date: item.start_date,
    completed_date: item.completed_date,
    karbon_modified_at: item.karbon_modified_at,
    assignee_name: item.assignee_name,
    karbon_client_key: item.karbon_client_key,
    description: item.description,
    priority: item.priority,
    karbon_url: item.karbon_url,
    client_group_name: item.client_group_name,
    // Legacy aliases — kept for parity with the global Karbon context.
    WorkKey: item.karbon_work_item_key || item.id,
    Key: item.karbon_work_item_key || item.id,
    Title: item.title || "",
    ClientName: item.client_name || item.clientName || undefined,
    WorkType: item.work_type || undefined,
    WorkStatus: item.workflow_status || item.status || undefined,
    DueDate: item.due_date || undefined,
    StartDate: item.start_date || undefined,
    CompletedDate: item.completed_date || undefined,
    LastModifiedDateTime: item.karbon_modified_at || undefined,
    AssigneeName: item.assignee_name || undefined,
    AssignedTo: item.assignee_name
      ? [{ FullName: item.assignee_name, Email: undefined, UserKey: undefined }]
      : undefined,
    ClientKey: item.karbon_client_key || undefined,
    Description: item.description || undefined,
    Priority: item.priority || undefined,
    PrimaryStatus: item.primary_status || item.status || undefined,
    SecondaryStatus: item.secondary_status || undefined,
    ClientGroupName: item.client_group_name || undefined,
  }
}

// Hook used by every Project Plan tab. Fetches the full ACCT scope in
// one call (status=all, includeDeleted=false). The dashboard splits the
// response into `active` and `all` views client-side so the recurring
// monthly Bookkeeping tracker rows surface even when their workflow
// status is "Ready To Start" or similar.
const ACCT_WORK_TYPES_PARAM = ACCT_WORK_TYPES.join(",")
const ACCT_FETCH_URL =
  `/api/supabase/work-items?workTypes=${encodeURIComponent(ACCT_WORK_TYPES_PARAM)}` +
  // 2000 is comfortably above the ~1,037 ACCT rows we have today
  // (including completed/cancelled history) and well within the API's
  // 5000-row cap, so the entire population fits in one fetch.
  `&limit=2000&status=all`

export function useAccountingWorkItems() {
  const { data, error, isLoading, mutate } = useSWR(ACCT_FETCH_URL, acctFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 60_000,
    refreshInterval: 300_000,
  })

  const allWorkItems = useMemo<KarbonWorkItem[]>(() => {
    const rows: any[] = data?.workItems || []
    return rows.map(mapSupabaseRowToKarbon)
  }, [data])

  const activeWorkItems = useMemo<KarbonWorkItem[]>(
    () =>
      allWorkItems.filter((item) => {
        const s = (item.status || item.primary_status || item.WorkStatus || "")
          .toString()
          .toLowerCase()
        return (
          !s.includes("completed") &&
          !s.includes("complete") &&
          !s.includes("cancelled") &&
          !s.includes("canceled")
        )
      }),
    [allWorkItems],
  )

  return {
    activeWorkItems,
    allWorkItems,
    isLoading,
    error: error?.message || null,
    refresh: () => mutate(),
  }
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
