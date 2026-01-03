import { NextResponse } from "next/server"

// Complete schema documentation for ALFRED
const SCHEMA_DOCUMENTATION = {
  description: "Motta Hub Database Schema - Complete reference for ALFRED AI Assistant",
  last_updated: "2026-01-03",

  tables: {
    // Core Client Data
    contacts: {
      description: "Individual people - clients, prospects, and business contacts",
      primary_key: "id",
      important_fields: {
        full_name: "Full name of the contact",
        first_name: "First name",
        last_name: "Last name",
        primary_email: "Primary email address",
        contact_type: "Type of contact (individual, business, etc.)",
        status: "Current status",
        client_manager_id: "Assigned client manager (team_members.id)",
        client_owner_id: "Client owner (team_members.id)",
        karbon_contact_key: "Karbon CRM identifier",
      },
      relationships: ["client_manager_id -> team_members.id", "client_owner_id -> team_members.id"],
    },

    organizations: {
      description: "Business entities, companies, and organizations",
      primary_key: "id",
      important_fields: {
        name: "Organization name",
        legal_name: "Legal registered name",
        entity_type: "Business entity type (LLC, Corp, etc.)",
        industry: "Industry classification",
        ein: "Employer Identification Number",
        primary_email: "Primary contact email",
        karbon_organization_key: "Karbon CRM identifier",
      },
    },

    client_groups: {
      description: "Groups of related clients (families, related businesses)",
      primary_key: "id",
      important_fields: {
        name: "Group name",
        group_type: "Type of group (family, business group, etc.)",
        client_manager_id: "Assigned manager",
        client_owner_id: "Client owner partner",
        karbon_client_group_key: "Karbon identifier",
      },
    },

    // Work Management
    work_items: {
      description: "Work items and projects - the main unit of client work tracking",
      primary_key: "id",
      important_fields: {
        title: "Work item title",
        status: "Current status",
        work_type: "Type of work (Tax Return, Bookkeeping, etc.)",
        client_group_name: "Associated client group",
        assignee_name: "Assigned team member name",
        assignee_id: "Assigned team member ID",
        due_date: "Due date",
        tax_year: "Tax year if applicable",
        karbon_work_item_key: "Karbon identifier",
        karbon_url: "Direct link to Karbon",
      },
      relationships: [
        "assignee_id -> team_members.id",
        "client_group_id -> client_groups.id",
        "organization_id -> organizations.id",
        "contact_id -> contacts.id",
      ],
    },

    work_status: {
      description: "Work item status definitions from Karbon",
      primary_key: "id",
      important_fields: {
        name: "Status name",
        karbon_status_key: "Karbon status key",
        is_active: "Whether status represents active work",
        is_default_filter: "Include in default 'active work' filter",
      },
    },

    // Team & Users
    team_members: {
      description: "Motta Financial team members and staff",
      primary_key: "id",
      important_fields: {
        full_name: "Full name",
        email: "Email address",
        role: "Job role/title",
        department: "Department",
        is_active: "Currently active employee",
        karbon_user_key: "Karbon user identifier",
        auth_user_id: "Supabase auth user ID",
      },
    },

    // Debriefs & Meeting Notes
    debriefs: {
      description: "Meeting debriefs and client interaction summaries",
      primary_key: "id",
      important_fields: {
        debrief_date: "Date of the meeting/debrief",
        debrief_type: "Type (Tax Planning, Onboarding, etc.)",
        team_member: "Team member who conducted the meeting",
        organization_name: "Client organization",
        status: "draft, in_progress, completed",
        notes: "Detailed notes from the meeting",
        action_items: "JSON array of follow-up tasks",
        follow_up_date: "Scheduled follow-up date",
      },
    },

    meeting_notes: {
      description: "Structured meeting notes with attendees and action items",
      primary_key: "id",
      important_fields: {
        client_name: "Client name",
        meeting_date: "Date of meeting",
        meeting_type: "Type of meeting",
        attendees: "Array of attendee names",
        notes: "Meeting notes",
        action_items: "Array of action items",
        status: "draft, completed",
      },
    },

    // Karbon Synced Data
    karbon_notes: {
      description: "Notes synced from Karbon practice management",
      primary_key: "id",
      important_fields: {
        subject: "Note subject",
        body: "Note content",
        author_name: "Who wrote the note",
        work_item_title: "Related work item",
        contact_name: "Related contact",
        karbon_note_key: "Karbon identifier",
      },
    },

    karbon_tasks: {
      description: "Tasks synced from Karbon",
      primary_key: "id",
      important_fields: {
        title: "Task title",
        status: "Task status",
        assignee_name: "Assigned to",
        due_date: "Due date",
        priority: "Priority level",
        karbon_task_key: "Karbon identifier",
      },
    },

    karbon_timesheets: {
      description: "Time entries synced from Karbon for billing",
      primary_key: "id",
      important_fields: {
        user_name: "Team member name",
        minutes: "Time in minutes",
        work_item_title: "Work item worked on",
        client_name: "Client name",
        date: "Date of work",
        is_billable: "Whether time is billable",
      },
    },

    // Financial
    invoices: {
      description: "Client invoices and billing",
      primary_key: "id",
      important_fields: {
        invoice_number: "Invoice number",
        total_amount: "Total invoice amount",
        status: "draft, sent, paid, overdue",
        due_date: "Payment due date",
        organization_id: "Billed organization",
        contact_id: "Billed contact",
      },
    },

    recurring_revenue: {
      description: "Recurring revenue tracking for subscription/retainer clients",
      primary_key: "id",
      important_fields: {
        service_type: "Type of recurring service",
        monthly_amount: "Monthly fee",
        annual_amount: "Annual total",
        is_active: "Currently active",
      },
    },

    services: {
      description: "Service offerings and pricing catalog",
      primary_key: "id",
      important_fields: {
        name: "Service name",
        category: "Service category",
        price: "Base price",
        description: "Service description",
        ignition_id: "Ignition proposal system ID",
      },
    },

    // Internal Tasks
    tasks: {
      description: "Internal tasks and to-dos (not Karbon tasks)",
      primary_key: "id",
      important_fields: {
        title: "Task title",
        description: "Task details",
        status: "todo, in_progress, completed",
        assignee_id: "Assigned team member",
        due_date: "Due date",
        priority: "high, medium, low",
        is_completed: "Whether task is done",
      },
    },

    // Tommy Awards
    tommy_award_ballots: {
      description: "Weekly peer recognition voting ballots",
      primary_key: "id",
      important_fields: {
        voter_name: "Who submitted the ballot",
        week_date: "Week being voted on",
        first_place_name: "First place vote",
        first_place_notes: "Why they deserve first place",
        second_place_name: "Second place vote",
        third_place_name: "Third place vote",
      },
    },

    tommy_award_points: {
      description: "Weekly point totals per team member",
      primary_key: "id",
      important_fields: {
        team_member_name: "Team member",
        week_date: "Week",
        total_points: "Points earned that week",
        first_place_votes: "Number of 1st place votes received",
      },
    },

    tommy_award_yearly_totals: {
      description: "Year-to-date Tommy Award standings",
      primary_key: "id",
      important_fields: {
        team_member_name: "Team member",
        year: "Year",
        total_points: "Total points for the year",
        current_rank: "Current ranking",
      },
    },

    // Tax
    tax_returns: {
      description: "Tax return records and filing status",
      primary_key: "id",
      important_fields: {
        tax_year: "Tax year",
        form_type: "Form type (1040, 1120, etc.)",
        filing_status: "Single, MFJ, etc.",
        status: "In Progress, Filed, etc.",
        contact_id: "Individual taxpayer",
        organization_id: "Business taxpayer",
      },
    },
  },

  common_queries: {
    active_work_items: "SELECT * FROM work_items WHERE status NOT IN ('Completed', 'Cancelled')",
    team_workload: "SELECT assignee_name, COUNT(*) FROM work_items WHERE status = 'In Progress' GROUP BY assignee_name",
    upcoming_deadlines: "SELECT * FROM work_items WHERE due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'",
    recent_debriefs: "SELECT * FROM debriefs ORDER BY debrief_date DESC LIMIT 10",
    tommy_leaders: "SELECT * FROM tommy_award_yearly_totals WHERE year = 2026 ORDER BY total_points DESC",
  },

  api_endpoints: {
    "/api/alfred/data": "Query any table with filters, search, and pagination",
    "/api/alfred/schema": "Get this schema documentation",
    "/api/alfred/stats": "Get dashboard statistics and summaries",
    "/api/alfred/search": "Full-text search across all tables",
  },
}

export async function GET() {
  return NextResponse.json({
    success: true,
    ...SCHEMA_DOCUMENTATION,
  })
}
