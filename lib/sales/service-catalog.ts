/**
 * Canonical Service Catalog
 * ────────────────────────────────────────────────────────────────────────
 * Sales surfaces (Ignition, the recurring-revenue spreadsheet, the
 * proposal line items table) all carry the same conceptual services
 * under wildly different names. For example, "Tax Preparation (1040)"
 * shows up as:
 *   • "Individual Tax Return (1040)"             (44 uses)
 *   • "Tax | Prep (1040): Federal Return (Individual)" (21 uses)
 *   • "Tax Prep (1040): Federal Return (Individual)"   (15 uses)
 *   • "Tax Preparation: Individual Income Tax Return (1040)"
 *
 * This module collapses those into one canonical service so dashboards,
 * filters, and reports actually represent how many of each service we
 * sold — not how many ways someone named it.
 *
 * Each entry has:
 *   • `id`         — stable kebab-case key, safe for URLs and DB rows
 *   • `label`      — human-friendly display name
 *   • `serviceLine`— Tax / Accounting / Advisory / Other
 *   • `aliases`    — exact names seen in the data (case-insensitive)
 *   • `patterns`   — optional regex fallbacks for future drift
 *
 * Match priority: alias (exact) → pattern (first match) → fallback to a
 * synthetic "unknown" record using the keyword classifier so we always
 * return *something* renderable.
 *
 * Add new services here, not in scattered switch statements.
 */

import type { ServiceLine } from "./service-line-classifier"

export type CanonicalServiceId =
  // Tax — Individual Returns
  | "tax-prep-1040-federal"
  | "tax-prep-state-individual"
  | "tax-prep-amendment"
  | "tax-prep-gift-709"
  | "tax-prep-estate"
  | "tax-sched-b"
  | "tax-sched-c"
  | "tax-sched-d"
  | "tax-sched-e"
  // Tax — Business Returns
  | "tax-prep-1120s"
  | "tax-prep-1120c"
  | "tax-prep-1065"
  | "tax-prep-990"
  | "tax-prep-state-business"
  | "tax-prep-1099-base"
  | "tax-prep-1099-additional"
  // Tax — Planning, Compliance, Support
  | "tax-quarterly-estimates"
  | "tax-planning-advisory"
  | "tax-rsu-estimates"
  | "tax-bi-annual-plan"
  | "tax-doc-organization"
  | "tax-review-assessment"
  | "tax-irs-assistance"
  | "tax-local-filing"
  | "tax-compliance-annual-report"
  | "tax-audit-workers-comp"
  | "tax-advisory-stock-comp"
  // Accounting / Bookkeeping
  | "bookkeeping-monthly"
  | "bookkeeping-quarterly"
  | "bookkeeping-onboarding"
  | "bookkeeping-cleanup"
  | "acct-reconciliations"
  | "acct-payable"
  | "acct-qbo-subscription"
  | "acct-software-setup"
  | "acct-financial-reporting"
  | "acct-controllership"
  | "acct-business-valuation"
  // Payroll
  | "payroll-biweekly"
  | "payroll-monthly"
  | "payroll-general"
  | "payroll-setup"
  | "payroll-addl-employee"
  | "payroll-quarterly-filings"
  // Advisory / Consulting / Entity
  | "advisory-retained-consulting"
  | "advisory-corporate-restructure"
  | "advisory-business-acquisition"
  | "advisory-registered-agent"
  | "advisory-cpa-verification"
  | "advisory-entity-formation-smllc"
  | "advisory-entity-formation-mmllc"
  | "advisory-entity-formation-scorp"
  | "advisory-entity-state-fees"
  | "advisory-budgeting-forecasting"
  | "advisory-financial-forecast"
  | "advisory-virtual-cfo"
  | "advisory-mottaguard"
  // Other
  | "payment-plan"
  | "rental-payment"

export interface CanonicalService {
  id: CanonicalServiceId
  label: string
  serviceLine: ServiceLine
  /** Short label suitable for badges / chips (≤ 24 chars). */
  shortLabel?: string
  /** One-sentence definition. Optional. */
  description?: string
  /** Exact alias matches, case- and whitespace-insensitive. */
  aliases: string[]
  /**
   * Regex fallback. Tested *after* alias matching, in array order.
   * Be specific — a too-broad pattern can swallow unrelated services.
   */
  patterns?: RegExp[]
}

/**
 * The canonical catalog. Order is preserved when listing for a UI; we
 * group by service line for readability.
 */
export const CANONICAL_SERVICES: CanonicalService[] = [
  // ── Tax — Individual ────────────────────────────────────────────────
  {
    id: "tax-prep-1040-federal",
    label: "Tax Prep — Individual Federal (1040)",
    shortLabel: "1040 Federal",
    serviceLine: "Tax",
    aliases: [
      "Individual Tax Return (1040)",
      "Tax | Prep (1040): Federal Return (Individual)",
      "Tax Prep (1040): Federal Return (Individual)",
      "Tax Preparation: Individual Income Tax Return (1040)",
      "Tax | Prep (1040)",
    ],
    patterns: [/\b1040\b.*federal/i, /individual.*tax.*return.*1040/i],
  },
  {
    id: "tax-prep-state-individual",
    label: "Tax Prep — Individual State Return",
    shortLabel: "State (Individual)",
    serviceLine: "Tax",
    aliases: [
      "State Return (Per State)",
      "Tax | Prep (State): Individual",
      "Tax Prep (State): Individual",
    ],
  },
  {
    id: "tax-prep-amendment",
    label: "Tax Prep — Amendment",
    shortLabel: "Amendment",
    serviceLine: "Tax",
    aliases: ["Tax Prep: Amendment"],
    patterns: [/\bamend(ed|ment)\b/i],
  },
  {
    id: "tax-prep-gift-709",
    label: "Tax Prep — Gift Tax Return (Form 709)",
    shortLabel: "Gift (709)",
    serviceLine: "Tax",
    aliases: ["Tax Prep | Gift Tax Return (Form 709) - [SIMPLE]"],
    patterns: [/\bform\s*709\b/i, /\bgift\s*tax\b/i],
  },
  {
    id: "tax-prep-estate",
    label: "Estate Tax",
    shortLabel: "Estate",
    serviceLine: "Tax",
    aliases: ["Estate Tax"],
  },
  {
    id: "tax-sched-b",
    label: "Schedule B — Interest & Dividends",
    shortLabel: "Sched B",
    serviceLine: "Tax",
    aliases: [
      "Schedule B: Interest and Ordinary Dividends",
      "Tax | Schedule B: Interest and Ordinary Dividends",
    ],
    patterns: [/\bschedule\s*b\b/i],
  },
  {
    id: "tax-sched-c",
    label: "Schedule C — Self Employment",
    shortLabel: "Sched C",
    serviceLine: "Tax",
    aliases: [
      "Schedule C: Contractor & Self Employment",
      "Tax | Schedule C: Contractor & Self Employment",
    ],
    patterns: [/\bschedule\s*c\b/i],
  },
  {
    id: "tax-sched-d",
    label: "Schedule D — Investment Income",
    shortLabel: "Sched D",
    serviceLine: "Tax",
    aliases: [
      "Schedule D: Income from Investments",
      "Tax | Schedule D: Income from Investments",
    ],
    patterns: [/\bschedule\s*d\b/i],
  },
  {
    id: "tax-sched-e",
    label: "Schedule E — Passive Income",
    shortLabel: "Sched E",
    serviceLine: "Tax",
    aliases: [
      "Schedule E: Passive Income Activites",
      "Schedule E: Passive Income Activities",
      "Tax | Schedule E: Passive Income Activites",
      "Tax | Schedule E: Passive Income Activities",
    ],
    patterns: [/\bschedule\s*e\b/i],
  },

  // ── Tax — Business Returns ─────────────────────────────────────────
  {
    id: "tax-prep-1120s",
    label: "Tax Prep — S-Corp (1120s)",
    shortLabel: "1120s",
    serviceLine: "Tax",
    aliases: [
      "Tax Prep (1120s): S-Corporation",
      "Tax | Prep (1120s): S-Corporation",
      "Tax Preparation: S-Corp (1120s)",
    ],
    patterns: [/\b1120s\b/i, /s[-\s]?corp(oration)?/i],
  },
  {
    id: "tax-prep-1120c",
    label: "Tax Prep — C-Corp (1120C)",
    shortLabel: "1120C",
    serviceLine: "Tax",
    aliases: [
      "Tax Prep (1120C): C-Corporation",
      "Tax | Prep (1120C): C-Corporation",
    ],
    patterns: [/\b1120c\b/i, /c[-\s]?corp(oration)?/i],
  },
  {
    id: "tax-prep-1065",
    label: "Tax Prep — Partnership (1065)",
    shortLabel: "1065",
    serviceLine: "Tax",
    aliases: [
      "Tax Prep (1065): Partnership",
      "Tax | Prep (1065): Partnership",
      "Tax Preparation: Partnership Return (1065)",
    ],
    patterns: [/\b1065\b/i, /\bpartnership\s*(return)?/i],
  },
  {
    id: "tax-prep-990",
    label: "Tax Prep — Non-Profit (990)",
    shortLabel: "990",
    serviceLine: "Tax",
    aliases: ["Tax Prep (990): Non-Profit / Charitable Entities"],
    patterns: [/\b990\b/i, /\bnon[-\s]?profit\b/i],
  },
  {
    id: "tax-prep-state-business",
    label: "Tax Prep — Business State Return",
    shortLabel: "State (Business)",
    serviceLine: "Tax",
    aliases: [
      "Tax Prep (State): Business",
      "Tax | Prep (State): Business",
      "State Return (Business)",
    ],
  },
  {
    id: "tax-prep-1099-base",
    label: "1099 Preparation — Base",
    shortLabel: "1099 Base",
    serviceLine: "Tax",
    aliases: [
      "1099 Preparation Services (Per Form)",
      "TAX (1099 - Contractor Payments) | Base",
      "Tax | Prep (1099): Contractor Payments",
    ],
    patterns: [/\b1099\b.*\bbase\b/i],
  },
  {
    id: "tax-prep-1099-additional",
    label: "1099 Preparation — Additional Contractors",
    shortLabel: "1099 Add'l",
    serviceLine: "Tax",
    aliases: ["TAX (1099 - Contractor Pmts) | Additional Contractors"],
    patterns: [/\b1099\b.*additional/i],
  },

  // ── Tax — Planning / Compliance / Support ──────────────────────────
  {
    id: "tax-quarterly-estimates",
    label: "Quarterly Tax Estimates",
    shortLabel: "Quarterly Est.",
    serviceLine: "Tax",
    aliases: [
      "Quarterly Tax Estimates",
      "Tax | Quarterly Tax Estimates",
      "Quarterly Tax Estimate Calculations",
    ],
    patterns: [/quarterly.*tax.*estimate/i],
  },
  {
    id: "tax-planning-advisory",
    label: "Tax Planning & Advisory",
    shortLabel: "Tax Planning",
    serviceLine: "Tax",
    aliases: ["Tax Planning & Advisory", "Tax | Planning & Advisory"],
    patterns: [/tax\s*\|?\s*plan(ning)?\s*(&|and)?\s*advisor/i],
  },
  {
    id: "tax-rsu-estimates",
    label: "RSU Vest — Tax Estimates",
    shortLabel: "RSU Estimates",
    serviceLine: "Tax",
    aliases: ["RSU Vest - Tax Estimates"],
    patterns: [/\brsu\b/i],
  },
  {
    id: "tax-bi-annual-plan",
    label: "Bi-Annual Tax Plan",
    shortLabel: "Bi-Annual Plan",
    serviceLine: "Tax",
    aliases: ["Bi-Annual Tax Plan"],
  },
  {
    id: "tax-doc-organization",
    label: "Tax Document Organization & Analysis",
    shortLabel: "Doc Organization",
    serviceLine: "Tax",
    aliases: ["TAX | Document Organization & Analysis"],
    patterns: [/document\s*organization/i],
  },
  {
    id: "tax-review-assessment",
    label: "Tax Review & Assessment",
    shortLabel: "Tax Review",
    serviceLine: "Tax",
    aliases: ["Tax Review & Assessment", "Tax | Comprehensive Tax Assessment"],
    patterns: [/comprehensive\s*tax\s*assessment/i],
  },
  {
    id: "tax-irs-assistance",
    label: "IRS Assistance",
    shortLabel: "IRS",
    serviceLine: "Tax",
    aliases: [
      "IRS Assistance",
      "IRS Notice Assistance",
      "IRS Support | Request for Abatement",
      "Tax | IRS Support | Request for Abatement",
      "TAX | IRS Representation | Correspondence Audit Defense",
    ],
    patterns: [/\birs\b/i],
  },
  {
    id: "tax-local-filing",
    label: "Local County / City Tax Filing",
    shortLabel: "Local Filing",
    serviceLine: "Tax",
    aliases: ["Tax | Local County & City Tax Filing"],
    patterns: [/local\s*(county|city)\s*tax/i],
  },
  {
    id: "tax-compliance-annual-report",
    label: "Annual Report & Franchise Tax",
    shortLabel: "Annual Report",
    serviceLine: "Tax",
    aliases: [
      "Tax Compliance: Annual Report & Franchise Tax",
      "Compliance Filings: Annual Report",
    ],
    patterns: [/annual\s*report.*franchise\s*tax/i, /franchise\s*tax/i],
  },
  {
    id: "tax-audit-workers-comp",
    label: "Workers' Comp Audit Assistance",
    shortLabel: "WC Audit",
    serviceLine: "Tax",
    aliases: ["Tax | Audit Assistance | Workers Comp (Small Business)"],
    patterns: [/workers?\s*comp/i],
  },
  {
    id: "tax-advisory-stock-comp",
    label: "Stock Compensation Tax Advisory",
    shortLabel: "Stock Comp",
    serviceLine: "Tax",
    aliases: ["Tax Advisory: Stock Compensation Analysis"],
    patterns: [/stock\s*compensation/i],
  },

  // ── Accounting / Bookkeeping ───────────────────────────────────────
  {
    id: "bookkeeping-monthly",
    label: "Bookkeeping — Monthly",
    shortLabel: "BK Monthly",
    serviceLine: "Accounting",
    aliases: [
      "Bookkeeping (Monthly)",
      "Bookkeeping Services (Monthly)",
      "Accounting | Bookkeeping Services (Monthly)",
      "ACCT - Monthly Bookkeeping",
      "Accounting Services - Monthly Bookkeeping",
      "QBO/Bookkeeping Services",
    ],
    patterns: [/bookkeeping.*monthly/i, /monthly.*bookkeeping/i],
  },
  {
    id: "bookkeeping-quarterly",
    label: "Bookkeeping — Quarterly",
    shortLabel: "BK Quarterly",
    serviceLine: "Accounting",
    aliases: ["Bookkeeping (Quarterly)", "Bookkeeping Services (Quarterly)"],
    patterns: [/bookkeeping.*quarterly/i],
  },
  {
    id: "bookkeeping-onboarding",
    label: "Bookkeeping — Onboarding & Setup",
    shortLabel: "BK Onboarding",
    serviceLine: "Accounting",
    aliases: [
      "Bookkeeping (Onboarding)",
      "Bookkeeping | Onboarding & Optimization",
      "Bookkeeping Set Up & Optimization",
      "Accounting | Bookkeeping | Onboarding & Optimization",
    ],
    patterns: [/bookkeeping.*onboard/i, /bookkeeping.*set\s*up/i],
  },
  {
    id: "bookkeeping-cleanup",
    label: "Bookkeeping — Clean Up & Optimization",
    shortLabel: "BK Cleanup",
    serviceLine: "Accounting",
    aliases: [
      "Bookkeeping: Review, Clean Up & Optimization",
      "Accounting | Bookkeeping | Review, Clean Up & Optimization",
    ],
    patterns: [/bookkeeping.*(clean[-\s]?up|review)/i],
  },
  {
    id: "acct-reconciliations",
    label: "Account Reconciliations",
    shortLabel: "Reconciliations",
    serviceLine: "Accounting",
    aliases: ["Accounting | Account Reconciliations (Monthly)"],
    patterns: [/account\s*reconciliations?/i],
  },
  {
    id: "acct-payable",
    label: "Accounts Payable",
    shortLabel: "A/P",
    serviceLine: "Accounting",
    aliases: ["Accounts Payable", "Accounting | Accounts Payable"],
    patterns: [/accounts?\s*payable/i],
  },
  {
    id: "acct-qbo-subscription",
    label: "QuickBooks Online Subscription",
    shortLabel: "QBO Sub.",
    serviceLine: "Accounting",
    aliases: ["Quickbooks Subscription Fee (Monthly)"],
    patterns: [/quickbooks\s*subscription/i],
  },
  {
    id: "acct-software-setup",
    label: "Software Setup & Training",
    shortLabel: "Software Setup",
    serviceLine: "Accounting",
    aliases: ["Accounting | Software Setup & Training"],
    patterns: [/software\s*setup\s*(&|and)?\s*training/i],
  },
  {
    id: "acct-financial-reporting",
    label: "Financial & Management Reporting",
    shortLabel: "Reporting",
    serviceLine: "Accounting",
    aliases: ["Financial & Management Reporting"],
    patterns: [/financial\s*(&|and)?\s*management\s*reporting/i],
  },
  {
    id: "acct-controllership",
    label: "Controllership Advisory",
    shortLabel: "Controller",
    serviceLine: "Advisory",
    aliases: ["Accounting | Controllership Advisory"],
    patterns: [/controllership/i],
  },
  {
    id: "acct-business-valuation",
    label: "Business Valuation (Pre-409A)",
    shortLabel: "Valuation",
    serviceLine: "Advisory",
    aliases: [
      "Accounting | Business Valuation (Pre-409A): Growth",
      "Business Valuation",
    ],
    patterns: [/business\s*valuation/i, /\b409a\b/i],
  },

  // ── Payroll ────────────────────────────────────────────────────────
  {
    id: "payroll-biweekly",
    label: "Payroll — Bi-Weekly",
    shortLabel: "Payroll Bi-Wk",
    serviceLine: "Accounting",
    aliases: ["Payroll Services (Bi-Weekly)"],
    patterns: [/payroll.*bi[-\s]?weekly/i],
  },
  {
    id: "payroll-monthly",
    label: "Payroll — Monthly",
    shortLabel: "Payroll Mo.",
    serviceLine: "Accounting",
    aliases: ["Payroll Services (Monthly)"],
    patterns: [/payroll.*monthly/i],
  },
  {
    id: "payroll-general",
    label: "Payroll Services",
    shortLabel: "Payroll",
    serviceLine: "Accounting",
    aliases: ["Payroll Services", "Payroll & Compliance"],
    patterns: [/payroll(\s*&\s*compliance)?$/i],
  },
  {
    id: "payroll-setup",
    label: "Payroll — Setup & Onboarding",
    shortLabel: "Payroll Setup",
    serviceLine: "Accounting",
    aliases: ["Payroll Set Up & Onboarding", "Payroll | Set Up & Onboarding"],
    patterns: [/payroll.*set\s*up/i],
  },
  {
    id: "payroll-addl-employee",
    label: "Payroll — Additional Employee",
    shortLabel: "Payroll Add'l",
    serviceLine: "Accounting",
    aliases: ["Payroll: Additional Employee"],
    patterns: [/payroll.*additional\s*employee/i],
  },
  {
    id: "payroll-quarterly-filings",
    label: "Payroll — Quarterly Filings",
    shortLabel: "Payroll Q. Filings",
    serviceLine: "Accounting",
    aliases: [
      "Payroll Filings Services (Quarterly)",
      "Payroll | Quarterly Tax Filings Services",
    ],
    patterns: [/payroll.*quarterly.*filing/i],
  },

  // ── Advisory / Consulting / Entity ─────────────────────────────────
  {
    id: "advisory-retained-consulting",
    label: "Retained Consulting Services",
    shortLabel: "Retained",
    serviceLine: "Advisory",
    aliases: [
      "Retained Consulting Services",
      "Advisory | Retained Consulting Services",
      "ADVISORY | Retained Consulting Services (Associate)",
      "ADVISORY | Retained Consulting Services (Senior Associate)",
      "ADVISORY | Retained Consulting Services (Consulting Manager)",
      "ADVISORY | Retained Consulting Services (Director)",
      "ADVISORY | Retained Consulting Services (Partner / CFO)",
    ],
    patterns: [/retained\s*consulting/i],
  },
  {
    id: "advisory-corporate-restructure",
    label: "Corporate Restructure",
    shortLabel: "Restructure",
    serviceLine: "Advisory",
    aliases: [
      "Advisory | Corporate Restructure",
      "Advisory | Restructuring Services",
      "Advisory | Entity Services | Entity Restructuring & State Re-Domestication",
    ],
    patterns: [/corporate\s*restructur/i, /restructuring\s*services/i],
  },
  {
    id: "advisory-business-acquisition",
    label: "Business Acquisition Due Diligence",
    shortLabel: "Acquisition",
    serviceLine: "Advisory",
    aliases: ["Business Acquisition | Due Diligence Support"],
    patterns: [/business\s*acquisition/i, /due\s*diligence/i],
  },
  {
    id: "advisory-registered-agent",
    label: "Registered Agent Services",
    shortLabel: "Reg. Agent",
    serviceLine: "Advisory",
    aliases: [
      "Registered Agent Services",
      "Advisory | Registered Agent Services",
    ],
    patterns: [/registered\s*agent/i],
  },
  {
    id: "advisory-cpa-verification",
    label: "CPA Verification Letter",
    shortLabel: "CPA Letter",
    serviceLine: "Advisory",
    aliases: [
      "ACCT | CPA Verification (Expedition)",
      "ACCT | CPA Verification Letter (Expedited)",
      "ACCT | CPA Verification Letter",
      "CPA Verification Letter",
    ],
    patterns: [/cpa\s*verification/i],
  },
  {
    id: "advisory-entity-formation-smllc",
    label: "Entity Formation — Single Member LLC",
    shortLabel: "SMLLC",
    serviceLine: "Advisory",
    aliases: [
      "Entity Formation | Single Member LLC",
      "Advisory | Entity Formation | Single Member LLC",
    ],
    patterns: [/single\s*member\s*llc/i],
  },
  {
    id: "advisory-entity-formation-mmllc",
    label: "Entity Formation — Multi-Member LLC",
    shortLabel: "MMLLC",
    serviceLine: "Advisory",
    aliases: ["Advisory | Entity Formation | Multi-Member LLC"],
    patterns: [/multi[-\s]?member\s*llc/i],
  },
  {
    id: "advisory-entity-formation-scorp",
    label: "Entity Formation — S-Corp",
    shortLabel: "S-Corp Formation",
    serviceLine: "Advisory",
    aliases: ["Advisory | Entity Formation | S-Corporation (1120s)"],
    patterns: [/entity\s*formation.*s[-\s]?corp/i],
  },
  {
    id: "advisory-entity-state-fees",
    label: "State Filing Fees (Reimbursement)",
    shortLabel: "State Fees",
    serviceLine: "Advisory",
    aliases: [
      "Reimbursement | Entity Formation - State Filing Fees",
      "Advisory | Entity Formation | State Filing Fees",
    ],
    patterns: [/state\s*filing\s*fees/i],
  },
  {
    id: "advisory-budgeting-forecasting",
    label: "Budgeting & Forecasting",
    shortLabel: "Forecasting",
    serviceLine: "Advisory",
    aliases: [
      "Budgeting & Forecasting Services",
      "Advisory | Custom Budget Plan",
    ],
    patterns: [/budgeting\s*(&|and)?\s*forecasting/i, /custom\s*budget/i],
  },
  {
    id: "advisory-financial-forecast",
    label: "Financial Statement Forecast",
    shortLabel: "FS Forecast",
    serviceLine: "Advisory",
    aliases: [
      "Financial Statement Forecast (Basic)",
      "Financial Statement Forecast (Comprehensive)",
      "Accounting | Financial Statement Forecast (Basic)",
      "Accounting | Financial Statement Forecast (Standard)",
      "Accounting | Financial Statement Forecast (Investor Grade)",
    ],
    patterns: [/financial\s*statement\s*forecast/i],
  },
  {
    id: "advisory-virtual-cfo",
    label: "Virtual CFO Services",
    shortLabel: "vCFO",
    serviceLine: "Advisory",
    aliases: ["Virtual CFO Services"],
    patterns: [/\bvirtual\s*cfo\b/i, /\bvcfo\b/i],
  },
  {
    id: "advisory-mottaguard",
    label: "MottaGuard Compliance",
    shortLabel: "MottaGuard",
    serviceLine: "Advisory",
    aliases: ["MottaGuard Compliance Services"],
    patterns: [/mottaguard/i],
  },

  // ── Other ──────────────────────────────────────────────────────────
  {
    id: "payment-plan",
    label: "Payment Plan",
    shortLabel: "Payment Plan",
    serviceLine: "Other",
    aliases: ["Payment Plan"],
  },
  {
    id: "rental-payment",
    label: "Rental Payment",
    shortLabel: "Rental",
    serviceLine: "Other",
    aliases: ["Rental Payment (The Dat Cave LLC)"],
    patterns: [/rental\s*payment/i],
  },
]

// ── Lookup tables (built once at module load) ─────────────────────────

/** id → record. */
const BY_ID = new Map<CanonicalServiceId, CanonicalService>(
  CANONICAL_SERVICES.map((s) => [s.id, s] as const),
)

/**
 * lower(trimmed alias) → canonical id. Built at module load. We normalize
 * the alias key the same way we'll normalize input names so matching is
 * O(1) regardless of catalog size.
 */
const BY_ALIAS = new Map<string, CanonicalServiceId>()
for (const svc of CANONICAL_SERVICES) {
  for (const alias of svc.aliases) {
    BY_ALIAS.set(normalizeKey(alias), svc.id)
  }
}

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

// ── Public API ────────────────────────────────────────────────────────

export interface ResolvedService {
  /** Canonical id, or the original name (lowered/trimmed) if no match. */
  id: string
  /** Display label. The canonical label when matched, else the original. */
  label: string
  serviceLine: ServiceLine
  /** True only when an exact alias or pattern matched a canonical entry. */
  isCanonical: boolean
  /** The matching canonical record, or null if unmatched. */
  canonical: CanonicalService | null
}

/**
 * Resolve any raw service name to its canonical record. Falls back to a
 * synthetic "unknown" record (using the keyword classifier for the
 * service line) so callers always get *something* renderable.
 *
 * Pass an optional `classifier` to inject the line lookup — defaults to
 * the project's `classifyService` from service-line-classifier. The
 * indirection avoids a circular import between these two modules.
 */
export function resolveService(
  rawName: string | null | undefined,
  classifier?: (name: string) => ServiceLine,
): ResolvedService {
  const name = (rawName || "").trim()
  if (!name) {
    return {
      id: "unknown",
      label: "Unknown",
      serviceLine: "Other",
      isCanonical: false,
      canonical: null,
    }
  }

  const key = normalizeKey(name)

  // Step 1: exact alias match
  const aliased = BY_ALIAS.get(key)
  if (aliased) {
    const canonical = BY_ID.get(aliased)!
    return {
      id: canonical.id,
      label: canonical.label,
      serviceLine: canonical.serviceLine,
      isCanonical: true,
      canonical,
    }
  }

  // Step 2: pattern match
  for (const svc of CANONICAL_SERVICES) {
    if (!svc.patterns) continue
    for (const re of svc.patterns) {
      if (re.test(name)) {
        return {
          id: svc.id,
          label: svc.label,
          serviceLine: svc.serviceLine,
          isCanonical: true,
          canonical: svc,
        }
      }
    }
  }

  // Step 3: synthetic fallback. We deliberately key by lower-cased name so
  // "Schedule X: foo" and "Schedule X: foo " collapse to the same bucket
  // even when no canonical record exists yet.
  return {
    id: `raw:${key}`,
    label: name,
    serviceLine: classifier ? classifier(name) : "Other",
    isCanonical: false,
    canonical: null,
  }
}

/**
 * Returns the canonical id for a name, or null if no canonical match
 * exists. Useful when you want to ignore unknowns rather than carry a
 * `raw:…` synthetic bucket.
 */
export function canonicalIdFor(name: string | null | undefined): CanonicalServiceId | null {
  if (!name) return null
  const aliased = BY_ALIAS.get(normalizeKey(name))
  if (aliased) return aliased
  for (const svc of CANONICAL_SERVICES) {
    if (!svc.patterns) continue
    for (const re of svc.patterns) {
      if (re.test(name)) return svc.id
    }
  }
  return null
}

/**
 * Lookup by id. Returns null for ids not in the catalog (including
 * `raw:…` synthetics from `resolveService`).
 */
export function getCanonicalService(
  id: string | null | undefined,
): CanonicalService | null {
  if (!id) return null
  return BY_ID.get(id as CanonicalServiceId) ?? null
}

/** All canonical services as array, in catalog order. */
export function listCanonicalServices(): CanonicalService[] {
  return CANONICAL_SERVICES
}

/** Filter to a single service line. */
export function listCanonicalByLine(line: ServiceLine): CanonicalService[] {
  return CANONICAL_SERVICES.filter((s) => s.serviceLine === line)
}
