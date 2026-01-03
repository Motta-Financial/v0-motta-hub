import { convertToModelMessages, streamText, tool, type UIMessage } from "ai"
import { z } from "zod"
import { createClient } from "@supabase/supabase-js"

export const maxDuration = 60

// Initialize Supabase client with service role for full access
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Define all the tools ALFRED has access to
const alfredTools = {
  // Query any Supabase table
  queryDatabase: tool({
    description: `Query any table in the Motta Hub database. Available tables include:
    - team_members: Staff information (id, full_name, email, role, department, is_active)
    - clients/contacts: Client contact information
    - organizations: Business/organization records
    - work_items: Karbon work items (title, status, due_date, assignee_name, client_group_name, tax_year)
    - debriefs: Meeting debriefs and notes
    - tasks: Team tasks and assignments
    - invoices: Client invoices
    - time_entries: Time tracking records
    - meetings: Scheduled meetings
    - meeting_notes: Notes from client meetings
    - notifications: User notifications
    - services: Available services with pricing
    - tax_returns: Tax return records
    - karbon_notes, karbon_tasks, karbon_timesheets: Karbon synced data
    - tommy_award_ballots, tommy_award_points: Tommy Awards data
    - work_status: Work item statuses
    Use this to answer questions about clients, work items, team members, finances, etc.`,
    inputSchema: z.object({
      table: z.string().describe("The table name to query"),
      select: z.string().optional().describe("Columns to select, defaults to *"),
      filters: z
        .array(
          z.object({
            column: z.string(),
            operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"]),
            value: z.any(),
          }),
        )
        .optional()
        .describe("Filters to apply"),
      orderBy: z
        .object({
          column: z.string(),
          ascending: z.boolean().optional(),
        })
        .optional()
        .describe("Column to order by"),
      limit: z.number().optional().describe("Maximum number of rows to return"),
    }),
    execute: async ({ table, select = "*", filters = [], orderBy, limit = 50 }) => {
      try {
        let query = supabase.from(table).select(select)

        for (const filter of filters) {
          if (filter.operator === "eq") query = query.eq(filter.column, filter.value)
          else if (filter.operator === "neq") query = query.neq(filter.column, filter.value)
          else if (filter.operator === "gt") query = query.gt(filter.column, filter.value)
          else if (filter.operator === "gte") query = query.gte(filter.column, filter.value)
          else if (filter.operator === "lt") query = query.lt(filter.column, filter.value)
          else if (filter.operator === "lte") query = query.lte(filter.column, filter.value)
          else if (filter.operator === "like") query = query.like(filter.column, filter.value)
          else if (filter.operator === "ilike") query = query.ilike(filter.column, filter.value)
          else if (filter.operator === "is") query = query.is(filter.column, filter.value)
          else if (filter.operator === "in") query = query.in(filter.column, filter.value)
        }

        if (orderBy) {
          query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true })
        }

        query = query.limit(limit)

        const { data, error } = await query

        if (error) {
          return { success: false, error: error.message }
        }

        return { success: true, data, count: data?.length || 0 }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),

  // Get database statistics and counts
  getDatabaseStats: tool({
    description: "Get counts and statistics from various tables to understand overall business metrics",
    inputSchema: z.object({
      tables: z.array(z.string()).describe("Tables to get counts for"),
    }),
    execute: async ({ tables }) => {
      const stats: Record<string, number> = {}

      for (const table of tables) {
        try {
          const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true })

          if (!error && count !== null) {
            stats[table] = count
          }
        } catch (e) {
          stats[table] = -1
        }
      }

      return { success: true, stats }
    },
  }),

  // Search across multiple tables
  searchAcrossTables: tool({
    description:
      "Search for a term across multiple tables - useful for finding clients, work items, or team members by name",
    inputSchema: z.object({
      searchTerm: z.string().describe("The term to search for"),
      tables: z
        .array(
          z.object({
            name: z.string(),
            searchColumns: z.array(z.string()),
          }),
        )
        .describe("Tables and columns to search"),
    }),
    execute: async ({ searchTerm, tables }) => {
      const results: Record<string, any[]> = {}

      for (const table of tables) {
        try {
          const orConditions = table.searchColumns.map((col) => `${col}.ilike.%${searchTerm}%`).join(",")

          const { data, error } = await supabase.from(table.name).select("*").or(orConditions).limit(10)

          if (!error && data) {
            results[table.name] = data
          }
        } catch (e) {
          results[table.name] = []
        }
      }

      return { success: true, results }
    },
  }),

  // Get work items summary
  getWorkItemsSummary: tool({
    description: "Get a summary of work items by status, assignee, or client",
    inputSchema: z.object({
      groupBy: z.enum(["status", "assignee_name", "client_group_name", "work_type"]).optional(),
      filters: z
        .object({
          status: z.string().optional(),
          assignee_name: z.string().optional(),
          tax_year: z.number().optional(),
        })
        .optional(),
    }),
    execute: async ({ groupBy, filters = {} }) => {
      try {
        let query = supabase.from("work_items").select("*")

        if (filters.status) query = query.eq("status", filters.status)
        if (filters.assignee_name) query = query.ilike("assignee_name", `%${filters.assignee_name}%`)
        if (filters.tax_year) query = query.eq("tax_year", filters.tax_year)

        const { data, error } = await query.limit(500)

        if (error) {
          return { success: false, error: error.message }
        }

        if (groupBy && data) {
          const grouped: Record<string, number> = {}
          for (const item of data) {
            const key = item[groupBy] || "Unknown"
            grouped[key] = (grouped[key] || 0) + 1
          }
          return { success: true, summary: grouped, total: data.length }
        }

        return { success: true, data, total: data?.length || 0 }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),

  // Get team member workload
  getTeamWorkload: tool({
    description: "Get workload information for team members - how many work items each person has",
    inputSchema: z.object({
      teamMemberId: z.string().optional().describe("Specific team member ID, or leave empty for all"),
      includeCompleted: z.boolean().optional().describe("Include completed work items"),
    }),
    execute: async ({ teamMemberId, includeCompleted = false }) => {
      try {
        let query = supabase.from("work_items").select("assignee_name, status, due_date, title")

        if (!includeCompleted) {
          query = query.not("status", "in", '("Completed","Cancelled")')
        }

        const { data, error } = await query

        if (error) {
          return { success: false, error: error.message }
        }

        // Group by assignee
        const workload: Record<string, { total: number; overdue: number; upcoming: number }> = {}
        const today = new Date().toISOString().split("T")[0]

        for (const item of data || []) {
          const assignee = item.assignee_name || "Unassigned"
          if (!workload[assignee]) {
            workload[assignee] = { total: 0, overdue: 0, upcoming: 0 }
          }
          workload[assignee].total++

          if (item.due_date) {
            if (item.due_date < today) {
              workload[assignee].overdue++
            } else {
              workload[assignee].upcoming++
            }
          }
        }

        return { success: true, workload }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),

  // Get client information
  getClientInfo: tool({
    description: "Get detailed information about a specific client or organization",
    inputSchema: z.object({
      searchTerm: z.string().describe("Client name or partial name to search"),
      includeWorkItems: z.boolean().optional().describe("Include associated work items"),
      includeContacts: z.boolean().optional().describe("Include associated contacts"),
    }),
    execute: async ({ searchTerm, includeWorkItems = true, includeContacts = true }) => {
      try {
        // Search client groups
        const { data: clientGroups } = await supabase
          .from("client_groups")
          .select("*")
          .ilike("name", `%${searchTerm}%`)
          .limit(5)

        // Search organizations
        const { data: organizations } = await supabase
          .from("organizations")
          .select("*")
          .ilike("name", `%${searchTerm}%`)
          .limit(5)

        // Search contacts
        const { data: contacts } = await supabase
          .from("contacts")
          .select("*")
          .or(`full_name.ilike.%${searchTerm}%,primary_email.ilike.%${searchTerm}%`)
          .limit(5)

        let workItems: any[] = []
        if (includeWorkItems && clientGroups && clientGroups.length > 0) {
          const { data: items } = await supabase
            .from("work_items")
            .select("*")
            .ilike("client_group_name", `%${searchTerm}%`)
            .limit(20)
          workItems = items || []
        }

        return {
          success: true,
          clientGroups: clientGroups || [],
          organizations: organizations || [],
          contacts: contacts || [],
          workItems,
        }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),

  // Get upcoming deadlines
  getUpcomingDeadlines: tool({
    description: "Get work items with upcoming deadlines",
    inputSchema: z.object({
      days: z.number().optional().describe("Number of days to look ahead, default 7"),
      assignee: z.string().optional().describe("Filter by assignee name"),
    }),
    execute: async ({ days = 7, assignee }) => {
      try {
        const today = new Date()
        const futureDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000)

        let query = supabase
          .from("work_items")
          .select("*")
          .gte("due_date", today.toISOString().split("T")[0])
          .lte("due_date", futureDate.toISOString().split("T")[0])
          .not("status", "in", '("Completed","Cancelled")')
          .order("due_date", { ascending: true })

        if (assignee) {
          query = query.ilike("assignee_name", `%${assignee}%`)
        }

        const { data, error } = await query.limit(50)

        if (error) {
          return { success: false, error: error.message }
        }

        return { success: true, deadlines: data, count: data?.length || 0 }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),

  // Get recent activity
  getRecentActivity: tool({
    description: "Get recent activity including debriefs, meeting notes, and tasks",
    inputSchema: z.object({
      days: z.number().optional().describe("Number of days to look back, default 7"),
      type: z.enum(["debriefs", "meeting_notes", "tasks", "all"]).optional(),
    }),
    execute: async ({ days = 7, type = "all" }) => {
      try {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
        const results: Record<string, any[]> = {}

        if (type === "all" || type === "debriefs") {
          const { data } = await supabase
            .from("debriefs")
            .select("*")
            .gte("created_at", cutoffDate)
            .order("created_at", { ascending: false })
            .limit(20)
          results.debriefs = data || []
        }

        if (type === "all" || type === "meeting_notes") {
          const { data } = await supabase
            .from("meeting_notes")
            .select("*")
            .gte("created_at", cutoffDate)
            .order("created_at", { ascending: false })
            .limit(20)
          results.meeting_notes = data || []
        }

        if (type === "all" || type === "tasks") {
          const { data } = await supabase
            .from("tasks")
            .select("*")
            .gte("created_at", cutoffDate)
            .order("created_at", { ascending: false })
            .limit(20)
          results.tasks = data || []
        }

        return { success: true, activity: results }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),

  // Get Tommy Awards leaderboard
  getTommyAwardsLeaderboard: tool({
    description: "Get the Tommy Awards leaderboard and points standings",
    inputSchema: z.object({
      year: z.number().optional().describe("Year for the leaderboard, defaults to current year"),
    }),
    execute: async ({ year = new Date().getFullYear() }) => {
      try {
        const { data, error } = await supabase
          .from("tommy_award_yearly_totals")
          .select("*")
          .eq("year", year)
          .order("total_points", { ascending: false })
          .limit(20)

        if (error) {
          return { success: false, error: error.message }
        }

        return { success: true, leaderboard: data }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),

  // Get services and pricing
  getServices: tool({
    description: "Get available services and their pricing information",
    inputSchema: z.object({
      category: z.string().optional().describe("Filter by service category"),
      searchTerm: z.string().optional().describe("Search services by name"),
    }),
    execute: async ({ category, searchTerm }) => {
      try {
        let query = supabase.from("services").select("*")

        if (category) {
          query = query.eq("category", category)
        }

        if (searchTerm) {
          query = query.ilike("name", `%${searchTerm}%`)
        }

        const { data, error } = await query.order("name").limit(50)

        if (error) {
          return { success: false, error: error.message }
        }

        return { success: true, services: data }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),

  // Get financial summary
  getFinancialSummary: tool({
    description: "Get financial summary including invoices and recurring revenue",
    inputSchema: z.object({
      period: z.enum(["month", "quarter", "year"]).optional(),
    }),
    execute: async ({ period = "month" }) => {
      try {
        // Get invoice totals
        const { data: invoices } = await supabase
          .from("invoices")
          .select("total_amount, amount_paid, status, invoice_date")

        // Get recurring revenue
        const { data: recurring } = await supabase
          .from("recurring_revenue")
          .select("monthly_amount, annual_amount, is_active")
          .eq("is_active", true)

        const totalInvoiced = invoices?.reduce((sum, inv) => sum + (inv.total_amount || 0), 0) || 0
        const totalPaid = invoices?.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0) || 0
        const monthlyRecurring = recurring?.reduce((sum, r) => sum + (r.monthly_amount || 0), 0) || 0
        const annualRecurring = recurring?.reduce((sum, r) => sum + (r.annual_amount || 0), 0) || 0

        return {
          success: true,
          summary: {
            totalInvoiced,
            totalPaid,
            outstanding: totalInvoiced - totalPaid,
            monthlyRecurringRevenue: monthlyRecurring,
            annualRecurringRevenue: annualRecurring,
            invoiceCount: invoices?.length || 0,
          },
        }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  }),
}

// System prompt for ALFRED
const SYSTEM_PROMPT = `You are ALFRED, the AI assistant for Motta Hub - Motta Financial's internal business management platform. You have full access to the company's database and can help team members with:

1. **Client Information**: Look up clients, their contact details, work history, and associated work items
2. **Work Items**: Find, filter, and summarize work items by status, assignee, due date, tax year, etc.
3. **Team Management**: View team workload, assignments, and capacity
4. **Deadlines & Tasks**: Track upcoming deadlines, overdue items, and task assignments
5. **Financial Data**: Access invoice information, recurring revenue, and billing details
6. **Meeting Notes & Debriefs**: Review recent client meetings and debrief notes
7. **Tommy Awards**: Check the leaderboard and recognition program standings
8. **Services**: Look up service offerings and pricing

When answering questions:
- Be concise but thorough
- Use the appropriate tools to query data before responding
- Format numbers and dates clearly
- If you need more context, ask clarifying questions
- Always protect sensitive information (don't expose SSNs, full EINs, etc.)
- When showing lists, summarize key information rather than dumping raw data

You work for Motta Financial, a San Francisco-based CPA firm specializing in tax, accounting, and advisory services.`

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: "openai/gpt-4o",
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools: alfredTools,
    maxSteps: 10,
    abortSignal: req.signal,
  })

  return result.toUIMessageStreamResponse()
}
