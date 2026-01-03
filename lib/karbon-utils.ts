/**
 * Utility functions for Karbon integration
 */

const KARBON_FIRM_ID = "4mTyp9lLRWTC"

/**
 * Generate a direct link to a Karbon work item
 * @param workItemKey - The WorkItemKey from Karbon API
 * @returns URL to the work item in Karbon web app
 */
export function getKarbonWorkItemUrl(workItemKey: string): string {
  return `https://app2.karbonhq.com/${KARBON_FIRM_ID}#/work/${workItemKey}`
}

/**
 * Generate a direct link to a Karbon contact
 * @param contactKey - The ContactKey from Karbon API
 * @returns URL to the contact in Karbon web app
 */
export function getKarbonContactUrl(contactKey: string): string {
  return `https://app2.karbonhq.com/${KARBON_FIRM_ID}#/contacts/${contactKey}`
}

/**
 * Generate a direct link to a Karbon client
 * @param clientKey - The ClientKey from Karbon API
 * @returns URL to the client in Karbon web app
 */
export function getKarbonClientUrl(clientKey: string): string {
  return `https://app2.karbonhq.com/${KARBON_FIRM_ID}#/clients/${clientKey}`
}

/**
 * Generate a direct link to a Karbon task
 */
export function getKarbonTaskUrl(taskKey: string): string {
  return `https://app2.karbonhq.com/${KARBON_FIRM_ID}#/tasks/${taskKey}`
}

/**
 * Generate a direct link to a Karbon client group
 */
export function getKarbonClientGroupUrl(clientGroupKey: string): string {
  return `https://app2.karbonhq.com/${KARBON_FIRM_ID}#/client-groups/${clientGroupKey}`
}

/**
 * Generate a direct link to a Karbon note
 */
export function getKarbonNoteUrl(noteKey: string): string {
  return `https://app2.karbonhq.com/${KARBON_FIRM_ID}#/notes/${noteKey}`
}

/**
 * All available Karbon work item statuses
 */
export const KARBON_WORK_STATUSES = ["Ready To Start", "Planned", "In Progress", "Waiting", "Complete"] as const

export type KarbonWorkStatus = (typeof KARBON_WORK_STATUSES)[number]

export const KARBON_PRIMARY_STATUSES = ["Not Started", "In Progress", "Waiting", "Completed", "Cancelled"] as const

export type KarbonPrimaryStatus = (typeof KARBON_PRIMARY_STATUSES)[number]

export const KARBON_WORK_TYPES = {
  // Tax-related
  TAX_RETURN: "Tax Return",
  TAX_PLANNING: "Tax Planning",
  TAX_ESTIMATES: "Tax Estimates",
  TAX_ADVISORY: "Tax Advisory",
  IRS_NOTICE: "IRS Notice",
  TAX_RESOLUTION: "Tax Resolution",
  // Accounting
  BOOKKEEPING: "Bookkeeping",
  PAYROLL: "Payroll",
  FINANCIAL_STATEMENTS: "Financial Statements",
  // Advisory
  ADVISORY: "Advisory",
  CONSULTING: "Consulting",
  AUDIT: "Audit",
  // Other
  ONBOARDING: "Onboarding",
  ADMIN: "Admin",
} as const

export type KarbonWorkType = (typeof KARBON_WORK_TYPES)[keyof typeof KARBON_WORK_TYPES]

export function filterWorkItemsByType(workItems: any[], workTypes: string[]): any[] {
  const normalizedTypes = workTypes.map((t) => t.toLowerCase())
  return workItems.filter((item) => {
    const itemType = (item.WorkType || "").toLowerCase()
    return normalizedTypes.some((type) => itemType.includes(type))
  })
}

export function getTaxSectionWorkItems(workItems: any[], section: string): any[] {
  const sectionMapping: Record<string, string[]> = {
    estimates: ["estimate", "quarterly"],
    planning: ["planning", "projection", "strategy"],
    returns: ["return", "1040", "1120", "1065", "990"],
    advisory: ["advisory", "consultation", "ad hoc", "adhoc"],
    "irs-notices": ["irs", "notice", "resolution", "audit"],
  }

  const keywords = sectionMapping[section] || []

  return workItems.filter((item) => {
    const title = (item.Title || "").toLowerCase()
    const workType = (item.WorkType || "").toLowerCase()
    return keywords.some((keyword) => title.includes(keyword) || workType.includes(keyword))
  })
}

export function isOverdue(dueDate: string | undefined): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

export function getDaysUntilDue(dueDate: string | undefined): number | null {
  if (!dueDate) return null
  const due = new Date(dueDate)
  const now = new Date()
  const diffTime = due.getTime() - now.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

export function formatDueDate(dueDate: string | undefined): string {
  if (!dueDate) return "No due date"
  const days = getDaysUntilDue(dueDate)
  if (days === null) return "No due date"
  if (days < 0) return `${Math.abs(days)} days overdue`
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  if (days <= 7) return `Due in ${days} days`
  return new Date(dueDate).toLocaleDateString()
}
