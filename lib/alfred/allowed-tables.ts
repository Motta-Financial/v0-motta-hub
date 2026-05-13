/**
 * Single source of truth for which Supabase tables ALFRED is allowed to
 * read, plus lightweight schema hints used both:
 *   1. In the JSON response of /api/alfred/data (the "what tables exist?"
 *      probe), and
 *   2. In the LLM system prompt of /api/alfred/chat, so the model knows
 *      every table it can ask `queryDatabase` about AND the columns it
 *      can filter / select / order by.
 *
 * The previous version of this file shipped a `key_columns` array per
 * table but never surfaced those columns to the model -- the catalog
 * function only emitted descriptions. That meant ALFRED had to guess
 * column names, frequently produced errors like
 * `column "notes.body" does not exist`, and then fell back to "I'm
 * afraid I haven't that information to hand". The catalog now embeds
 * the column hints inline so the model can compose a correct
 * `queryDatabase` call on the first try.
 *
 * Adding a new table:
 *   1. Add the name to ALLOWED_TABLES.
 *   2. Add a TABLE_SCHEMAS entry. `key_columns` MUST match the live
 *      Supabase schema -- if you're not sure, query
 *      `information_schema.columns` for the table.
 *   3. (Optional) Add an entry to getSearchColumns() in data/route.ts
 *      if free-text search across the table makes sense.
 */

// -- The canonical allow-list ----------------------------------------------
// Order: alphabetical, no exceptions, so additions don't churn diffs.
// `as const` so AllowedTable is a string-literal union, not just `string`.
export const ALLOWED_TABLES = [
  "activity_log",
  "client_group_members",
  "client_groups",
  "clients_unified",
  "contact_organizations",
  "contacts",
  "dashboard_widgets",
  "dashboards",
  "debriefs",
  "debriefs_full",
  "documents",
  "emails",
  "ignition_proposals",
  "invoice_line_items",
  "invoices",
  "karbon_notes",
  "karbon_tasks",
  "karbon_timesheets",
  "leads",
  "master_client_mapping",
  "meeting_attendees",
  "meetings",
  "message_comments",
  "message_reactions",
  "messages",
  "motta_recurring_revenue",
  "motta_recurring_revenue_by_client",
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
  "work_items_enriched",
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
// columns most useful for filtering, ordering, or rendering -- they are
// surfaced to the model so it knows what to pass to `filters` / `select`.
//
// IMPORTANT: every column listed in `key_columns` MUST exist in the live
// Supabase schema. Inaccurate hints poison the model and lead to
// "column X does not exist" errors at query time. When in doubt, prefer
// a smaller, accurate list over a larger speculative one.
export const TABLE_SCHEMAS: Record<
  AllowedTable,
  { description: string; key_columns: string[] }
> = {
  // -- Core people / orgs --------------------------------------------------
  team_members: {
    description: "Motta Financial team members and staff",
    key_columns: [
      "id",
      "full_name",
      "first_name",
      "last_name",
      "email",
      "role",
      "title",
      "department",
      "is_active",
      "is_service_account",
      "karbon_user_key",
    ],
  },
  contacts: {
    description: "Individual people - clients, prospects, and contacts",
    key_columns: [
      "id",
      "full_name",
      "first_name",
      "last_name",
      "primary_email",
      "secondary_email",
      "phone_primary",
      "contact_type",
      "entity_type",
      "status",
      "is_prospect",
      "city",
      "state",
      "client_owner_key",
      "client_manager_key",
      "karbon_contact_key",
    ],
  },
  organizations: {
    description: "Business entities and companies",
    key_columns: [
      "id",
      "name",
      "legal_name",
      "trading_name",
      "entity_type",
      "industry",
      "primary_email",
      "phone",
      "city",
      "state",
      "status",
      "client_owner_key",
      "client_manager_key",
      "karbon_organization_key",
    ],
  },
  contact_organizations: {
    description: "Junction table linking contacts to the organizations they belong to",
    key_columns: [
      "id",
      "contact_id",
      "organization_id",
      "role_or_title",
      "is_primary_contact",
      "ownership_percentage",
    ],
  },
  client_groups: {
    description: "Groups of related clients (families, businesses)",
    key_columns: [
      "id",
      "name",
      "group_type",
      "primary_contact_id",
      "primary_contact_name",
      "client_manager_id",
      "client_manager_name",
      "client_owner_id",
      "client_owner_name",
      "contact_type",
      "karbon_client_group_key",
    ],
  },
  client_group_members: {
    description: "Membership rows linking contacts into a client_group",
    key_columns: [
      "id",
      "client_group_id",
      "contact_id",
      "role",
      "relationship",
      "is_primary",
    ],
  },
  clients_unified: {
    description:
      "Read-only view: flat client list merged across Karbon contacts/orgs. Best place to answer 'who is client X?' without joining.",
    key_columns: [
      "id",
      "name",
      "primary_email",
      "phone",
      "city",
      "state",
      "client_type",
      "status",
      "karbon_key",
      "karbon_url",
      "client_manager_key",
      "client_owner_key",
    ],
  },
  master_client_mapping: {
    description:
      "Read-only view: cross-system client mapping (Karbon ↔ Ignition ↔ ProConnect). Use to answer 'is this client in system X?'",
    key_columns: [
      "internal_client_id",
      "display_name",
      "client_type",
      "primary_email",
      "linked_systems",
      "karbon_client_id",
      "ignition_client_id",
      "proconnect_client_id",
      "link_count",
    ],
  },
  leads: {
    description: "Prospective clients in the sales pipeline (pre-conversion)",
    key_columns: [
      "id",
      "first_name",
      "last_name",
      "email",
      "phone",
      "company_name",
      "stage",
      "source",
      "source_detail",
      "assigned_to_id",
      "estimated_revenue",
      "is_converted",
      "inquiry_date",
      "next_follow_up_date",
    ],
  },

  // -- Karbon work ---------------------------------------------------------
  work_items: {
    description:
      "Work items and projects from Karbon - the main unit of client work. Status/workflow_status are free-text Karbon labels (e.g. 'In Progress', 'Ready to Start', 'Completed', 'Cancelled').",
    key_columns: [
      "id",
      "title",
      "status",
      "primary_status",
      "secondary_status",
      "workflow_status",
      "work_type",
      "client_name",
      "client_group_name",
      "assignee_id",
      "assignee_name",
      "client_owner_name",
      "client_manager_name",
      "due_date",
      "start_date",
      "completed_date",
      "tax_year",
      "is_recurring",
      "is_billable",
      "karbon_work_item_key",
      "karbon_url",
    ],
  },
  work_items_enriched: {
    description:
      "Read-only view: work_items joined with assignee/owner/manager/contact/org names already denormalised. Prefer this for any read-only question about a work item.",
    key_columns: [
      "id",
      "title",
      "status",
      "workflow_status",
      "work_type",
      "client_name",
      "assignee_full_name",
      "owner_full_name",
      "manager_full_name",
      "contact_full_name",
      "contact_email",
      "org_name",
      "org_email",
      "due_date",
      "tax_year",
    ],
  },
  work_item_assignees: {
    description: "Multi-assignee links for work_items (one row per assignee)",
    key_columns: ["id", "work_item_id", "team_member_id", "role", "is_primary"],
  },
  work_status: {
    description: "Work item status definitions",
    key_columns: [
      "id",
      "name",
      "primary_status_name",
      "secondary_status_name",
      "status_type",
      "is_active",
      "is_default_filter",
    ],
  },
  work_types: {
    description: "Work type definitions (Tax Return, Bookkeeping, Advisory, etc.)",
    key_columns: [
      "id",
      "name",
      "code",
      "form_type",
      "service_line_id",
      "is_active",
      "is_recurring",
      "default_budget_minutes",
    ],
  },
  karbon_notes: {
    description: "Notes synced from Karbon practice management",
    key_columns: [
      "id",
      "subject",
      "body",
      "author_name",
      "note_type",
      "work_item_id",
      "work_item_title",
      "contact_id",
      "contact_name",
      "is_pinned",
      "karbon_created_at",
    ],
  },
  karbon_tasks: {
    description: "Tasks synced from Karbon",
    key_columns: [
      "id",
      "title",
      "description",
      "status",
      "assignee_name",
      "assignee_email",
      "due_date",
      "completed_date",
      "priority",
      "work_item_id",
      "is_blocking",
    ],
  },
  karbon_timesheets: {
    description: "Time entries synced from Karbon",
    key_columns: [
      "id",
      "user_name",
      "minutes",
      "date",
      "description",
      "work_item_title",
      "client_name",
      "is_billable",
      "billing_status",
      "task_type_name",
    ],
  },

  // -- Tax / compliance ----------------------------------------------------
  tax_returns: {
    description: "Tax return records and filing information",
    key_columns: [
      "id",
      "tax_year",
      "form_type",
      "filing_status",
      "status",
      "contact_id",
      "organization_id",
      "due_date: original_due_date",
      "original_due_date",
      "extended_due_date",
      "filed_date",
      "is_extended",
      "total_tax",
      "refund_amount",
      "amount_due",
    ],
  },

  // -- Internal tasks & notes ---------------------------------------------
  tasks: {
    description: "Internal tasks and to-dos (Motta-owned, not synced from Karbon)",
    key_columns: [
      "id",
      "title",
      "description",
      "status",
      "priority",
      "assignee_id",
      "due_date",
      "start_date",
      "is_completed",
      "completed_at",
      "contact_id",
      "organization_id",
      "work_item_id",
      "debrief_id",
    ],
  },
  notes: {
    description: "Internal notes attached to contacts, organizations, or work items",
    key_columns: [
      "id",
      "title",
      "content",
      "content_type",
      "note_type",
      "author_id",
      "contact_id",
      "organization_id",
      "work_item_id",
      "client_group_id",
      "is_pinned",
      "is_private",
      "created_at",
    ],
  },
  documents: {
    description:
      "Files and attachments stored against entities (contracts, returns, statements). Linked via work_item_id / organization_id / contact_id, NOT entity_type/entity_id.",
    key_columns: [
      "id",
      "name",
      "description",
      "document_type",
      "file_type",
      "mime_type",
      "file_size_bytes",
      "tax_year",
      "uploaded_by_id",
      "uploaded_at",
      "contact_id",
      "organization_id",
      "work_item_id",
      "status",
    ],
  },
  tags: {
    description: "Free-form tags attachable to contacts, orgs, work items, etc.",
    key_columns: ["id", "name", "color", "entity_type", "description"],
  },

  // -- Meetings / debriefs / messaging ------------------------------------
  meetings: {
    description: "Scheduled meetings (Calendly, Zoom, manual entries)",
    key_columns: [
      "id",
      "title",
      "meeting_type",
      "status",
      "scheduled_start",
      "scheduled_end",
      "duration_minutes",
      "host_id",
      "contact_id",
      "organization_id",
      "work_item_id",
      "location_type",
      "calendly_event_id",
      "zoom_meeting_id",
    ],
  },
  meeting_attendees: {
    description: "Attendee rows for meetings (one row per attendee)",
    key_columns: [
      "id",
      "meeting_id",
      "team_member_id",
      "contact_id",
      "external_name",
      "external_email",
      "response_status",
      "attended",
    ],
  },
  debriefs: {
    description:
      "Meeting debriefs and client interaction summaries. team_member_id (uuid) links to the staff member who ran the debrief; there is NO bare 'team_member' column.",
    key_columns: [
      "id",
      "debrief_date",
      "debrief_type",
      "status",
      "notes",
      "team_member_id",
      "created_by_id",
      "contact_id",
      "organization_id",
      "organization_name",
      "client_manager_name",
      "client_owner_name",
      "client_type",
      "contact_type",
      "role",
      "filing_status",
      "state_tax",
      "tax_year",
      "follow_up_date",
      "recurring_revenue",
      "adjusted_gross_income",
      "taxable_income",
    ],
  },
  debriefs_full: {
    description:
      "Read-only view: debriefs joined with team member, contact, work item, and organization display names. Prefer this for any read-only debrief question.",
    key_columns: [
      "id",
      "debrief_date",
      "debrief_type",
      "status",
      "team_member_full_name",
      "created_by_full_name",
      "contact_full_name",
      "organization_display_name",
      "work_item_title",
      "tax_year",
      "follow_up_date",
      "recurring_revenue",
    ],
  },
  messages: {
    description:
      "Internal message-board posts authored by team members. Body lives in `content`, not `body`. There is no channel or title column -- it is a single flat feed.",
    key_columns: [
      "id",
      "author_id",
      "author_name",
      "author_initials",
      "content",
      "gif_url",
      "is_pinned",
      "created_at",
      "updated_at",
    ],
  },
  message_comments: {
    description: "Comments on internal message-board posts (use `content`, not `body`)",
    key_columns: [
      "id",
      "message_id",
      "author_id",
      "author_name",
      "author_initials",
      "content",
      "created_at",
    ],
  },
  message_reactions: {
    description:
      "Emoji reactions on messages. Column is `emoji` (not `reaction`); there is no separate comment_id column -- reactions are attached to messages only.",
    key_columns: ["id", "message_id", "team_member_id", "emoji", "created_at"],
  },
  emails: {
    description:
      "Inbound and outbound email records logged against contacts/work items. Recipient column is the array `to_emails`, not `to_email`.",
    key_columns: [
      "id",
      "subject",
      "from_email",
      "from_name",
      "to_emails",
      "cc_emails",
      "bcc_emails",
      "direction",
      "sent_at",
      "received_at",
      "contact_id",
      "organization_id",
      "work_item_id",
      "is_read",
      "is_archived",
    ],
  },

  // -- Billing / revenue ---------------------------------------------------
  invoices: {
    description: "Client invoices and billing records",
    key_columns: [
      "id",
      "invoice_number",
      "status",
      "invoice_date",
      "due_date",
      "paid_date",
      "subtotal",
      "total_amount",
      "amount_paid",
      "balance_due",
      "organization_id",
      "contact_id",
      "work_item_id",
      "payment_terms",
      "payment_method",
    ],
  },
  invoice_line_items: {
    description: "Per-service line items on an invoice (amount = total, no `total` column)",
    key_columns: [
      "id",
      "invoice_id",
      "work_item_id",
      "time_entry_id",
      "description",
      "quantity",
      "unit_price",
      "amount",
      "is_taxable",
      "tax_rate",
      "sort_order",
    ],
  },
  payments: {
    description: "Payments received against invoices (use payment_date, not received_at)",
    key_columns: [
      "id",
      "invoice_id",
      "amount",
      "payment_method",
      "payment_date",
      "status",
      "reference_number",
      "organization_id",
      "contact_id",
    ],
  },
  time_entries: {
    description: "Time tracking entries for billing",
    key_columns: [
      "id",
      "team_member_id",
      "date",
      "minutes",
      "description",
      "is_billable",
      "is_billed",
      "hourly_rate",
      "amount",
      "work_item_id",
      "task_id",
      "contact_id",
      "organization_id",
      "activity_type",
    ],
  },
  services: {
    description: "Service offerings and pricing",
    key_columns: [
      "id",
      "name",
      "description",
      "category",
      "subcategory",
      "price",
      "min_price",
      "max_price",
      "price_type",
      "billing_mode",
      "state",
    ],
  },
  service_lines: {
    description: "Service line groupings (e.g. Tax, Bookkeeping, Advisory)",
    key_columns: [
      "id",
      "name",
      "code",
      "category",
      "description",
      "color",
      "icon",
      "is_active",
      "display_order",
    ],
  },
  service_agreements: {
    description:
      "Active client engagement letters / scope-of-work agreements (services is an ARRAY, no service_id FK)",
    key_columns: [
      "id",
      "name",
      "agreement_type",
      "status",
      "start_date",
      "end_date",
      "client_group_id",
      "organization_id",
      "contact_id",
      "billing_frequency",
      "pricing_type",
      "fixed_fee",
      "hourly_rate",
      "retainer_amount",
      "is_recurring",
      "services",
    ],
  },
  recurring_revenue: {
    description: "Recurring revenue tracking for clients",
    key_columns: [
      "id",
      "service_type",
      "monthly_amount",
      "annual_amount",
      "is_active",
      "start_date",
      "end_date",
      "next_billing_date",
      "last_billed_date",
      "client_group_id",
      "organization_id",
      "contact_id",
    ],
  },
  motta_recurring_revenue: {
    description:
      "Motta-internal recurring-revenue ledger imported from Airtable (per service line, per cadence).",
    key_columns: [
      "id",
      "client_name",
      "normalized_name",
      "department",
      "service_type",
      "cadence",
      "service_fee",
      "one_time_fee",
      "client_group",
      "client_status",
      "source",
      "notes",
    ],
  },
  motta_recurring_revenue_by_client: {
    description:
      "Read-only view: motta_recurring_revenue rolled up per client with MRR/ARR totals. Best place to answer 'what is client X's MRR?'.",
    key_columns: [
      "client_name",
      "normalized_name",
      "department",
      "mrr",
      "arr",
      "one_time_total",
      "service_line_count",
      "service_types",
      "has_monthly",
      "has_quarterly",
    ],
  },
  ignition_proposals: {
    description: "Proposals issued via Ignition (status, value, signer)",
    key_columns: [
      "proposal_id",
      "client_name",
      "client_email",
      "title",
      "status",
      "total_value",
      "amount",
      "currency",
      "recurring_total",
      "one_time_total",
      "recurring_frequency",
      "sent_at",
      "accepted_at",
      "lost_at",
      "lost_reason",
      "proposal_sent_by",
      "client_manager",
      "client_partner",
      "contact_id",
      "organization_id",
    ],
  },

  // -- Pipelines -----------------------------------------------------------
  pipelines: {
    description: "Sales / workflow pipeline definitions",
    key_columns: ["id", "name", "pipeline_type", "is_active", "is_default", "description"],
  },
  pipeline_stages: {
    description: "Ordered stages within a pipeline (use sort_order, not position)",
    key_columns: [
      "id",
      "pipeline_id",
      "name",
      "sort_order",
      "is_won",
      "is_lost",
      "is_final",
      "color",
    ],
  },

  // -- Dashboards / saved views -------------------------------------------
  dashboards: {
    description:
      "User- or team-defined dashboards composed of widgets (owner is team_member_id)",
    key_columns: ["id", "name", "team_member_id", "is_default", "layout", "created_at"],
  },
  dashboard_widgets: {
    description:
      "Individual widgets pinned to a dashboard (position is position_x / position_y)",
    key_columns: [
      "id",
      "dashboard_id",
      "widget_type",
      "title",
      "config",
      "position_x",
      "position_y",
      "width",
      "height",
    ],
  },
  saved_views: {
    description: "Saved filter/sort/column configurations for list pages (owner = team_member_id)",
    key_columns: [
      "id",
      "team_member_id",
      "entity_type",
      "name",
      "filters",
      "columns",
      "sort_by",
      "sort_order",
      "is_default",
      "is_shared",
    ],
  },

  // -- System --------------------------------------------------------------
  activity_log: {
    description: "Tracks all user activities and changes in the system",
    key_columns: [
      "id",
      "team_member_id",
      "entity_type",
      "entity_id",
      "action",
      "description",
      "metadata",
      "changes",
      "created_at",
    ],
  },
  notifications: {
    description:
      "User-facing notifications (mentions, assignments, due dates). Type lives in notification_type, not type.",
    key_columns: [
      "id",
      "team_member_id",
      "notification_type",
      "entity_type",
      "entity_id",
      "title",
      "message",
      "action_url",
      "is_read",
      "read_at",
      "created_at",
    ],
  },
  sync_log: {
    description:
      "Audit log of integration sync runs (Karbon, Calendly, Zoom). Source identifier is sync_type/sync_direction; there is no `source` column.",
    key_columns: [
      "id",
      "sync_type",
      "sync_direction",
      "status",
      "is_manual",
      "triggered_by_id",
      "records_fetched",
      "records_created",
      "records_updated",
      "records_failed",
      "started_at",
      "completed_at",
      "error_message",
    ],
  },

  // -- Tommy Awards --------------------------------------------------------
  tommy_award_ballots: {
    description: "Weekly Tommy Award voting ballots",
    key_columns: [
      "id",
      "voter_id",
      "voter_name",
      "week_id",
      "week_date",
      "first_place_name",
      "second_place_name",
      "third_place_name",
      "honorable_mention_name",
      "partner_vote_name",
      "submitted_at",
    ],
  },
  tommy_award_points: {
    description: "Tommy Award points by team member per week",
    key_columns: [
      "id",
      "team_member_id",
      "team_member_name",
      "week_id",
      "week_date",
      "first_place_votes",
      "second_place_votes",
      "third_place_votes",
      "honorable_mention_votes",
      "partner_votes",
      "total_points",
    ],
  },
  tommy_award_weeks: {
    description:
      "Tommy Award week records (no status/winner_name/closed_at; use is_active and voting_deadline).",
    key_columns: ["id", "week_date", "week_name", "is_active", "voting_deadline"],
  },
  tommy_award_yearly_totals: {
    description: "Yearly Tommy Award totals and rankings",
    key_columns: [
      "id",
      "team_member_id",
      "team_member_name",
      "year",
      "total_points",
      "total_first_place_votes",
      "total_second_place_votes",
      "total_third_place_votes",
      "total_honorable_mention_votes",
      "total_partner_votes",
      "weeks_participated",
      "current_rank",
    ],
  },
}

/**
 * Build the markdown bullet list ALFRED's `queryDatabase` tool
 * description embeds. We render `table: description (cols: a, b, c)`
 * per line. The inline column hints are essential -- without them the
 * model has to guess column names and frequently chooses ones that
 * don't exist (e.g. notes.body, debriefs.team_member).
 *
 * Sorted alphabetically (same order as ALLOWED_TABLES) for predictable
 * diffs and predictable token usage.
 */
export function buildTableCatalog(): string {
  return ALLOWED_TABLES.map((t) => {
    const schema = TABLE_SCHEMAS[t]
    if (!schema) return `- ${t}: (no description)`
    const cols = schema.key_columns.length
      ? ` — cols: ${schema.key_columns.join(", ")}`
      : ""
    return `- ${t}: ${schema.description}${cols}`
  }).join("\n")
}
