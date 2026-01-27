/**
 * Karbon API Client
 * Centralized client for all Karbon API interactions
 */

const KARBON_BASE_URL = "https://api.karbonhq.com/v3"

export interface KarbonApiConfig {
  accessKey: string
  bearerToken: string
}

export interface ODataQueryOptions {
  filter?: string
  select?: string[]
  expand?: string[]
  orderby?: string
  top?: number
  skip?: number
}

/**
 * Get Karbon API credentials from environment
 */
export function getKarbonCredentials(): KarbonApiConfig | null {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return null
  }

  return { accessKey, bearerToken }
}

/**
 * Build OData query string from options
 */
export function buildODataQuery(options: ODataQueryOptions): string {
  const params: string[] = []

  if (options.filter) {
    params.push(`$filter=${encodeURIComponent(options.filter)}`)
  }
  if (options.select && options.select.length > 0) {
    params.push(`$select=${options.select.join(",")}`)
  }
  if (options.expand && options.expand.length > 0) {
    params.push(`$expand=${options.expand.join(",")}`)
  }
  if (options.orderby) {
    params.push(`$orderby=${encodeURIComponent(options.orderby)}`)
  }
  if (options.top !== undefined) {
    params.push(`$top=${options.top}`)
  }
  if (options.skip !== undefined) {
    params.push(`$skip=${options.skip}`)
  }

  return params.length > 0 ? `?${params.join("&")}` : ""
}

/**
 * Make a request to the Karbon API
 */
export async function karbonFetch<T>(
  endpoint: string,
  config: KarbonApiConfig,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
    body?: any
    queryOptions?: ODataQueryOptions
    timeout?: number
  } = {},
): Promise<{ data: T | null; error: string | null; nextLink?: string; count?: number }> {
  const { method = "GET", body, queryOptions, timeout = 30000 } = options

  const queryString = queryOptions ? buildODataQuery(queryOptions) : ""
  const url = `${KARBON_BASE_URL}${endpoint}${queryString}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      method,
      headers: {
        AccessKey: config.accessKey,
        Authorization: `Bearer ${config.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Karbon API] Error ${response.status}:`, errorText)
      return { data: null, error: `${response.status}: ${response.statusText}` }
    }

    const data = await response.json()
    return {
      data: data.value !== undefined ? data.value : data,
      error: null,
      nextLink: data["@odata.nextLink"],
      count: data["@odata.count"],
    }
  } catch (error) {
    console.error("[Karbon API] Fetch error:", error)
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Fetch all pages of a paginated endpoint
 */
export async function karbonFetchAll<T>(
  endpoint: string,
  config: KarbonApiConfig,
  queryOptions?: ODataQueryOptions,
  maxPages = 50,
): Promise<{ data: T[]; error: string | null; totalCount?: number }> {
  const allItems: T[] = []
  let nextUrl: string | null = `${KARBON_BASE_URL}${endpoint}${queryOptions ? buildODataQuery(queryOptions) : ""}`
  let totalCount: number | undefined
  let pageCount = 0

  while (nextUrl && pageCount < maxPages) {
    pageCount++

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const response = await fetch(nextUrl, {
        method: "GET",
        headers: {
          AccessKey: config.accessKey,
          Authorization: `Bearer ${config.bearerToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        // For 404 errors, return empty array gracefully (common for Tasks/Notes endpoints)
        if (response.status === 404) {
          return { data: [], error: null, totalCount: 0 }
        }
        // Try to get error text but don't throw
        let errorText = ""
        try {
          errorText = await response.text()
        } catch {
          // Ignore error reading body
        }
        if (allItems.length > 0) {
          console.warn(`[Karbon API] Error on page ${pageCount}, returning partial data`)
          break
        }
        return { data: [], error: `${response.status}: ${response.statusText}` }
      }

      const data = await response.json()
      const pageItems = data.value || []
      allItems.push(...pageItems)

      if (totalCount === undefined) {
        totalCount = data["@odata.count"]
      }

      nextUrl = data["@odata.nextLink"] || null
    } catch (error) {
      // Check if it's a 404 error (common for Tasks/Notes endpoints that don't exist)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes("404") || errorMessage.includes("not found") || errorMessage.includes("Resource")) {
        return { data: [], error: null }
      }
      
      if (allItems.length > 0) {
        console.warn(`[Karbon API] Error on page ${pageCount}, returning partial data`)
        break
      }
      return {
        data: [],
        error: errorMessage,
      }
    }
  }

  return { data: allItems, error: null, totalCount }
}

// WorkType constants for filtering
export const KARBON_WORK_TYPES = {
  TAX_RETURN: "Tax Return",
  TAX_PLANNING: "Tax Planning",
  TAX_ESTIMATES: "Tax Estimates",
  TAX_ADVISORY: "Tax Advisory",
  IRS_NOTICE: "IRS Notice",
  TAX_RESOLUTION: "Tax Resolution",
  BOOKKEEPING: "Bookkeeping",
  PAYROLL: "Payroll",
  ADVISORY: "Advisory",
  AUDIT: "Audit",
  CONSULTING: "Consulting",
} as const

export type KarbonWorkType = (typeof KARBON_WORK_TYPES)[keyof typeof KARBON_WORK_TYPES]

// Primary Status constants
export const KARBON_PRIMARY_STATUSES = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  WAITING: "Waiting",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
} as const

export type KarbonPrimaryStatus = (typeof KARBON_PRIMARY_STATUSES)[keyof typeof KARBON_PRIMARY_STATUSES]

export const TAX_RETURN_WORK_TYPES = [
  "Tax | 709 (Gift)",
  "TAX | C-Corp (1120)",
  "TAX | Individual (1040)",
  "TAX | Individual (1040c)",
  "TAX | Non-Profit & Exempt (990)",
  "TAX | Partnership (1065)",
  "Tax | S-Corp (1120S)",
  "TAX | Trusts & Estates",
] as const

export type TaxReturnWorkType = (typeof TAX_RETURN_WORK_TYPES)[number]

// Helper to check if a work type is a tax return type
export function isTaxReturnWorkType(workType: string): boolean {
  return TAX_RETURN_WORK_TYPES.some((type) => type.toLowerCase() === workType.toLowerCase())
}
