/**
 * Utility functions for Karbon integration
 */

/**
 * Generate a direct link to a Karbon work item
 * @param workItemKey - The WorkItemKey from Karbon API
 * @returns URL to the work item in Karbon web app
 */
export function getKarbonWorkItemUrl(workItemKey: string): string {
  return `https://app.karbonhq.com/work/${workItemKey}`
}

/**
 * Generate a direct link to a Karbon contact
 * @param contactKey - The ContactKey from Karbon API
 * @returns URL to the contact in Karbon web app
 */
export function getKarbonContactUrl(contactKey: string): string {
  return `https://app.karbonhq.com/contacts/${contactKey}`
}

/**
 * All available Karbon work item statuses
 */
export const KARBON_WORK_STATUSES = ["Ready To Start", "Planned", "In Progress", "Waiting", "Complete"] as const

export type KarbonWorkStatus = (typeof KARBON_WORK_STATUSES)[number]
