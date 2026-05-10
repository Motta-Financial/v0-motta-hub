import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/server"
import { browsePageTool, webSearchTool } from "@/lib/alfred/tools"
import {
  ALLOWED_TABLES,
  buildTableCatalog,
  isAllowedTable,
} from "@/lib/alfred/allowed-tables"
import { getAlfredServiceAccount } from "@/lib/alfred/service-account"
import { resolveAlfredUser, type ResolvedAlfredUser } from "@/lib/alfred/resolve-user"
import { applyAlfredCors, preflightResponse } from "@/lib/alfred/cors"
import { buildPolicy, type Audience } from "@/lib/alfred/policy"

// Shape of the requesting user, sent from the client transport body.
// See components/alfred-chat.tsx for the producer side.
interface CurrentUser {
  teamMemberId: string
  fullName: string | null
  email: string
  role: string | null
  department: string | null
  karbonUserKey: string | null
}

export const maxDuration = 60

// Define all the tools ALFRED has access to
const alfredTools = {
  // Query any Supabase table
  queryDatabase: tool({
    // Catalog is built from the shared ALLOWED_TABLES list so this stays
    // automatically in sync with /api/alfred/data. Adding a new table to
    // lib/alfred/allowed-tables.ts surfaces it here on the next deploy.
    description: `Query any table in the Motta Hub database. Available tables:
${buildTableCatalog()}

Use this to answer questions about clients, work items, team members, finances, etc. Pass exactly one of the table names above as \`table\`. Unknown table names will be rejected.`,
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
      // Runtime allow-list enforcement. The model has occasionally
      // hallucinated table names (e.g. "clients", "users") that don't
      // exist in the schema; rejecting here gives it a clear corrective
      // signal instead of a generic Postgres "relation does not exist".
      if (!isAllowedTable(table)) {
        return {
          success: false,
          error:
            `Table "${table}" is not in the ALFRED allow-list. ` +
            `Choose one of: ${ALLOWED_TABLES.join(", ")}.`,
        }
      }

      try {
        const supabase = createAdminClient()
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
      const supabase = createAdminClient()
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
      const supabase = createAdminClient()
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
        const supabase = createAdminClient()
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
        const supabase = createAdminClient()
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
        const supabase = createAdminClient()
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
        const supabase = createAdminClient()
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
    description: "Get recent activity including debriefs and tasks",
    inputSchema: z.object({
      days: z.number().optional().describe("Number of days to look back, default 7"),
      type: z.enum(["debriefs", "tasks", "all"]).optional(),
    }),
    execute: async ({ days = 7, type = "all" }) => {
      try {
        const supabase = createAdminClient()
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
        const supabase = createAdminClient()
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
        const supabase = createAdminClient()
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
        const supabase = createAdminClient()
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

  // ── Web research ────────────────────────────────────────────────────────
  // Two complementary tools for questions that go beyond Motta's internal
  // database. See lib/alfred/tools/{web-search,browse-page}.ts for details.
  webSearch: webSearchTool,
  browsePage: browsePageTool,
}

// Build the dual-identity preamble that goes ABOVE the static base prompt.
// Returns a different string when no user is authenticated so ALFRED can
// answer firm-wide instead of pretending it knows whose "my" is whose.
function buildIdentityPreamble(currentUser: CurrentUser | null): string {
  if (!currentUser) {
    return `You operate under two identities:
- The ALFRED service account (Info@mottafinancial.com) — the firm-level identity outbound emails, Karbon notes, and message-board posts originate from.
- The requesting user — UNKNOWN. No team member identity was provided with this turn.

Because the requesting user is unknown, do NOT answer "my work items" / "my deadlines" / "my clients" style questions as if you knew who is asking. Tell the user you couldn't resolve their identity and answer firm-wide instead. Do NOT call getMyWorkItems or getMyUpcomingDeadlines in this state.`
  }

  return `You operate under two identities at once:
- The ALFRED service account (Info@mottafinancial.com) — the firm-level identity that outbound emails, Karbon notes, and message-board posts originate from.
- The requesting user — ${currentUser.fullName ?? currentUser.email} (${currentUser.role ?? "no role"}, ${currentUser.department ?? "no department"}), team_members.id ${currentUser.teamMemberId}, Karbon user key ${currentUser.karbonUserKey ?? "none"}.

When you create or send anything externally visible, the sender/author is ALFRED, but you ALWAYS include "on behalf of ${currentUser.fullName ?? currentUser.email}" in the body and record ${currentUser.teamMemberId} as on_behalf_of_id in activity_log.

When the user asks about "my" data, scope by ${currentUser.teamMemberId} (NOT the ALFRED account). Prefer the convenience tools \`getMyWorkItems\` and \`getMyUpcomingDeadlines\` which already filter by the requesting user.`
}

// Static base prompt — the instructions that don't change per user.
const BASE_SYSTEM_PROMPT = `You are ALFRED, the AI assistant for Motta Hub - Motta Financial's internal business management platform. You have full access to the company's database and can help team members with:

1. **Client Information**: Look up clients, their contact details, work history, and associated work items
2. **Work Items**: Find, filter, and summarize work items by status, assignee, due date, tax year, etc.
3. **Team Management**: View team workload, assignments, and capacity
4. **Deadlines & Tasks**: Track upcoming deadlines, overdue items, and task assignments
5. **Financial Data**: Access invoice information, recurring revenue, and billing details
6. **Debriefs**: Review recent client debriefs and meeting notes captured on the Debriefs page
7. **Tommy Awards**: Check the leaderboard and recognition program standings
8. **Services**: Look up service offerings and pricing
9. **Web Research**: Look up information from the public internet when the answer isn't in Motta's database

When answering questions:
- Be concise but thorough
- Use the appropriate tools to query data before responding
- Format numbers and dates clearly
- If you need more context, ask clarifying questions
- Always protect sensitive information (don't expose SSNs, full EINs, etc.)
- When showing lists, summarize key information rather than dumping raw data

**Web Research guidance**:
- For questions about Motta's internal data (clients, work, debriefs, financials), ALWAYS prefer the database tools — never search the web for info we already have.
- Use \`webSearch\` (Parallel Web) for broad research questions: recent regulations, IRS guidance, industry news, competitor info, software documentation, etc. It returns ranked excerpts with source URLs.
- Use \`browsePage\` (Browserbase) ONLY when you have a specific URL to read in full — either provided by the user or surfaced by \`webSearch\`. Each browse call takes ~5-10s, so don't use it for general research.
- Always cite sources with their URL when you've used web research.
- If the user asks about tax law, deadlines, or compliance, lean on \`webSearch\` results from official .gov sources (irs.gov, state DORs) over third-party blogs.

You work for Motta Financial, a San Francisco-based CPA firm specializing in tax, accounting, and advisory services.`

// Best-effort text extractor for a UIMessage. Used for title derivation
// only -- we still persist the full `parts` array as `content` so reloads
// restore tool calls, data parts, etc. exactly as they streamed.
function uiMessageText(message: UIMessage | undefined | null): string {
  if (!message) return ""
  const parts = (message as any).parts as Array<{ type: string; text?: string }> | undefined
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim()
}

// OPTIONS preflight handler. Browsers from alfred.motta.cpa send this
// before every credentialed POST -- without an explicit response carrying
// CORS headers the actual chat request never goes out. We don't need
// auth here; the headers are the entire point.
export async function OPTIONS(req: Request) {
  return preflightResponse(req)
}

export async function POST(req: Request) {
  // Identity is resolved from a verified signature (Bearer token OR
  // Supabase session cookie), NOT from the body. The body's currentUser
  // field is intentionally ignored to prevent a client from spoofing
  // its team_member_id and reading another user's "my work items".
  const currentUser: ResolvedAlfredUser | null = await resolveAlfredUser(req)
  if (!currentUser) {
    return applyAlfredCors(
      Response.json(
        {
          error: "Unauthorized",
          detail:
            "ALFRED chat requires either a Supabase session cookie or an Authorization: Bearer token.",
        },
        { status: 401 },
      ),
      req,
    )
  }

  const {
    messages,
    conversationId: incomingConversationId = null,
    audience = "staff",
  }: {
    messages: UIMessage[]
    // currentUser is intentionally NOT typed/read here -- it is an
    // untrusted hint only and is silently discarded.
    conversationId?: string | null
    audience?: Audience
  } = await req.json()

  // Build the audience policy (staff today, client deliberately
  // throws). Doing this BEFORE we touch the model lets the route fail
  // fast with a 403 for unsupported audiences instead of streaming
  // back a half-formed response.
  let policy
  try {
    policy = buildPolicy({
      audience,
      currentUser: {
        teamMemberId: currentUser.teamMemberId,
        fullName: currentUser.fullName,
        email: currentUser.email,
        role: currentUser.role,
        department: currentUser.department,
      },
    })
  } catch (e) {
    return applyAlfredCors(
      Response.json(
        {
          error: "Forbidden",
          detail: e instanceof Error ? e.message : "Audience not enabled.",
        },
        { status: 403 },
      ),
      req,
    )
  }

  // AI SDK 6: convertToModelMessages returns Promise<ModelMessage[]>
  const modelMessages = await convertToModelMessages(messages)

  // ── Conversation row lifecycle ──────────────────────────────────────
  // We always use the service-role client for persistence: the chat route
  // is the trusted writer, and we don't want to depend on a user session
  // being present (this endpoint is also wired to alfred.motta.cpa in a
  // later step). RLS still protects reads from the browser via
  // /api/alfred/conversations* which use the SSR client.
  const supabase = createAdminClient()
  const adminAuthLookup = supabase // alias for clarity below

  let conversationId: string | null = incomingConversationId
  let conversationTitleAlreadySet = false

  if (currentUser) {
    if (conversationId) {
      // Verify the supplied conversation belongs to the requesting user.
      // If not, fall through and create a fresh one rather than 500ing.
      const { data: existing } = await adminAuthLookup
        .from("alfred_conversations")
        .select("id, title, end_user_team_member_id")
        .eq("id", conversationId)
        .maybeSingle()
      if (!existing || existing.end_user_team_member_id !== currentUser.teamMemberId) {
        conversationId = null
      } else {
        conversationTitleAlreadySet = !!existing.title
      }
    }

    if (!conversationId) {
      try {
        const alfred = await getAlfredServiceAccount(supabase)
        const { data: created, error: createErr } = await supabase
          .from("alfred_conversations")
          .insert({
            end_user_team_member_id: currentUser.teamMemberId,
            service_account_team_member_id: alfred.id,
            audience,
            title: null,
          })
          .select("id")
          .single()
        if (!createErr && created) {
          conversationId = created.id
          conversationTitleAlreadySet = false
        }
      } catch (e) {
        // Persistence is best-effort. If the ALFRED service account row is
        // missing (migration not yet run) we still want the chat to work.
        console.error("[v0] alfred_conversations insert failed:", e)
      }
    }
  }

  // Capture the user's most recent message NOW (before streaming starts).
  // We persist exactly this row in onFinish, not the historical replay.
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user") ?? null

  // Two convenience tools that pre-scope by the requesting user. Defined
  // inside POST so they close over `currentUser`. Both fail clearly when
  // we couldn't identify who is asking, instead of leaking firm-wide data.
  const userScopedTools = {
    getMyWorkItems: tool({
      description:
        "Get work items assigned to the current requesting user. Use this whenever the user asks about 'my work items', 'my open work', 'what am I working on', etc. Filters first by team_members.id (assignee_id), and falls back to a fuzzy match on assignee_name when the assignee_id link isn't populated yet.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Optional Karbon status filter, e.g. 'In Progress', 'Ready to Start'."),
        dueWithinDays: z
          .number()
          .optional()
          .describe("If set, only return items with a due_date within the next N days."),
        includeCompleted: z
          .boolean()
          .optional()
          .describe("Include Completed/Cancelled items. Defaults to false."),
      }),
      execute: async ({ status, dueWithinDays, includeCompleted = false }) => {
        if (!currentUser) {
          return {
            success: false,
            error:
              "No requesting user is identified for this chat session. Cannot resolve 'my' work items.",
          }
        }
        try {
          const supabase = createAdminClient()
          let query = supabase.from("work_items").select("*")

          // Primary scope: assignee_id = team_members.id. This is the
          // canonical link once the Karbon→team_members mapping has run.
          // Fallback: case-insensitive match on assignee_name for older
          // rows that haven't been backfilled yet.
          if (currentUser.fullName) {
            query = query.or(
              `assignee_id.eq.${currentUser.teamMemberId},assignee_name.ilike.%${currentUser.fullName}%`,
            )
          } else {
            query = query.eq("assignee_id", currentUser.teamMemberId)
          }

          if (status) query = query.eq("status", status)
          if (!includeCompleted) {
            query = query.not("status", "in", '("Completed","Cancelled")')
          }
          if (typeof dueWithinDays === "number") {
            const today = new Date().toISOString().split("T")[0]
            const future = new Date(Date.now() + dueWithinDays * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0]
            query = query.gte("due_date", today).lte("due_date", future)
          }

          const { data, error } = await query
            .order("due_date", { ascending: true, nullsFirst: false })
            .limit(100)

          if (error) return { success: false, error: error.message }
          return {
            success: true,
            scopedTo: {
              teamMemberId: currentUser.teamMemberId,
              fullName: currentUser.fullName,
            },
            workItems: data,
            count: data?.length ?? 0,
          }
        } catch (err) {
          return { success: false, error: String(err) }
        }
      },
    }),

    getMyUpcomingDeadlines: tool({
      description:
        "Get the requesting user's upcoming work-item deadlines. Use this whenever the user asks about 'my deadlines', 'what's due for me this week', etc. Defaults to the next 7 days.",
      inputSchema: z.object({
        days: z
          .number()
          .optional()
          .describe("Number of days to look ahead, defaults to 7."),
      }),
      execute: async ({ days = 7 }) => {
        if (!currentUser) {
          return {
            success: false,
            error:
              "No requesting user is identified for this chat session. Cannot resolve 'my' deadlines.",
          }
        }
        try {
          const supabase = createAdminClient()
          const today = new Date().toISOString().split("T")[0]
          const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0]

          let query = supabase
            .from("work_items")
            .select("id, title, status, due_date, assignee_name, assignee_id, client_group_name")
            .gte("due_date", today)
            .lte("due_date", future)
            .not("status", "in", '("Completed","Cancelled")')

          if (currentUser.fullName) {
            query = query.or(
              `assignee_id.eq.${currentUser.teamMemberId},assignee_name.ilike.%${currentUser.fullName}%`,
            )
          } else {
            query = query.eq("assignee_id", currentUser.teamMemberId)
          }

          const { data, error } = await query
            .order("due_date", { ascending: true })
            .limit(100)

          if (error) return { success: false, error: error.message }
          return {
            success: true,
            scopedTo: {
              teamMemberId: currentUser.teamMemberId,
              fullName: currentUser.fullName,
            },
            deadlines: data,
            count: data?.length ?? 0,
          }
        } catch (err) {
          return { success: false, error: String(err) }
        }
      },
    }),
  }

  // We wrap streamText in createUIMessageStream so we can:
  //   1. Emit a `data-conversation` part as the first chunk -- the client
  //      uses this to learn the conversation id for newly-created threads
  //      and to keep storing it across the turn.
  //   2. Hook onFinish to persist the user message + final assistant
  //      message in a single round-trip, AFTER the stream is fully drained
  //      (otherwise we'd race the response).
  const stream = createUIMessageStream<UIMessage>({
    execute: ({ writer }) => {
      if (conversationId) {
        writer.write({
          type: "data-conversation",
          data: { id: conversationId },
        })
      }

      // Layer the per-request policy on top of the static tools:
      //   1. Wrap `queryDatabase` so its `execute` rejects any table
      //      that is not in `policy.tableAllowlist`. The wrapper runs
      //      BEFORE the static `isAllowedTable` guard, so a future
      //      narrower client policy can lock the model out of a table
      //      even though the table still exists in `ALLOWED_TABLES`.
      //   2. Filter the merged tool map down to `policy.allowedTools`
      //      via Object.fromEntries so the model literally cannot see
      //      tools the audience isn't allowed to call.
      const queryDatabaseBase = alfredTools.queryDatabase
      const policyAwareQueryDatabase = {
        ...queryDatabaseBase,
        execute: async (input: { table: string }, opts: unknown) => {
          if (!policy.tableAllowlist.includes(input.table)) {
            return {
              success: false,
              error:
                `Table "${input.table}" is not allowed for the current ` +
                `ALFRED audience (${policy.audience}). Allowed tables: ` +
                `${policy.tableAllowlist.join(", ")}.`,
            }
          }
          // Delegate to the static execute. Cast through `Function`
          // because the static execute's input type is the inferred
          // Zod schema type, which we only loosely re-typed above.
          return (queryDatabaseBase.execute as Function)(input, opts)
        },
      } as typeof queryDatabaseBase

      const mergedTools = {
        ...alfredTools,
        queryDatabase: policyAwareQueryDatabase,
        ...userScopedTools,
      }
      const filteredTools = Object.fromEntries(
        Object.entries(mergedTools).filter(([name]) =>
          policy.allowedTools.includes(name),
        ),
      ) as typeof mergedTools

      const result = streamText({
        model: "openai/gpt-4o",
        system: `${buildIdentityPreamble(currentUser)}\n\n${BASE_SYSTEM_PROMPT}\n\n${policy.systemPromptSuffix}`,
        messages: modelMessages,
        tools: filteredTools,
        // 12 steps lets ALFRED chain webSearch → pick a result → browsePage →
        // reply, with a couple DB lookups in the same turn if needed.
        stopWhen: stepCountIs(12),
        abortSignal: req.signal,
      })

      writer.merge(result.toUIMessageStream())
    },
    onFinish: async ({ messages: finalMessages, responseMessage }) => {
      if (!conversationId || !currentUser) return

      try {
        // Persist the new user turn (if there was one this request) and the
        // final assistant message. We use `parts` as the canonical content
        // payload so reload can rebuild UIMessage.parts verbatim.
        const rows: Array<{
          conversation_id: string
          role: "user" | "assistant" | "tool" | "system"
          content: unknown
          tool_calls: unknown | null
        }> = []

        if (lastUserMessage) {
          rows.push({
            conversation_id: conversationId,
            role: "user",
            content: { parts: (lastUserMessage as any).parts ?? [] },
            tool_calls: null,
          })
        }

        if (responseMessage) {
          // Extract tool_calls from the assistant parts for indexed lookup.
          // We still keep the full parts inside `content` for reload.
          const parts = (responseMessage as any).parts as Array<any> | undefined
          const toolParts =
            parts?.filter(
              (p) => typeof p?.type === "string" && p.type.startsWith("tool-"),
            ) ?? []
          rows.push({
            conversation_id: conversationId,
            role: responseMessage.role as "assistant",
            content: { parts: parts ?? [] },
            tool_calls: toolParts.length > 0 ? toolParts : null,
          })
        }

        if (rows.length > 0) {
          const { error: insertErr } = await supabase.from("alfred_messages").insert(rows)
          if (insertErr) console.error("[v0] alfred_messages insert failed:", insertErr)
        }

        // Title derivation. Done once -- if the row already has a title
        // (resumed thread) we skip and just bump updated_at.
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (!conversationTitleAlreadySet) {
          const sourceText =
            uiMessageText(lastUserMessage) ||
            uiMessageText(finalMessages.find((m) => m.role === "user")) ||
            ""
          const trimmed = sourceText.trim().replace(/\s+/g, " ")
          if (trimmed) {
            updates.title = trimmed.length > 60 ? trimmed.slice(0, 60).trimEnd() + "…" : trimmed
          }
        }

        const { error: updateErr } = await supabase
          .from("alfred_conversations")
          .update(updates)
          .eq("id", conversationId)
        if (updateErr) console.error("[v0] alfred_conversations update failed:", updateErr)
      } catch (e) {
        console.error("[v0] alfred persistence onFinish error:", e)
      }
    },
  })

  // CORS headers must be on the streamed Response itself, not just on
  // the OPTIONS preflight -- the browser drops the streaming body
  // otherwise. applyAlfredCors mutates and returns the Response, which
  // is safe to do before the body has started flowing.
  return applyAlfredCors(createUIMessageStreamResponse({ stream }), req)
}
