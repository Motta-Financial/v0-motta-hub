/**
 * Matching Outlook threads to Hub clients, and the project they're filed
 * under.
 *
 * The Triage Emails tab shows threads straight from Graph, which knows
 * email addresses and nothing about clients. This is the bridge: address →
 * contact or organization → that client's active work items.
 *
 * Everything here batches. A mailbox page is ~25 threads; a lookup per
 * thread would be 75 round trips to render one tab.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export interface MatchedClient {
  kind: "contact" | "organization"
  id: string
  name: string
}

export interface ProjectOption {
  id: string
  title: string
}

export interface ThreadAssignment {
  workItemId: string
  workItemTitle: string | null
  assignedById: string | null
  assignedAt: string
}

/** Karbon statuses we treat as "still open". Mirrors the client profile. */
function isActiveProjectStatus(status: string | null): boolean {
  const s = (status || "").toLowerCase()
  return s !== "completed" && s !== "cancelled" && s !== "canceled"
}

/** PostgREST `in.(...)` is comma-delimited, so an address containing a
 *  comma or quote would break the filter. Addresses can't legally contain
 *  a bare comma, but the value comes from mail headers, not from us. */
function safeAddress(value: string): boolean {
  return /^[^\s,()"]+@[^\s,()"]+$/.test(value)
}

/**
 * Address → client, for a batch of addresses.
 *
 * Contacts win over organizations when both match: a thread from
 * jamie@acme.com is from Jamie, even if acme.com is also the org's address
 * on file. Secondary email counts -- clients mail us from whichever address
 * their phone happens to be signed into.
 *
 * Unmatched addresses simply don't appear in the map. That is the common
 * case (every vendor, colleague and newsletter) and is not an error.
 */
export async function matchClientsByEmail(
  supabase: SupabaseClient,
  emails: string[],
): Promise<Map<string, MatchedClient>> {
  const matched = new Map<string, MatchedClient>()

  const unique = Array.from(
    new Set(emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e)),
  ).filter(safeAddress)
  if (unique.length === 0) return matched

  const list = unique.join(",")
  const [{ data: contacts }, { data: orgs }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, full_name, primary_email, secondary_email")
      .or(`primary_email.in.(${list}),secondary_email.in.(${list})`),
    supabase.from("organizations").select("id, name, primary_email").in("primary_email", unique),
  ])

  // Organizations first, so a contact match overwrites one.
  for (const org of orgs ?? []) {
    const key = org.primary_email?.toLowerCase()
    if (!key) continue
    matched.set(key, { kind: "organization", id: org.id, name: org.name })
  }

  for (const contact of contacts ?? []) {
    const name = contact.full_name || contact.primary_email || "Unknown"
    for (const addr of [contact.primary_email, contact.secondary_email]) {
      const key = addr?.toLowerCase()
      if (!key || !unique.includes(key)) continue
      matched.set(key, { kind: "contact", id: contact.id, name })
    }
  }

  return matched
}

/** Active work items per client, keyed "contact:<id>" / "organization:<id>". */
export async function activeProjectsForClients(
  supabase: SupabaseClient,
  clients: MatchedClient[],
): Promise<Map<string, ProjectOption[]>> {
  const byClient = new Map<string, ProjectOption[]>()
  if (clients.length === 0) return byClient

  const contactIds = clients.filter((c) => c.kind === "contact").map((c) => c.id)
  const orgIds = clients.filter((c) => c.kind === "organization").map((c) => c.id)

  const filters: string[] = []
  if (contactIds.length > 0) filters.push(`contact_id.in.(${contactIds.join(",")})`)
  if (orgIds.length > 0) filters.push(`organization_id.in.(${orgIds.join(",")})`)
  if (filters.length === 0) return byClient

  const { data } = await supabase
    .from("work_items")
    .select("id, title, status, contact_id, organization_id")
    .or(filters.join(","))
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(500)

  for (const item of data ?? []) {
    if (!isActiveProjectStatus(item.status)) continue
    const key = item.contact_id
      ? `contact:${item.contact_id}`
      : `organization:${item.organization_id}`
    const list = byClient.get(key) ?? []
    list.push({ id: item.id, title: item.title })
    byClient.set(key, list)
  }

  return byClient
}

/** Existing filings for a batch of conversations. */
export async function assignmentsForConversations(
  supabase: SupabaseClient,
  conversationIds: string[],
): Promise<Map<string, ThreadAssignment>> {
  const byConversation = new Map<string, ThreadAssignment>()
  if (conversationIds.length === 0) return byConversation

  const { data } = await supabase
    .from("email_thread_assignments")
    .select("conversation_id, work_item_id, assigned_by_id, created_at, work_items(title)")
    .in("conversation_id", conversationIds)

  for (const row of data ?? []) {
    const workItem = row.work_items as unknown as { title: string } | null
    byConversation.set(row.conversation_id, {
      workItemId: row.work_item_id,
      workItemTitle: workItem?.title ?? null,
      assignedById: row.assigned_by_id,
      assignedAt: row.created_at,
    })
  }

  return byConversation
}

export interface ThreadLike {
  id: string
  participantEmail: string
}

export interface ThreadEnrichment {
  client: MatchedClient | null
  availableProjects: ProjectOption[]
  assignment: ThreadAssignment | null
}

/**
 * One pass over a page of threads: match the client, list their open
 * projects, attach any existing filing. Three queries total, regardless of
 * how many threads there are.
 */
export async function enrichThreads(
  supabase: SupabaseClient,
  threads: ThreadLike[],
): Promise<Map<string, ThreadEnrichment>> {
  const [clientsByEmail, assignments] = await Promise.all([
    matchClientsByEmail(
      supabase,
      threads.map((t) => t.participantEmail),
    ),
    assignmentsForConversations(
      supabase,
      threads.map((t) => t.id),
    ),
  ])

  const distinctClients = Array.from(
    new Map(Array.from(clientsByEmail.values()).map((c) => [`${c.kind}:${c.id}`, c])).values(),
  )
  const projectsByClient = await activeProjectsForClients(supabase, distinctClients)

  const enriched = new Map<string, ThreadEnrichment>()
  for (const thread of threads) {
    const client = clientsByEmail.get(thread.participantEmail?.trim().toLowerCase()) ?? null
    enriched.set(thread.id, {
      client,
      availableProjects: client ? projectsByClient.get(`${client.kind}:${client.id}`) ?? [] : [],
      assignment: assignments.get(thread.id) ?? null,
    })
  }

  return enriched
}
