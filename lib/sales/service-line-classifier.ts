/**
 * Service Line Classification
 *
 * Maps Ignition service names to the four Motta service lines:
 * - Tax: Tax preparation, planning, compliance, returns
 * - Accounting: Bookkeeping, payroll, CFO services, accounts payable
 * - Advisory: Consulting, advisory, business valuation, forecasting
 * - Other: Misc services that don't fit cleanly
 *
 * The classification uses keyword matching against the service name.
 */

export type ServiceLine = "Tax" | "Accounting" | "Advisory" | "Other"

export interface ServiceLineColors {
  bg: string
  text: string
  border: string
  fill: string
}

export const SERVICE_LINE_META: Record<ServiceLine, ServiceLineColors> = {
  Tax: {
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
    fill: "#3B82F6",
  },
  Accounting: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    fill: "#10B981",
  },
  Advisory: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    fill: "#F59E0B",
  },
  Other: {
    bg: "bg-stone-100",
    text: "text-stone-700",
    border: "border-stone-200",
    fill: "#78716C",
  },
}

// Keywords for each service line (case-insensitive matching)
const TAX_KEYWORDS = [
  "tax",
  "1040",
  "1120",
  "1120s",
  "1065",
  "990",
  "schedule c",
  "schedule e",
  "schedule f",
  "schedule a",
  "schedule b",
  "schedule d",
  "filing status",
  "extension",
  "amended return",
  "estimate",
  "quarterly",
  "irs",
  "state return",
  "federal return",
  "franchise tax",
  "annual report",
  "w-2",
  "1099",
]

const ACCOUNTING_KEYWORDS = [
  "bookkeeping",
  "accounting",
  "payroll",
  "accounts payable",
  "accounts receivable",
  "cfo",
  "controllership",
  "reconciliation",
  "qbo",
  "quickbooks",
  "acct",
  "month-end",
  "monthly close",
  "ledger",
  "financial statement",
  "balance sheet",
  "p&l",
  "profit and loss",
  "income statement",
  "ap",
  "ar",
  "invoicing",
  "billing",
  "onboarding",
  "clean up",
  "cleanup",
  "catch up",
  "catchup",
  "optimization",
]

const ADVISORY_KEYWORDS = [
  "advisory",
  "consulting",
  "planning",
  "forecasting",
  "budgeting",
  "valuation",
  "409a",
  "strategy",
  "analysis",
  "assessment",
  "review",
  "due diligence",
  "audit",
  "assurance",
  "estate",
  "retained",
  "management reporting",
]

/**
 * Classifies a service name into one of the four service lines.
 * Uses keyword matching with priority: Tax > Advisory > Accounting > Other
 */
export function classifyService(serviceName: string): ServiceLine {
  const lower = serviceName.toLowerCase()

  // Check tax first (most specific)
  for (const keyword of TAX_KEYWORDS) {
    if (lower.includes(keyword)) {
      // Exception: "tax planning" should be Advisory
      if (keyword === "tax" && (lower.includes("planning") || lower.includes("advisory"))) {
        return "Advisory"
      }
      return "Tax"
    }
  }

  // Advisory keywords
  for (const keyword of ADVISORY_KEYWORDS) {
    if (lower.includes(keyword)) {
      return "Advisory"
    }
  }

  // Accounting keywords
  for (const keyword of ACCOUNTING_KEYWORDS) {
    if (lower.includes(keyword)) {
      return "Accounting"
    }
  }

  // Default to Other
  return "Other"
}

export interface ServiceLineBreakdown {
  serviceLine: ServiceLine
  revenue: number
  count: number
  services: Array<{ name: string; revenue: number; count: number }>
}

/**
 * Aggregates services into service line breakdowns.
 */
export function aggregateByServiceLine(
  services: Array<{ service_name: string; total_amount: number }>,
): ServiceLineBreakdown[] {
  const lineMap = new Map<
    ServiceLine,
    {
      revenue: number
      count: number
      servicesMap: Map<string, { revenue: number; count: number }>
    }
  >()

  for (const s of services) {
    const line = classifyService(s.service_name)
    const current = lineMap.get(line) || {
      revenue: 0,
      count: 0,
      servicesMap: new Map(),
    }

    current.revenue += s.total_amount
    current.count += 1

    const serviceCurrent = current.servicesMap.get(s.service_name) || {
      revenue: 0,
      count: 0,
    }
    serviceCurrent.revenue += s.total_amount
    serviceCurrent.count += 1
    current.servicesMap.set(s.service_name, serviceCurrent)

    lineMap.set(line, current)
  }

  // Convert to array and sort by revenue
  const order: ServiceLine[] = ["Tax", "Accounting", "Advisory", "Other"]
  return order
    .filter((line) => lineMap.has(line))
    .map((line) => {
      const data = lineMap.get(line)!
      return {
        serviceLine: line,
        revenue: data.revenue,
        count: data.count,
        services: Array.from(data.servicesMap.entries())
          .map(([name, stats]) => ({
            name,
            revenue: stats.revenue,
            count: stats.count,
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10), // Top 10 services per line
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
}
