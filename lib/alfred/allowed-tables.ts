/**
 * Single source of truth for which Supabase tables ALFRED is allowed to
 * read, plus lightweight descriptions used both:
 *   1. In the JSON response of /api/alfred/data (the "what tables exist?"
 *      probe), and
 *   2. In the LLM system prompt of /api/alfred/chat, so the model knows
 *      every table it can ask `queryDatabase` about.
 *
 * Previously these constants lived only in `app/api/alfred/data/route.ts`
 * and the chat route had a hard-coded ~15-item bullet list in the
 * `queryDatabase` tool description. That meant ALFRED was effectively
 * blind to the other ~30 tables it was technically allowed to query.
 *
 * Adding a new table:
 *   1. Add the name to ALLOWED_TABLES.
 *   2. Add a TABLE_SCHEMAS entry with a one-line description and the
 *      handful of key columns most useful for filtering / displaying.
 *   3. (Optional) Add an entry to getSearchColumns() in data/route.ts if
 *      free-text search across the table makes sense.
 */

// -- The canonical allow-list ----------------------------------------------
// Order: alphabetical, no exceptions, so additions don't churn diffs.
// `as const` so AllowedTable is a string-literal union, not just `string`.
export const ALLOWED_TABLES = [
  "activity_log",
  "client_group_members",
  "client_groups",
  "contact_organizations",
  "contacts",
  "dashboard_widgets",
  "dashboards",
  "debriefs",
  "documents",
  "emails",
  "ignition_proposals",
  "invoice_line_items",
  "invoices",
  "karbon_notes",
  "karbon_tasks",
  "karbon_timesheets",
  "leads",
  "meeting_attendees",
  "meetings",
  "message_comments",
  "message_reactions",
  "messages",
  "notes",
  "notifications",
  "organizations",
  "payments",
  "pipeline_stages",
  "pipelines",
  "recurring_revenue",
  "saved_views",
  "service_agreements",
  "service_lines",
  "services",
  "sync_log",
  "tags",
  "tasks",
  "tax_returns",
  "team_members",
  "time_entries",
  "tommy_award_ballots",
  "tommy_award_points",
  "tommy_award_weeks",
  "tommy_award_yearly_totals",
  "work_item_assignees",
  "work_items",
  "work_status",
  "work_types",
] as const

export type AllowedTable = (typeof ALLOWED_TABLES)[number]

/** Cheap O(1) membership check used by both routes. */
export function isAllowedTable(name: string): name is AllowedTable {
  return (ALLOWED_TABLES as readonly string[]).includes(name)
}

// -- Per-table descriptions ------------------------------------------------
// These show up verbatim in the queryDatabase tool description, so keep
// them concise and oriented toward "what kind of question would I ask
// this table?" rather than full DDL documentation. `key_columns` are the
// columns most useful for filtering, ordering, or rendering — they are
// surfaced to the model so it knows what to pass to `filters` / `select`.
export const TABLE_SCHEMAS: Record<
  AllowedTable,
  { description: string; key_columns: string[] }
> = {
  // -- Core people / orgs --------------------------------------------------
  team_members: {
    description: "Motta Financial team members and staff",
    key_columns: ["id", "full_name", "email", "role", "department", "is_active"],
  },
  contacts: {
    description: "Individual people - clients, prospects, and contacts",
    key_columns: ["id", "full_name", "primary_email", "contact_type", "status"],
  },
  organizations: {
    description: "Business entities and companies",
    key_columns: ["id", "name", "entity_type", "industry", "primary_email"],
  },
  contact_organizations: {
    description: "Junction table linking contacts to the organizations they belong to",
    key_columns: ["id", "contact_id", "organization_id", "role", "is_primary"],
  },
  client_groups: {
    description: "Groups of related clients (families, businesses)",
    key_columns: ["id", "name", "group_type", "client_manager_id", "client_owner_id"],
  },
  client_group_members: {
    description: "Membership rows linking contacts/orgs into a client_group",
    key_columns: ["id", "client_group_id", "contact_id", "organization_id", "role"],
  },
  leads: {
    description: "Prospective clients in the sales pipeline (pre-conversion)",
    key_columns: ["id", "first_name", "last_name", "email", "company_name", "status", "source"],
  },

  // -- Karbon work ---------------------------------------------------------
  work_items: {
    description: "Work items and projects from Karbon - the main unit of client work",
    key_columns: [
      "id",
      "title",
      "status",
      "work_type",
      "client_group_name",
      "assignee_name",
      "due_date",
    ],
  },
  work_item_assignees: {
    description: "Multi-assignee links for work_items (one row per assignee)",
    key_columns: ["id", "work_item_id", "team_member_id", "role"],
  },
  work_status: {
    description: "Work item status definitions",
    key_columns: ["id", "name", "is_active", "is_default_filter"],
  },
  work_types: {
    description: "Work type definitions (Tax Return, Bookkeeping, Advisory, etc.)",
    key_columns: ["id", "name", "category", "is_active"],
  },
  karbon_notes: {
    description: "Notes synced from Karbon practice management",
    key_columns: ["id", "subject", "body", "author_name", "work_item_title", "contact_name"],
  },
  karbon_tasks: {
    description: "Tasks synced from Karbon",
    key_columns: ["id", "title", "status", "assignee_name", "due_date", "priority"],
  },
  karbon_timesheets: {
    description: "Time entries synced from Karbon",
    key_columns: ["id", "user_name", "minutes", "work_item_title", "client_name", "date"],
  },

  // -- Tax / compliance ----------------------------------------------------
  tax_returns: {
    description: "Tax return records and filing information",
    key_columns: ["id", "tax_year", "form_type", "filing_status", "status", "contact_id"],
  },

  // -- Internal tasks & notes ---------------------------------------------
  tasks: {
    description: "Internal tasks and to-dos",
    key_columns: ["id", "title", "status", "assignee_id", "due_date", "priority"],
  },
  notes: {
    description: "Internal notes attached to contacts, organizations, or work items",
    key_columns: ["id", "body", "author_id", "entity_type", "entity_id", "created_at"],
  },
  documents: {
    description: "Files and attachments stored against entities (contracts, returns, statements)",
    key_columns: ["id", "name", "entity_type", "entity_id", "uploaded_by", "created_at"],
  },
  tags: {
    description: "Free-form tags attachable to contacts, orgs, work items, etc.",
    key_columns: ["id", "name", "color", "entity_type"],
  },

  // -- Meetings / debriefs / messaging ------------------------------------
  meetings: {
    description: "Scheduled meetings (Calendly, Zoom, manual entries)",
    key_columns: ["id", "title", "start_time", "duration_minutes", "host_id", "source"],
  },
  meeting_attendees: {
    description: "Attendee rows for meetings (one row per attendee)",
    key_columns: ["id", "meeting_id", "contact_id", "team_member_id", "response_status"],
  },
  debriefs: {
    description: "Meeting debriefs and client interaction summaries",
    key_columns: [
      "id",
      "debrief_date",
      "debrief_type",
      "team_member",
      "organization_name",
      "status",
      "notes",
    ],
  },
  messages: {
    description: "Internal message-board posts authored by team members",
    key_columns: ["id", "author_id", "channel", "title", "body", "created_at"],
  },
  message_comments: {
    description: "Comments on internal message-board posts",
    key_columns: ["id", "message_id", "author_id", "body", "created_at"],
  },
  message_reactions: {
    description: "Emoji reactions on messages and comments",
    key_columns: ["id", "message_id", "comment_id", "team_member_id", "reaction"],
  },
  emails: {
    description: "Inbound and outbound email records logged against contacts/work items",
    key_columns: ["id", "subject", "from_email", "to_email", "direction", "sent_at"],
  },

  // -- Billing / revenue ---------------------------------------------------
  invoices: {
    description: "Client invoices and billing records",
    key_columns: ["id", "invoice_number", "total_amount", "status", "due_date", "organization_id"],
  },
  invoice_line_items: {
    description: "Per-service line items on an invoice",
    key_columns: ["id", "invoice_id", "service_id", "description", "quantity", "unit_price", "total"],
  },
  payments: {
    description: "Payments received against invoices",
    key_columns: ["id", "invoice_id", "amount", "payment_method", "received_at", "status"],
  },
  time_entries: {
    description: "Time tracking entries for billing",
    key_columns: ["id", "team_member_id", "minutes", "description", "date", "is_billable"],
  },
  services: {
    description: "Service offerings and pricing",
    key_columns: ["id", "name", "category", "price", "description"],
  },
  service_lines: {
    description: "Service line groupings (e.g. Tax, Bookkeeping, Advisory)",
    key_columns: ["id", "name", "description", "is_active"],
  },
  service_agreements: {
    description: "Active client engagement letters / scope-of-work agreements",
    key_columns: ["id", "client_group_id", "service_id", "start_date", "end_date", "status"],
  },
  recurring_revenue: {
    description: "Recurring revenue tracking for clients",
    key_columns: ["id", "service_type", "monthly_amount", "annual_amount", "is_active"],
  },
  ignition_proposals: {
    description: "Proposals issued via Ignition (status, value, signer)",
    key_columns: ["id", "client_name", "title", "status", "total_value", "sent_at"],
  },

  // -- Pipelines -----------------------------------------------------------
  pipelines: {
    description: "Sales / workflow pipeline definitions",
    key_columns: ["id", "name", "entity_type", "is_active"],
  },
  pipeline_stages: {
    description: "Ordered stages within a pipeline",
    key_columns: ["id", "pipeline_id", "name", "position", "is_won", "is_lost"],
  },

  // -- Dashboards / saved views -------------------------------------------
  dashboards: {
    description: "User- or team-defined dashboards composed of widgets",
    key_columns: ["id", "name", "owner_id", "is_shared", "created_at"],
  },
  dashboard_widgets: {
    description: "Individual widgets pinned to a dashboard",
    key_columns: ["id", "dashboard_id", "widget_type", "config", "position"],
  },
  saved_views: {
    description: "Saved filter/sort/column configurations for list pages",
    key_columns: ["id", "owner_id", "entity_type", "name", "filters"],
  },

  // -- System --------------------------------------------------------------
  activity_log: {
    description: "Tracks all user activities and changes in the system",
    key_columns: ["id", "entity_type", "action", "team_member_id", "created_at"],
  },
  notifications: {
    description: "User-facing notifications (mentions, assignments, due dates)",
    key_columns: ["id", "team_member_id", "type", "title", "is_read", "created_at"],
  },
  sync_log: {
    description: "Audit log of integration sync runs (Karbon, Calendly, Zoom)",
    key_columns: ["id", "source", "status", "records_processed", "started_at", "completed_at"],
  },

  // -- Tommy Awards --------------------------------------------------------
  tommy_award_ballots: {
    description: "Weekly Tommy Award voting ballots",
    key_columns: ["id", "voter_name", "week_date", "first_place_name", "second_place_name"],
  },
  tommy_award_points: {
    description: "Tommy Award points by team member per week",
    key_columns: ["id", "team_member_name", "week_date", "total_points"],
  },
  tommy_award_weeks: {
    description: "Tommy Award week records (open/close status, results posted)",
    key_columns: ["id", "week_date", "status", "winner_name", "closed_at"],
  },
  tommy_award_yearly_totals: {
    description: "Yearly Tommy Award totals and rankings",
    key_columns: ["id", "team_member_name", "year", "total_points", "current_rank"],
  },
}

/**
 * Build the markdown bullet list ALFRED's `queryDatabase` tool
 * description embeds. We render `table: description` on each line; the
 * model picks up key_columns separately by sampling rows or by calling
 * the data API. Sorted alphabetically for predictable diffs.
 */
export function buildTableCatalog(): string {
  return ALLOWED_TABLES.map(
    (t) => `- ${t}: ${TABLE_SCHEMAS[t]?.description ?? "(no description)"}`,
  ).join("\n")
}
