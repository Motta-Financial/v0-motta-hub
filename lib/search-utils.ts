/**
 * Shared search helpers for Karbon Work Items and Clients.
 *
 * Every page/widget that lets the user filter a list of work items or
 * clients should use these helpers instead of rolling its own
 * `.toLowerCase().includes()` filter, so the same query gives the same
 * answers everywhere in the app.
 *
 * All inputs are typed as `any` deliberately — different surfaces hand us
 * Karbon API rows (Title / WorkKey / AssignedTo[]), Supabase rows
 * (title / karbon_work_item_key / assignee_name), or hybrid rows that
 * carry both shapes plus derived fields (returnType, noticeType, etc.).
 * Trying to nail this down with a discriminated union would force every
 * caller to massage their data before searching, which is exactly the
 * fragmentation we're cleaning up.
 */

/**
 * Split a query into individual tokens, lowercased and trimmed.
 *
 * Tokens are matched independently with AND semantics by
 * `matchesAllTokens`, which means typing `"smith 1040"` will match a row
 * where one field contains "smith" and a different field contains "1040"
 * — the natural way someone narrows a long list with a specific lookup.
 */
export function tokenizeQuery(q: string | null | undefined): string[] {
  if (!q) return []
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Returns true iff EVERY token in `q` appears as a substring in ANY of
 * the supplied `parts`. Empty / whitespace-only queries match everything,
 * matching how every existing inline filter behaves today.
 *
 * `parts` accepts arbitrary nullable strings (and tolerates non-strings
 * via `String()` coercion) so callers can splat in fields without
 * pre-filtering — `null`, `undefined`, and `""` are silently skipped.
 */
export function matchesAllTokens(parts: Array<unknown>, q: string | null | undefined): boolean {
  const tokens = tokenizeQuery(q)
  if (tokens.length === 0) return true

  // Build the haystack once per row, lowercased once. We deliberately
  // join with a separator that won't appear naturally so a token can't
  // accidentally span two adjacent fields (e.g. last name "Doe" and
  // city "Doejaville" shouldn't combine to "doedoe").
  const haystack = parts
    .map((p) => (p == null ? "" : String(p)))
    .filter(Boolean)
    .join(" \u0001 ")
    .toLowerCase()

  for (const t of tokens) {
    if (!haystack.includes(t)) return false
  }
  return true
}

/**
 * Pull every searchable string out of a Karbon Work Item, regardless of
 * whether it's the Karbon API shape or the Supabase shape, plus the
 * derived helper fields trackers attach (returnType, taxYear, noticeType,
 * advisoryType, entityType).
 *
 * Be paranoid about field names — different surfaces use slightly
 * different casing. We lean on `as any` access throughout so a typo on
 * one field doesn't poison the whole haystack.
 */
export function workItemSearchParts(item: any): unknown[] {
  if (!item) return []
  const i = item as Record<string, any>
  const parts: unknown[] = [
    // Title / description
    i.Title,
    i.title,
    i.Description,
    i.description,
    i.notes,
    // Identifiers (Karbon-side and our own)
    i.WorkKey,
    i.work_key,
    i.karbon_work_item_key,
    i.user_defined_identifier,
    i.UserDefinedIdentifier,
    // Work type / status / priority
    i.WorkType,
    i.work_type,
    i.WorkflowKey,
    i.workflow_key,
    i.WorkStatus,
    i.work_status,
    i.workflow_status,
    i.workflow_status_title,
    i.PrimaryStatus,
    i.primary_status,
    i.SecondaryStatus,
    i.secondary_status,
    i.normalizedStatus,
    i.karbonStatus,
    i.status,
    i.Priority,
    i.priority,
    // Client identity (denormalized variants)
    i.ClientName,
    i.client_name,
    i.ClientType,
    i.client_type,
    // Client group (object form OR flat form)
    i.ClientGroup?.Name,
    i.ClientGroupName,
    i.client_group_name,
    i.client_group?.name,
    // Assignee — Karbon "AssignedTo" can be an array or a single object.
    // The Supabase shape uses flat `assignee_*` columns. We grab them all.
    ...assigneeStrings(i.AssignedTo),
    ...assigneeStrings(i.Assignee),
    i.assignee_name,
    i.assignee_email,
    // Lead / manager / partner / owner naming we see on enriched rows
    i.client_manager_name,
    i.client_partner_name,
    i.client_owner_name,
    i.lead,
    i.lead_name,
    // Derived helpers attached by tracker components
    i.returnType,
    i.taxYear,
    i.noticeType,
    i.advisoryType,
    i.entityType,
  ]
  return parts
}

/**
 * Karbon represents an assignment as either a single object, an array of
 * objects, or a string. `FullName` and `Email` are the two fields the
 * trackers reliably surface.
 */
function assigneeStrings(value: unknown): string[] {
  if (!value) return []
  const list = Array.isArray(value) ? value : [value]
  const out: string[] = []
  for (const a of list) {
    if (a == null) continue
    if (typeof a === "string") {
      out.push(a)
      continue
    }
    if (typeof a === "object") {
      const o = a as Record<string, any>
      if (o.FullName) out.push(String(o.FullName))
      if (o.full_name) out.push(String(o.full_name))
      if (o.Email) out.push(String(o.Email))
      if (o.email) out.push(String(o.email))
      if (o.Name) out.push(String(o.Name))
      if (o.name) out.push(String(o.name))
    }
  }
  return out
}

/**
 * Pull every searchable string out of a unified Client row. Handles both
 * the dashboard shape used in clients-list (entity_type / industry) AND
 * raw Karbon contact / organization rows (full_name / primary_email /
 * karbon_*_key).
 */
export function clientSearchParts(client: any): unknown[] {
  if (!client) return []
  const c = client as Record<string, any>
  return [
    // Names
    c.name,
    c.full_name,
    c.legal_name,
    c.trading_name,
    c.first_name,
    c.last_name,
    c.preferred_name,
    c.middle_name,
    c.salutation,
    // Contact
    c.email,
    c.primary_email,
    c.secondary_email,
    c.phone,
    c.phone_primary,
    c.phone_secondary,
    c.mobile,
    c.work_phone,
    // Karbon identifiers
    c.karbon_organization_key,
    c.karbon_contact_key,
    c.karbon_key,
    c.user_defined_identifier,
    // Classification
    c.entity_type,
    c.entityType,
    c.contact_type,
    c.industry,
    c.client_type,
    c.relationship,
    c.account_type,
    // Address
    c.address,
    c.address_line_1,
    c.address_line_2,
    c.city,
    c.state,
    c.country,
    c.postal_code,
    c.zip,
    c.zip_code,
  ]
}
