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
import { ALFRED_CHAT_MODEL } from "@/lib/ai/models"
import { getAIConfig, logAIUsage } from "@/lib/ai/config"

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

/**
 * Escape user-supplied text before splicing it into a PostgREST `.or()`
 * ilike filter. PostgREST uses `,` to separate filter clauses, `.` to
 * separate operator/value, and `%` for SQL wildcards. A raw `,` from a
 * user query like "Smith, John" turns into a malformed clause and
 * causes a 400 instead of a search hit. We collapse the dangerous
 * characters into safe equivalents:
 *   - `,` and `.` → space (separators)
 *   - `%`         → space (wildcard, we wrap the term in `%...%` ourselves)
 *   - `*`         → space (PostgREST treats `*` as wildcard in some
 *                   filter contexts; safer to drop it)
 */
function sanitizeIlikeTerm(input: string): string {
  return input.replace(/[%,.*]/g, " ").trim()
}

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
      // PostgREST `.or()` treats `,` as a separator between filters and
      // `%` as the SQL wildcard. A raw user term with either character
      // turns into a malformed filter and the whole call returns 400.
      // Escape both before interpolation.
      const safe = sanitizeIlikeTerm(searchTerm)

      for (const table of tables) {
        try {
          if (!isAllowedTable(table.name)) {
            results[table.name] = []
            continue
          }
          const orConditions = table.searchColumns
            .map((col) => `${col}.ilike.%${safe}%`)
            .join(",")

          const { data, error } = await supabase
            .from(table.name)
            .select("*")
            .or(orConditions)
            .limit(10)

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
        const safe = sanitizeIlikeTerm(searchTerm)
        // Search client groups
        const { data: clientGroups } = await supabase
          .from("client_groups")
          .select("*")
          .ilike("name", `%${safe}%`)
          .limit(5)

        // Search organizations
        const { data: organizations } = await supabase
          .from("organizations")
          .select("*")
          .ilike("name", `%${safe}%`)
          .limit(5)

        // Search contacts
        const { data: contacts } = await supabase
          .from("contacts")
          .select("*")
          .or(`full_name.ilike.%${safe}%,primary_email.ilike.%${safe}%`)
          .limit(5)

        let workItems: any[] = []
        if (includeWorkItems && clientGroups && clientGroups.length > 0) {
          const { data: items } = await supabase
            .from("work_items")
            .select("*")
            .ilike("client_group_name", `%${safe}%`)
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

  // ── Person lookup ───────────────────────────────────────────────────────
  // Dedicated, zero-friction tool for "Who is X?" / "Do we have a contact
  // named Y?" / "Find me Z's email" questions. The model previously failed
  // these by either (a) bailing with "I'm afraid I haven't that
  // information to hand" before calling any tool, or (b) calling
  // searchAcrossTables with the wrong column list (e.g. searching
  // `contacts.email` when the actual column is `primary_email`).
  //
  // This tool encodes the correct columns per table so the model just
  // passes a name fragment and gets back a single merged result set
  // spanning team_members, contacts, and leads. It MUST be the first
  // thing ALFRED reaches for on identity questions.
  findPerson: tool({
    description:
      "Find a person by name or email across team_members (Motta staff), contacts (clients/individuals), and leads (prospects). " +
      "Use this FIRST whenever a user asks who someone is, asks for someone's email/role, asks 'do we know X?', or otherwise needs to identify a person. " +
      "Pass a name fragment, full name, or partial email — matching is case-insensitive across all relevant name and email columns. " +
      "Do NOT use queryDatabase for person lookups; use this tool.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("A name, partial name, or email fragment. Case-insensitive."),
      includeInactive: z
        .boolean()
        .optional()
        .describe(
          "Include inactive team_members (alumni). Defaults to true so 'who was X?' questions still resolve.",
        ),
    }),
    execute: async ({ query, includeInactive = true }) => {
      const supabase = createAdminClient()
      // PostgREST `.or()` chokes on `,` `.` `%` in user input -- escape
      // before splicing into the ilike pattern.
      const pattern = `%${sanitizeIlikeTerm(query)}%`
      const results: {
        team_members: any[]
        contacts: any[]
        leads: any[]
      } = { team_members: [], contacts: [], leads: [] }

      try {
        // team_members has full_name + email and a boolean is_active.
        let tmQuery = supabase
          .from("team_members")
          .select("id, full_name, email, role, department, is_active")
          .or(`full_name.ilike.${pattern},email.ilike.${pattern}`)
          .limit(10)
        if (!includeInactive) tmQuery = tmQuery.eq("is_active", true)
        const { data: tm } = await tmQuery
        results.team_members = tm ?? []
      } catch (e) {
        // Swallow per-table errors so a missing column on one table
        // doesn't kill the whole lookup; the empty array is still useful.
      }

      try {
        // contacts uses primary_email, NOT email.
        const { data: ct } = await supabase
          .from("contacts")
          .select("id, full_name, primary_email, contact_type, status")
          .or(`full_name.ilike.${pattern},primary_email.ilike.${pattern}`)
          .limit(10)
        results.contacts = ct ?? []
      } catch (e) {}

      try {
        // leads uses first_name/last_name/email.
        const { data: ld } = await supabase
          .from("leads")
          .select("id, first_name, last_name, email, company_name, status, source")
          .or(
            `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},company_name.ilike.${pattern}`,
          )
          .limit(10)
        results.leads = ld ?? []
      } catch (e) {}

      const total =
        results.team_members.length + results.contacts.length + results.leads.length

      return {
        success: true,
        query,
        total,
        results,
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
const BASE_SYSTEM_PROMPT = `You are ALFRED Ai, the digital butler-in-residence at Motta Hub — Motta Financial's internal business management platform. You serve every member of the firm with the unflappable courtesy of a senior English butler who has been in service at a fine London estate for forty years. Equal parts steward, archivist, and confidant.

## Voice

- Polite, formal, dryly warm. Speak in complete sentences with the cadence of a butler: "Very good." "If I may, sir." "Shall I fetch the figures?" "Indeed." "I'm afraid…" "At your service."
- Use "sir" or "madam" sparingly — at most once per response, only when it lands naturally.
- Brevity is a virtue: a fine butler delivers the necessary intelligence and stops there.
- Light, dry wit is welcome on occasion. Never sarcasm.
- Never refer to yourself as an "AI", a "language model", a "chatbot", or "the assistant". You are ALFRED, in service to Motta Financial.
- Open replies with a short statement of fact — never an apology, never "Sure!", never "Great question!".
- When you do not know something or cannot reach a record: "I'm afraid I haven't that information to hand," then suggest the next step. This line is reserved for situations where you have ALREADY consulted the relevant tools and come back empty. NEVER use it as a first response to skip looking something up.

## The cardinal rule: search before you apologise

If a user asks about a person, a client, a work item, a deadline, an invoice, a debrief, a meeting, an email, an award, or anything else that could plausibly live in the firm's records, you MUST consult the database BEFORE concluding you don't know.

- For ANY question of the form "Who is X?", "Do we have a contact named X?", "What's X's email/role/department?", "Find X for me" — your FIRST action is \`findPerson({ query: "X" })\`. Do not skip this step. Do not guess from memory. Do not tell the user you have no information without searching first.
- For "what is X's workload / what work is assigned to X" — call \`findPerson\` first to resolve who X actually is, then \`getTeamWorkload\` or \`queryDatabase\` against \`work_items\` filtered by their team_members.id or assignee_name.
- For "what's going on with client/company X" — call \`getClientInfo\` first.
- For "what's due / what's overdue / show me deadlines" — call \`getUpcomingDeadlines\` or \`getMyUpcomingDeadlines\`.

Only after a tool call has actually returned no matches may you say "I'm afraid I haven't that information to hand." A blank apology before tool use is a failure of duty.

## Workflow — gather privately, present once

You have considerable tooling at your disposal: the firm's database, web research, file lookups. Use it freely.

- Do NOT narrate which tool you are calling. Never write "Querying X…", "Let me check…", "I'll search the database now…", or any other step-by-step plumbing. The user does not see the inner workings of the household.
- Gather every fact you need across however many tool calls it takes, then deliver one well-composed final reply.
- Do not ask the user to wait. Simply produce the answer.

## Response formatting — clean GitHub-flavoured Markdown

The chat surface renders Markdown. Use that fact to deliver tidy, scannable replies — never raw key/value dumps.

- Lead with a one or two sentence prose summary of what you found.
- Then short \`###\` sections only when more than one topic is involved. Otherwise skip headings entirely.
- Use compact bullet lists with **bold labels** followed by the value on the same line. Never put the bold label on one line and the value on another.
- Use a Markdown table only when comparing 3+ rows of structured data.
- Render email addresses and phone numbers as plain text. Do NOT wrap them in code, autolink syntax, or \`mailto:\` Markdown. Plain text only.
- Use inline-code (\`like this\`) only for true identifiers: ids, Karbon keys, SQL fragments, file paths.
- When citing web research, end with a "Sources" list of named Markdown links.
- Do NOT precede the response with an internal monologue, planning notes, or a "here's what I'll do" preamble. Open with the answer.

## Substance and discretion

- Format dates as "March 12, 2025" or "12 Mar" — never raw ISO strings.
- Format money as "$1,234" or "$1.2M". Round sensibly.
- Protect sensitive data: never reveal full SSNs, full EINs, or passwords. Mask them ("•••-••-1234").
- Summarise lists; do not dump every column you fetched.
- When the requesting team member is unknown, do not pretend to know who is asking. Answer firm-wide and say so.

## Tool guidance (internal — do not surface this to the user)

- Internal Motta data (clients, work items, debriefs, financials, team workload, deadlines, Tommy Awards, services, intake submissions) → use the database tools. Never web-search for facts we already hold.
- \`webSearch\` (Parallel Web) → broad questions: tax regulations, IRS guidance, industry news, software documentation. Returns ranked excerpts with URLs.
- \`browsePage\` (Browserbase) → fetch the body of a specific URL. Each call costs roughly 5–10 seconds; reach for it only when you genuinely need the page content.
- Web answers on tax / compliance topics should lean on .gov sources (irs.gov, state DORs) over third-party commentary.

Motta Financial is a San Francisco–based CPA firm specialising in tax, accounting, and advisory services. You are in their service.`

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
    execute: async ({ writer }) => {
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

      // Fetch AI config for model + prompt overrides from the admin panel.
      // Falls back to hardcoded defaults if the DB isn't available.
      const aiConfig = await getAIConfig("alfred_chat")
      const startTime = Date.now()

      // Build the system prompt, using the admin override if set
      const baseSystemPrompt = aiConfig.systemPrompt
        ? aiConfig.systemPrompt
        : `${buildIdentityPreamble(currentUser)}\n\n${BASE_SYSTEM_PROMPT}\n\n${policy.systemPromptSuffix}`

      const result = streamText({
        // Model can be overridden from the admin panel; falls back to
        // ALFRED_CHAT_MODEL from lib/ai/models.ts if no override is set.
        model: aiConfig.model,
        system: baseSystemPrompt,
        messages: modelMessages,
        tools: filteredTools,
        // 12 steps lets ALFRED chain webSearch → pick a result → browsePage →
        // reply, with a couple DB lookups in the same turn if needed.
        stopWhen: stepCountIs(12),
        abortSignal: req.signal,
        onFinish: async ({ usage }) => {
          // Fire-and-forget usage logging for the admin stats dashboard
          // AI SDK 6 uses inputTokens/outputTokens; we map to our DB schema names
          logAIUsage({
            useCase: "alfred_chat",
            model: aiConfig.model,
            promptTokens: usage?.inputTokens,
            completionTokens: usage?.outputTokens,
            totalTokens: usage?.totalTokens,
            latencyMs: Date.now() - startTime,
            success: true,
            userId: currentUser?.teamMemberId,
            userEmail: currentUser?.email,
            metadata: { conversationId },
          })
        },
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
