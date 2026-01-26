# ALFRED AI Assistant Integration Guide

This guide explains how to configure the ALFRED AI Assistant (https://alfred.motta.cpa/) to access all Motta Hub Supabase data through the API endpoints.

## Overview

The Motta Hub provides 4 API endpoints for ALFRED to access all data:

| Endpoint | Purpose |
|----------|---------|
| `/api/alfred/schema` | Get database schema and available tables |
| `/api/alfred/data` | Query any table with filters |
| `/api/alfred/search` | Full-text search across all data |
| `/api/alfred/stats` | Get dashboard statistics |

## Base URL

All API endpoints are available at your Motta Hub deployment URL:
- Production: `https://your-motta-hub.vercel.app`
- The endpoints require no authentication (add API key auth if needed for production)

---

## API Endpoint Documentation

### 1. Schema Endpoint

**GET `/api/alfred/schema`**

Returns complete documentation of all 50+ Supabase tables, their fields, relationships, and example queries.

\`\`\`bash
curl https://your-motta-hub.vercel.app/api/alfred/schema
\`\`\`

**Response includes:**
- All table names and descriptions
- Field definitions with types
- Relationships between tables
- Common query examples

---

### 2. Data Query Endpoint

**GET `/api/alfred/data`**

Query any table with optional filters, search, and pagination.

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `table` | string | Required. Table name (e.g., `work_items`, `contacts`) |
| `select` | string | Fields to return (default: `*`) |
| `search` | string | Search term for text fields |
| `limit` | number | Max rows to return (default: 50, max: 100) |
| `offset` | number | Pagination offset |
| `orderBy` | string | Field to sort by |
| `orderDir` | string | Sort direction: `asc` or `desc` |

**Example - Get all active work items:**
\`\`\`bash
curl "https://your-motta-hub.vercel.app/api/alfred/data?table=work_items&limit=20"
\`\`\`

**Example - Search contacts:**
\`\`\`bash
curl "https://your-motta-hub.vercel.app/api/alfred/data?table=contacts&search=Johnson"
\`\`\`

**POST `/api/alfred/data`**

For complex queries with advanced filters.

**Request Body:**
\`\`\`json
{
  "table": "work_items",
  "select": "id,Title,ClientName,AssigneeName,DueDate",
  "filters": {
    "AssigneeName": { "eq": "Dat Le" },
    "DueDate": { "lte": "2026-01-15" }
  },
  "limit": 25,
  "orderBy": "DueDate",
  "orderDir": "asc"
}
\`\`\`

**Available Filter Operators:**
- `eq` - Equals
- `neq` - Not equals
- `gt` - Greater than
- `gte` - Greater than or equal
- `lt` - Less than
- `lte` - Less than or equal
- `like` - Pattern match (use % for wildcards)
- `ilike` - Case-insensitive pattern match
- `in` - In array of values
- `is` - Is null/not null

---

### 3. Search Endpoint

**GET `/api/alfred/search`**

Full-text search across multiple tables simultaneously.

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Required. Search query |
| `tables` | string | Comma-separated table names (default: all) |
| `limit` | number | Results per table (default: 10) |

**Example - Search everything for "Martinez":**
\`\`\`bash
curl "https://your-motta-hub.vercel.app/api/alfred/search?q=Martinez"
\`\`\`

**Example - Search only contacts and organizations:**
\`\`\`bash
curl "https://your-motta-hub.vercel.app/api/alfred/search?q=Martinez&tables=contacts,organizations"
\`\`\`

**Searchable Tables:**
- `contacts` - Client contacts
- `organizations` - Companies/entities
- `work_items` - Karbon work items
- `team_members` - Motta team
- `debriefs` - Meeting debriefs
- `meeting_notes` - Meeting notes
- `services` - Service offerings

---

### 4. Stats Endpoint

**GET `/api/alfred/stats`**

Get aggregated dashboard statistics.

\`\`\`bash
curl https://your-motta-hub.vercel.app/api/alfred/stats
\`\`\`

**Response:**
\`\`\`json
{
  "workItems": {
    "total": 1250,
    "inProgress": 342,
    "completed": 856,
    "overdue": 52
  },
  "teamWorkload": [
    { "name": "Dat Le", "activeItems": 45, "completedThisMonth": 23 },
    { "name": "Grace Cha", "activeItems": 38, "completedThisMonth": 19 }
  ],
  "recentDebriefs": [...],
  "upcomingDeadlines": [...],
  "tommyAwardsLeaders": [...]
}
\`\`\`

---

## Vercel AI Assistant Configuration

### Step 1: Add Tools to ALFRED

In your Vercel AI Assistant dashboard for ALFRED, add these tools:

#### Tool 1: Get Schema
\`\`\`json
{
  "name": "get_database_schema",
  "description": "Get the complete database schema including all tables, fields, relationships, and example queries. Use this first to understand what data is available.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
\`\`\`

**Function URL:** `GET https://your-motta-hub.vercel.app/api/alfred/schema`

#### Tool 2: Query Data
\`\`\`json
{
  "name": "query_database",
  "description": "Query any Supabase table with filters. Available tables include: work_items, contacts, organizations, team_members, debriefs, meeting_notes, invoices, tasks, services, tommy_ballots, and more. Use get_database_schema first to see all tables.",
  "parameters": {
    "type": "object",
    "properties": {
      "table": {
        "type": "string",
        "description": "The table to query (e.g., work_items, contacts, debriefs)"
      },
      "select": {
        "type": "string",
        "description": "Comma-separated fields to return. Use * for all fields."
      },
      "search": {
        "type": "string",
        "description": "Search term to filter results"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results (default 50, max 100)"
      },
      "orderBy": {
        "type": "string",
        "description": "Field to sort by"
      },
      "orderDir": {
        "type": "string",
        "enum": ["asc", "desc"],
        "description": "Sort direction"
      }
    },
    "required": ["table"]
  }
}
\`\`\`

**Function URL:** `GET https://your-motta-hub.vercel.app/api/alfred/data`

#### Tool 3: Advanced Query
\`\`\`json
{
  "name": "query_database_advanced",
  "description": "Perform advanced database queries with complex filters like date ranges, comparisons, and multiple conditions.",
  "parameters": {
    "type": "object",
    "properties": {
      "table": {
        "type": "string",
        "description": "The table to query"
      },
      "select": {
        "type": "string",
        "description": "Fields to return"
      },
      "filters": {
        "type": "object",
        "description": "Filter conditions. Each key is a field name, value is an object with operator (eq, neq, gt, gte, lt, lte, like, ilike, in) and value."
      },
      "limit": {
        "type": "number"
      },
      "orderBy": {
        "type": "string"
      },
      "orderDir": {
        "type": "string",
        "enum": ["asc", "desc"]
      }
    },
    "required": ["table"]
  }
}
\`\`\`

**Function URL:** `POST https://your-motta-hub.vercel.app/api/alfred/data`

#### Tool 4: Search
\`\`\`json
{
  "name": "search_all_data",
  "description": "Full-text search across contacts, organizations, work items, team members, debriefs, meeting notes, and services. Use this when looking for a specific client, project, or topic.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The search term"
      },
      "tables": {
        "type": "string",
        "description": "Comma-separated list of tables to search. Leave empty to search all."
      },
      "limit": {
        "type": "number",
        "description": "Results per table (default 10)"
      }
    },
    "required": ["query"]
  }
}
\`\`\`

**Function URL:** `GET https://your-motta-hub.vercel.app/api/alfred/search?q={query}&tables={tables}&limit={limit}`

#### Tool 5: Get Stats
\`\`\`json
{
  "name": "get_dashboard_stats",
  "description": "Get aggregated statistics including work item counts, team workload, recent debriefs, upcoming deadlines, and Tommy Awards leaders.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
\`\`\`

**Function URL:** `GET https://your-motta-hub.vercel.app/api/alfred/stats`

---

### Step 2: Set System Prompt

Add this system prompt to ALFRED:

\`\`\`
You are ALFRED, the AI assistant for Motta Financial. You help Motta professionals by accessing and analyzing data from the Motta Hub.

## Your Capabilities:
- Query all client, work item, and contact information
- Search across debriefs, meeting notes, and communications
- Analyze team workload and upcoming deadlines
- Retrieve invoice and billing information
- Access Tommy Awards data and leaderboards

## How to Help Users:
1. When asked about clients, contacts, or work items, use the search or query tools
2. For statistics or overviews, use get_dashboard_stats
3. For complex queries (date ranges, multiple filters), use query_database_advanced
4. Always summarize information clearly and professionally

## Available Tables:
- work_items: Karbon work items with status, assignees, due dates
- contacts: Client contacts with emails, phones, addresses
- organizations: Companies and client entities
- team_members: Motta team with roles and Karbon IDs
- debriefs: Meeting debrief notes and action items
- meeting_notes: Detailed meeting records
- invoices: Billing and invoice data
- tasks: Internal task tracking
- services: Service offerings and pricing
- tommy_ballots: Tommy Awards voting
- notifications: User notifications
- saved_views: Custom dashboard views

## Response Style:
- Be concise but thorough
- Use bullet points for lists
- Format dates as Month Day, Year
- Include relevant context when presenting data
- Offer to dig deeper if the user needs more details
\`\`\`

---

### Step 3: Test the Integration

Test these queries in ALFRED:

1. **"What work items are due this week?"**
   - Should use query_database_advanced with DueDate filter

2. **"Search for the Martinez family"**
   - Should use search_all_data

3. **"What is Dat Le working on?"**
   - Should use query_database with AssigneeName filter

4. **"Show me the team workload"**
   - Should use get_dashboard_stats

5. **"Summarize the latest debrief for ABC Corporation"**
   - Should search debriefs and return summary

---

## Security Recommendations

For production, consider adding:

1. **API Key Authentication**
   - Add `x-api-key` header requirement
   - Store key in Vercel environment variables

2. **Rate Limiting**
   - Implement rate limiting on endpoints

3. **Audit Logging**
   - Log all ALFRED queries for compliance

Example API key implementation:
\`\`\`typescript
// In each route.ts
const apiKey = request.headers.get('x-api-key')
if (apiKey !== process.env.ALFRED_API_KEY) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
\`\`\`

---

## Troubleshooting

**ALFRED can't find data:**
- Check that the Motta Hub is deployed and accessible
- Verify the base URL is correct
- Test endpoints directly with curl

**Slow responses:**
- Reduce limit parameter
- Use specific field selections instead of `*`
- Add indexes to frequently queried fields in Supabase

**Missing tables:**
- Run `/api/alfred/schema` to see all available tables
- Check Supabase dashboard for table permissions
\`\`\`

\`\`\`ts file="" isHidden
