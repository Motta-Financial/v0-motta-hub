import { convertToModelMessages, streamText, tool, type UIMessage } from "ai"
import { z } from "zod"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const maxDuration = 60

// Fields ALFRED is allowed to update on client records
const CONTACT_WRITABLE_FIELDS = ["primary_email", "status"] as const
const ORG_WRITABLE_FIELDS = ["primary_email", "status", "industry"] as const
type ContactWritableField = (typeof CONTACT_WRITABLE_FIELDS)[number]
type OrgWritableField = (typeof ORG_WRITABLE_FIELDS)[number]

export async function POST(req: Request) {
  // ── 1. Authentication ─────────────────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  // ── 2. Resolve team member for display name + audit trail ─────────────────
  const adminClient = createAdminClient()
  const { data: teamMember } = await adminClient
    .from("team_members")
    .select("id, full_name, email")
    .eq("auth_user_id", user.id)
    .single()

  const actorName = teamMember?.full_name || user.email || "Unknown User"
  const actorId = teamMember?.id ?? null

  // ── 3. Audit helper (non-blocking) ────────────────────────────────────────
  // Writes to alfred_audit_log (run scripts/022-create-alfred-audit-log.sql first),
  // then falls back to the generic activity_log — never throws.
  async function auditLog(
    entityType: string,
    actionType: string,
    description: string,
    payload?: Record<string, unknown>,
    entityId?: string,
  ) {
    try {
      await adminClient.from("alfred_audit_log").insert({
        team_member_id: actorId,
        actor_name: actorName,
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId ?? null,
        description,
        payload: payload ?? null,
        success: true,
      })
    } catch (_) {
      // alfred_audit_log may not exist yet — fall back to activity_log
      try {
        if (actorId) {
          await adminClient.from("activity_log").insert({
            entity_type: entityType,
            action: `[ALFRED] ${description}`,
            team_member_id: actorId,
          })
        }
      } catch (_inner) {
        // Logging must never crash the assistant
      }
    }
  }

  // ── 4. Parse request body ─────────────────────────────────────────────────
  const { messages }: { messages: UIMessage[] } = await req.json()

  // ── 5. Tools (read + write) ───────────────────────────────────────────────
  const alfredTools = {
    // ── READ TOOLS ──────────────────────────────────────────────────────────

    queryDatabase: tool({
      description: `Query any table in the Motta Hub Supabase database. Use this for every data question.

CLIENTS & CONTACTS
- contacts           id, full_name, first_name, last_name, primary_email, contact_type, status, client_manager_id, client_owner_id, phone_numbers (JSONB), addresses (JSONB)
- organizations      id, name, legal_name, entity_type, industry, ein, status, primary_email, client_since, referral_source, client_manager_id, client_owner_id
- client_groups      id, name, group_type, client_manager_id, client_owner_id, primary_contact_id
- client_group_members  links contacts/organizations to client_groups (client_group_id, contact_id, organization_id, is_primary)
- contact_organizations links contacts to organizations (contact_id, organization_id, role_or_title, is_primary_contact)

WORK & PROJECTS (synced from Karbon)
- work_items         id, title, status, workflow_status, work_type, due_date, start_date, completed_date, deadline_date, tax_year, assignee_id, assignee_name, client_group_id, client_group_name, contact_id, organization_id, client_name, primary_status, secondary_status, fee_type, fee_value
- work_status        id, name, is_active, is_default_filter, primary_status_name, secondary_status_name
- work_types         id, name, description
- work_item_assignees  links work items to additional assignees

KARBON SYNCED DATA (periodic sync from Karbon practice management)
- karbon_notes       id, subject, body, author_name, work_item_title, contact_name, created_at
- karbon_tasks       id, title, status, assignee_name, due_date, priority, task_data (JSONB)
- karbon_timesheets  id, user_name, minutes, work_item_title, client_name, date, is_billable, role_name, timesheet_status
- karbon_invoices    id, invoice_number, amount, tax, total_amount, status, issued_date, due_date, paid_date, line_items (JSONB)

TEAM MEMBERS
- team_members       id, full_name, email, role, department, is_active, auth_user_id, billable_rate, capacity_minutes_per_week, avatar_url, phone, permissions (text[]), roles (text[]), teams (text[])
- time_entries       id, team_member_id, minutes, description, date, is_billable

MEETINGS & NOTES
- meeting_notes      id, client_name, meeting_date, meeting_type, attendees, agenda, notes, action_items, status (includes ALFRED Notes)
- meeting_attendees  links team members to meetings
- debriefs           id, debrief_date, debrief_type, team_member, organization_name, contact_name, notes, action_items, follow_up_date, tax_year, status, contact_id, organization_id, work_item_id, client_group_id
- debrief_comments   id, debrief_id, comment, team_member_id, created_at

FINANCIAL
- invoices           id, invoice_number, total_amount, amount_paid, status, due_date, invoice_date, organization_id, contact_id
- invoice_line_items id, invoice_id, description, quantity, unit_price, total
- payments           id, invoice_id, amount, payment_date, payment_method, notes
- recurring_revenue  id, service_type, monthly_amount, annual_amount, is_active, organization_id
- services           id, name, category, price, description, ignition_id
- service_agreements id, organization_id, service_id, start_date, end_date, monthly_amount, status
- service_lines      id, name, description
- tax_returns        id, tax_year, form_type, filing_status, status, contact_id, organization_id

TASKS & INTERNAL
- tasks              id, title, description, status (todo/in_progress/completed), assignee_id, due_date, priority, is_completed
- notes              id, title, body, entity_type, entity_id, visibility, created_at
- messages           id, subject, body, sender_id, created_at
- message_comments   id, message_id, body, team_member_id
- notifications      id, team_member_id, message, type, is_read, created_at
- emails             id, subject, body, from_email, to_email, sent_at
- activity_log       id, entity_type, action, team_member_id, created_at
- alfred_audit_log   id, actor_name, action_type, entity_type, description, payload (JSONB), created_at

CALENDLY (synced from Calendly)
- calendly_events    id, event_name, start_time, end_time, status, event_type, invitee_email, invitee_name, location, cancel_reason
- calendly_invitees  id, event_id, name, email, created_at

BUSINESS DEVELOPMENT
- leads              id, first_name, last_name, email, company_name, status, source, notes, assigned_to
- pipelines          id, name, description, stages (JSONB)
- pipeline_stages    id, pipeline_id, name, order, probability

DASHBOARDS & VIEWS
- dashboards         id, name, team_member_id, widgets (JSONB)
- dashboard_widgets  id, dashboard_id, widget_type, config (JSONB), position (JSONB)
- saved_views        id, name, entity_type, filters (JSONB), team_member_id

BUSY SEASON (annual tax deadline management)
- busy_season_work_items      id, work_item_id, assignee_id, status, priority, notes
- busy_season_assignment_history  change log for busy season reassignments
- busy_season_overrides       manual overrides to busy season rules

TOMMY AWARDS (weekly team recognition program)
- tommy_award_ballots         id, voter_name, week_date, first_place_name, second_place_name, third_place_name, notes
- tommy_award_points          id, team_member_name, week_date, total_points
- tommy_award_weeks           id, week_date, is_finalized
- tommy_award_yearly_totals   id, team_member_name, year, total_points, current_rank

SYSTEM
- sync_log           id, sync_type, status, records_fetched, records_created, records_updated, records_failed, started_at, completed_at, error_message
- documents          id, name, entity_type, entity_id, url, created_at
- tags               id, name, color, entity_type
- ignition_proposals id, proposal_name, status, client_id, amount, created_at
- app_settings       id, key, value (system configuration key/value pairs)`,
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
          const { data: clientGroups } = await supabase
            .from("client_groups")
            .select("*")
            .ilike("name", `%${searchTerm}%`)
            .limit(5)

          const { data: organizations } = await supabase
            .from("organizations")
            .select("*")
            .ilike("name", `%${searchTerm}%`)
            .limit(5)

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

    getRecentActivity: tool({
      description: "Get recent activity including debriefs, meeting notes, and tasks",
      inputSchema: z.object({
        days: z.number().optional().describe("Number of days to look back, default 7"),
        type: z.enum(["debriefs", "meeting_notes", "tasks", "all"]).optional(),
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

    getFinancialSummary: tool({
      description: "Get financial summary including invoices and recurring revenue",
      inputSchema: z.object({
        period: z.enum(["month", "quarter", "year"]).optional(),
      }),
      execute: async ({ period = "month" }) => {
        try {
          const supabase = createAdminClient()
          const { data: invoices } = await supabase
            .from("invoices")
            .select("total_amount, amount_paid, status, invoice_date")

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

    // ── WRITE TOOLS ──────────────────────────────────────────────────────────
    // All write tools follow the same safe pattern:
    //   1. dryRun: true  → validate + preview (never touches the DB)
    //   2. dryRun: false → execute after the user has explicitly confirmed in chat

    updateWorkItemStatus: tool({
      description: `Update the status of a work item in Motta Hub.

MANDATORY WORKFLOW — follow this every time without exception:
1. Call this tool with dryRun: true to get a preview of the change.
2. Present the preview clearly to the user (current status → new status, work item title, client).
3. Ask: "Shall I go ahead and make this change?" — wait for the user to say yes.
4. Only then call this tool again with dryRun: false to execute.

Never skip the confirmation step, even if the user originally asked you to "just do it."`,
      inputSchema: z.object({
        workItemId: z.string().describe("The UUID of the work item to update (from a prior queryDatabase call)"),
        newStatus: z.string().describe("The exact status value to set (must match a name in the work_status table)"),
        reason: z.string().optional().describe("Brief reason for the status change, shown in the audit log"),
        dryRun: z
          .boolean()
          .default(true)
          .describe("true = preview only (default). false = execute after user confirmed."),
      }),
      execute: async ({ workItemId, newStatus, reason, dryRun }) => {
        const db = createAdminClient()

        // Fetch the work item
        const { data: workItem, error: fetchError } = await db
          .from("work_items")
          .select("id, title, status, client_group_name, assignee_name, work_type")
          .eq("id", workItemId)
          .single()

        if (fetchError || !workItem) {
          return { success: false, error: "Work item not found. Please search for it first using queryDatabase." }
        }

        // Validate the target status exists in work_status
        const { data: statuses } = await db.from("work_status").select("name").eq("is_active", true)
        const validStatuses = statuses?.map((s: { name: string }) => s.name) ?? []

        if (validStatuses.length > 0 && !validStatuses.includes(newStatus)) {
          return {
            success: false,
            error: `"${newStatus}" is not a valid status. Valid active statuses: ${validStatuses.join(", ")}`,
          }
        }

        if (workItem.status === newStatus) {
          return {
            success: false,
            error: `Work item "${workItem.title}" is already set to "${newStatus}". No change needed.`,
          }
        }

        const preview = {
          workItemId: workItem.id,
          title: workItem.title,
          client: workItem.client_group_name,
          assignee: workItem.assignee_name,
          workType: workItem.work_type,
          currentStatus: workItem.status,
          proposedStatus: newStatus,
          reason: reason ?? "No reason provided",
          executedBy: actorName,
        }

        if (dryRun) {
          return {
            success: true,
            dryRun: true,
            preview,
            message: `Preview: Change "${workItem.title}" (${workItem.client_group_name ?? "unknown client"}) from **${workItem.status}** → **${newStatus}**. ${reason ? `Reason: ${reason}.` : ""} Please confirm to proceed.`,
          }
        }

        // Execute
        const { error: updateError } = await db
          .from("work_items")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", workItemId)

        if (updateError) {
          return { success: false, error: updateError.message }
        }

        await auditLog(
          "work_item",
          "work_item_status_update",
          `Status changed from "${workItem.status}" to "${newStatus}" on "${workItem.title}". Reason: ${reason ?? "none"}`,
          { before: workItem.status, after: newStatus, title: workItem.title, reason: reason ?? null },
          workItemId,
        )

        return {
          success: true,
          dryRun: false,
          message: `Done. "${workItem.title}" status changed from **${workItem.status}** to **${newStatus}**.`,
          updated: preview,
        }
      },
    }),

    updateClientInfo: tool({
      description: `Update basic, non-sensitive information on a contact or organization record.

Allowed fields for contacts: ${CONTACT_WRITABLE_FIELDS.join(", ")}
Allowed fields for organizations: ${ORG_WRITABLE_FIELDS.join(", ")}

Blocked fields (ALFRED will never update these): EIN, SSN, billing rates, Karbon sync keys, financial data.

MANDATORY WORKFLOW — follow this every time:
1. Call with dryRun: true to preview.
2. Show the user what will change (field name, old value → new value).
3. Ask for explicit confirmation.
4. Call with dryRun: false only after user says yes.`,
      inputSchema: z.object({
        entityType: z.enum(["contact", "organization"]).describe("Whether to update a contact or organization"),
        entityId: z.string().describe("UUID of the contact or organization"),
        patch: z
          .record(z.string(), z.string())
          .describe("Fields to update as key/value pairs (only allowed fields will be applied)"),
        dryRun: z
          .boolean()
          .default(true)
          .describe("true = preview only (default). false = execute after user confirmed."),
      }),
      execute: async ({ entityType, entityId, patch, dryRun }) => {
        const db = createAdminClient()
        const table = entityType === "contact" ? "contacts" : "organizations"
        const allowedFields = entityType === "contact" ? CONTACT_WRITABLE_FIELDS : ORG_WRITABLE_FIELDS

        // Strip any fields not in the whitelist
        const safePatch: Record<string, string> = {}
        const blockedFields: string[] = []
        for (const [k, v] of Object.entries(patch)) {
          if ((allowedFields as readonly string[]).includes(k)) {
            safePatch[k] = v
          } else {
            blockedFields.push(k)
          }
        }

        if (Object.keys(safePatch).length === 0) {
          return {
            success: false,
            error: `No allowed fields provided. Allowed fields for ${entityType}: ${allowedFields.join(", ")}. Blocked fields requested: ${blockedFields.join(", ") || "none"}.`,
          }
        }

        // Fetch current record for preview
        const nameField = entityType === "contact" ? "full_name" : "name"
        const { data: record, error: fetchError } = await db
          .from(table)
          .select(`id, ${nameField}, ${allowedFields.join(", ")}`)
          .eq("id", entityId)
          .single()

        if (fetchError || !record) {
          return { success: false, error: `${entityType} not found. Please look it up first.` }
        }

        const displayName = record[nameField] ?? entityId
        const changes = Object.entries(safePatch).map(([field, newVal]) => ({
          field,
          oldValue: record[field] ?? null,
          newValue: newVal,
        }))

        const preview = {
          entityType,
          entityId,
          displayName,
          changes,
          blockedFieldsRequested: blockedFields,
          executedBy: actorName,
        }

        if (dryRun) {
          const changeDesc = changes.map((c) => `${c.field}: "${c.oldValue}" → "${c.newValue}"`).join(", ")
          return {
            success: true,
            dryRun: true,
            preview,
            message: `Preview: Update ${entityType} **${displayName}** — ${changeDesc}.${blockedFields.length ? ` (Blocked fields ignored: ${blockedFields.join(", ")})` : ""} Please confirm to proceed.`,
          }
        }

        // Execute
        const { error: updateError } = await db
          .from(table)
          .update({ ...safePatch, updated_at: new Date().toISOString() })
          .eq("id", entityId)

        if (updateError) {
          return { success: false, error: updateError.message }
        }

        await auditLog(
          entityType,
          "client_info_update",
          `Updated ${entityType} "${displayName}": ${changes.map((c) => `${c.field} "${c.oldValue}" → "${c.newValue}"`).join(", ")}`,
          { displayName, changes },
          entityId,
        )

        return {
          success: true,
          dryRun: false,
          message: `Done. ${entityType} **${displayName}** updated: ${changes.map((c) => `${c.field} → "${c.newValue}"`).join(", ")}.`,
          updated: preview,
        }
      },
    }),

    addClientNote: tool({
      description: `Add a note to the meeting_notes table associated with a specific client.
Use this to log call summaries, follow-up reminders, or any client-related information.

MANDATORY WORKFLOW:
1. Call with dryRun: true to preview the note that will be saved.
2. Show the user the note content and client name.
3. Ask for confirmation.
4. Call with dryRun: false only after user confirms.`,
      inputSchema: z.object({
        clientName: z.string().describe("The client's name (contact or organization name)"),
        noteContent: z.string().describe("The note text to save"),
        actionItems: z.string().optional().describe("Any follow-up action items to record alongside the note"),
        dryRun: z
          .boolean()
          .default(true)
          .describe("true = preview only (default). false = execute after user confirmed."),
      }),
      execute: async ({ clientName, noteContent, actionItems, dryRun }) => {
        const today = new Date().toISOString().split("T")[0]

        const preview = {
          clientName,
          meetingType: "ALFRED Note",
          meetingDate: today,
          noteContent,
          actionItems: actionItems ?? null,
          createdBy: actorName,
        }

        if (dryRun) {
          return {
            success: true,
            dryRun: true,
            preview,
            message: `Preview: A note will be saved for client **${clientName}** dated ${today}:\n\n"${noteContent}"${actionItems ? `\n\nAction items: ${actionItems}` : ""}\n\nPlease confirm to save.`,
          }
        }

        const db = createAdminClient()
        const { data, error } = await db
          .from("meeting_notes")
          .insert({
            client_name: clientName,
            meeting_date: today,
            meeting_type: "ALFRED Note",
            notes: noteContent,
            action_items: actionItems ?? null,
            status: "completed",
          })
          .select("id")
          .single()

        if (error) {
          return { success: false, error: error.message }
        }

        await auditLog(
          "meeting_notes",
          "client_note_added",
          `Added note for client "${clientName}"`,
          { clientName, noteContent, actionItems: actionItems ?? null },
          data?.id,
        )

        return {
          success: true,
          dryRun: false,
          message: `Done. Note saved for **${clientName}** (ID: ${data?.id}).`,
          noteId: data?.id,
          preview,
        }
      },
    }),
  }

  // ── 6. System prompt ───────────────────────────────────────────────────────
  const SYSTEM_PROMPT = `You are ALFRED, the AI assistant for Motta Hub — Motta Financial's internal business management platform. You are speaking with **${actorName}**.

## What you can do

### Read (always available)

**Clients & Relationships**
- Look up contacts (individuals) and organizations (businesses) — search by name, email, entity type, or manager
- Browse client groups and the contacts/organizations that belong to each group
- Find the client manager and client owner for any client

**Work Items & Projects (Karbon)**
- Find and filter work items by status, work type, assignee, due date, deadline, or tax year
- Summarize work item counts by status, assignee, or client
- Find overdue or upcoming deadline items across any team member or client
- Access Karbon-synced notes, tasks, timesheets, and invoices for any work item

**Team**
- See all team members, their roles, departments, billable rates, and capacity
- Check individual or team-wide workload (open items, overdue, upcoming)
- View time entries by team member, date, or billability

**Meetings & Notes**
- Search meeting notes and debriefs by client name, date, type, or content
- View debrief comments and follow-up actions
- Retrieve notes added by ALFRED or the team for any client

**Financial**
- Look up invoices, payments, and outstanding balances
- Check recurring revenue by client or service type
- Review service agreements and pricing
- Search tax return records by year, form type, filing status, or client

**Calendly**
- See scheduled meetings from Calendly (event name, time, invitee, status)

**Internal Operations**
- View and filter internal tasks by status, assignee, or due date
- Search messages and message comments
- Check team notifications
- Review the activity log and ALFRED audit log
- Look up busy season work item assignments and overrides

**Business Development**
- Browse leads by status, source, or assigned team member
- View pipeline stages and deal progress

**Recognition**
- Tommy Awards leaderboard, weekly ballots, and points history

**System**
- Sync log (check last Karbon sync status and results)
- App settings
- Saved views and dashboard configurations

### Write (with mandatory user confirmation)
You have three write tools. **Every single write action requires a two-step dry-run → confirm flow. No exceptions.**

| Tool | What it does | Allowed fields |
|------|-------------|----------------|
| updateWorkItemStatus | Change a work item's status | Any active status from work_status table |
| updateClientInfo | Update basic client/org fields | contacts: primary_email, status — organizations: primary_email, status, industry |
| addClientNote | Add a note to meeting_notes | Free-form note text + optional action items |

**Write workflow (always follow this):**
1. Gather the information you need via read tools first.
2. Call the write tool with dryRun: true to generate a preview.
3. Present the preview clearly to the user — what will change, from what to what.
4. Ask: "Shall I go ahead?" and wait for an explicit yes.
5. Only then call the write tool with dryRun: false.

**Never skip step 3-4, even if the user says "just do it" upfront.**

## What you must never do
- Modify EIN, SSN, billing rates, Karbon sync keys, or financial records
- Delete any records
- Update records in bulk without explicit per-record confirmation
- Expose raw SSNs or full EINs in your responses — if you see them, omit or mask them

## Response style
- Be concise and direct — you're talking to accounting professionals
- Format numbers as currency when appropriate ($1,234.56)
- Summarize data rather than dumping raw rows
- If a query returns many results, offer to filter or narrow it down
- When showing lists, lead with the most actionable information

## Company context
Motta Financial is a San Francisco-based CPA firm specializing in tax, accounting, and advisory services.

**Data sources you can query:**
- Karbon (practice management) → work_items, karbon_notes, karbon_tasks, karbon_timesheets, karbon_invoices — synced periodically via webhooks and cron
- Calendly → calendly_events, calendly_invitees — synced on demand
- All internal Motta Hub data (contacts, organizations, invoices, tasks, etc.) — live

**Data sources you cannot query (not synced to Supabase):**
- Zoom meetings (integration incomplete)
- Ignition proposals (integration incomplete)
- Raw document file contents (metadata only)

**If data seems stale**, it may be because the Karbon sync hasn't run recently. You can check sync_log to see when the last sync completed.`

  // ── 7. Stream response ─────────────────────────────────────────────────────
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
