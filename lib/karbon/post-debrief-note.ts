/**
 * Pushes a debrief into Karbon as a Note attached to every related Work Item,
 * Contact, and Organization the debrief touches.
 *
 * Karbon's `POST /v3/Notes` endpoint accepts a `Timelines` array — including
 * multiple entries posts one note that appears simultaneously on each entity's
 * timeline (Work Item, Contact, Organization, ClientGroup). That matches the
 * firm rule: every debrief should land on the work item's timeline AND on the
 * client's profile timeline so context follows the relationship.
 *
 * This is intentionally fire-and-forget from the debrief POST handler:
 *   - the debrief is already persisted to Supabase before we call Karbon
 *   - any failure here is logged but does NOT roll back the debrief
 *   - missing Karbon credentials silently no-op (dev / preview)
 */

import { createAdminClient } from "@/lib/supabase/server"
import { getKarbonCredentials, karbonFetch, type KarbonApiConfig } from "@/lib/karbon-api"

const KARBON_TENANT_BASE = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

type RelatedClient = {
  id?: string
  type?: "contact" | "organization" | string
  name?: string
  karbon_key?: string | null
}

type RelatedWorkItem = {
  id?: string
  title?: string
  karbon_key?: string | null
}

type ActionItemPayload = {
  description?: string
  assignee_name?: string
  due_date?: string | null
  priority?: string
}

type DebriefForKarbon = {
  id: string
  debrief_date?: string | null
  follow_up_date?: string | null
  notes?: string | null
}

type DebriefBodyForKarbon = {
  team_member?: string | null
  created_by_id?: string | null
  notes?: string | null
  follow_up_date?: string | null
  fee_adjustment?: string | null
  fee_adjustment_reason?: string | null
  research_topics?: string | null
  services?: string[] | null
  action_items?: ActionItemPayload[] | null
  related_clients?: RelatedClient[] | null
  related_work_items?: RelatedWorkItem[] | null
  // Primary contact — the canonical client tag. Rendered prominently in
  // the note body and explicitly added to the Timelines array so the
  // note always lands on the primary client's profile timeline even when
  // no work item is attached.
  primary_contact?: RelatedClient | null
}

export interface KarbonDebriefNoteResult {
  ok: boolean
  skipped?: "no_credentials" | "no_targets" | "no_author_email"
  noteKey?: string
  error?: string
  attachedTimelines?: number
}

const escape = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const formatDateLong = (iso?: string | null): string => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

const buildKarbonUrl = (
  type: "contact" | "organization" | "work",
  key?: string | null,
): string | null => {
  if (!key) return null
  if (type === "contact") return `${KARBON_TENANT_BASE}/contacts/${key}`
  if (type === "organization") return `${KARBON_TENANT_BASE}/organizations/${key}`
  return `${KARBON_TENANT_BASE}/work/${key}`
}

/**
 * Build the HTML note body. Karbon's Note `Body` field supports HTML — we use
 * a constrained subset (no inline styles beyond what Karbon traditionally
 * renders) to keep the timeline view clean.
 *
 * Structured into sections matching the debrief email:
 * 1. Project Details (submitter, date, service lines)
 * 2. Meeting Notes (notes, action items, research topics)
 * 3. Project Finance (pricing adjustments)
 */
function buildNoteBody(
  debrief: DebriefForKarbon,
  body: DebriefBodyForKarbon,
  hubUrl: string,
): string {
  const lines: string[] = []
  const debriefDate = formatDateLong(debrief.debrief_date)
  const author = body.team_member || "A team member"

  // ========================================
  // SECTION 1: Project Details
  // ========================================
  lines.push("<h3>Project Details</h3>")
  lines.push("<ul>")
  lines.push(`<li><strong>Submitted By:</strong> ${escape(author)}</li>`)
  if (debriefDate) {
    lines.push(`<li><strong>Date of Meeting:</strong> ${escape(debriefDate)}</li>`)
  }

  // Primary Contact — the canonical client tag, rendered as its own line
  // above "Related Clients" so the timeline reader sees who the debrief is
  // FOR before scanning the supporting cast.
  const primary = body.primary_contact
  if (primary?.name) {
    const typeLabel = primary.type === "organization" ? " (Org)" : ""
    const url = buildKarbonUrl(
      primary.type === "organization" ? "organization" : "contact",
      primary.karbon_key,
    )
    const link = url
      ? `<a href="${escape(url)}">${escape(primary.name)}</a>`
      : escape(primary.name)
    lines.push(`<li><strong>Primary Contact:</strong> ${link}${typeLabel}</li>`)
  }

  // Related Clients — de-duped against the primary so we don't render the
  // same person twice. Match on Karbon key when both sides have it (most
  // reliable across casing differences) and fall back to name otherwise.
  const relatedClients = (body.related_clients || [])
    .filter((c) => c.name)
    .filter((c) => {
      if (!primary) return true
      if (primary.karbon_key && c.karbon_key) {
        return c.karbon_key !== primary.karbon_key
      }
      return c.name !== primary.name
    })
  if (relatedClients.length > 0) {
    const label = primary?.name ? "Other Related Clients" : "Related Clients"
    const clientNames = relatedClients
      .map((c) => {
        const typeLabel = c.type === "organization" ? " (Org)" : c.type === "contact" ? "" : ""
        const url = buildKarbonUrl(
          c.type === "organization" ? "organization" : "contact",
          c.karbon_key,
        )
        return url
          ? `<a href="${escape(url)}">${escape(c.name)}</a>${typeLabel}`
          : `${escape(c.name)}${typeLabel}`
      })
      .join(", ")
    lines.push(`<li><strong>${label}:</strong> ${clientNames}</li>`)
  }

  // Service Lines
  const services = (body.services || []).filter(Boolean)
  if (services.length > 0) {
    lines.push(`<li><strong>Service Lines:</strong> ${services.map(escape).join(", ")}</li>`)
  }

  // Follow-up
  const followUp = body.follow_up_date || debrief.follow_up_date
  if (followUp) {
    lines.push(`<li><strong>Follow-Up Date:</strong> ${escape(formatDateLong(followUp))}</li>`)
  }
  lines.push("</ul>")

  // ========================================
  // SECTION 2: Meeting Notes
  // ========================================
  const notes = body.notes || debrief.notes
  const items = (body.action_items || []).filter((i) => i?.description?.trim())
  const hasResearch = body.research_topics && body.research_topics.trim()

  if (notes || items.length > 0 || hasResearch) {
    lines.push("<h3>Meeting Notes</h3>")

    // Notes
    if (notes && notes.trim()) {
      lines.push(
        `<div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-bottom: 12px;">${escape(notes).replace(/\n/g, "<br />")}</div>`,
      )
    }

    // Action items
    if (items.length > 0) {
      lines.push("<p><strong>Action Items:</strong></p>")
      lines.push("<ul>")
      for (const item of items) {
        const parts: string[] = [escape(item.description)]
        const meta: string[] = []
        if (item.assignee_name) meta.push(`assignee: ${escape(item.assignee_name)}`)
        if (item.due_date) meta.push(`due: ${escape(item.due_date)}`)
        if (item.priority) meta.push(`priority: ${escape(item.priority)}`)
        if (meta.length) parts.push(` <em>(${meta.join(" · ")})</em>`)
        lines.push(`<li>${parts.join("")}</li>`)
      }
      lines.push("</ul>")
    }

    // Research topics
    if (hasResearch) {
      lines.push("<p><strong>Research Topics:</strong></p>")
      lines.push(`<p>${escape(body.research_topics!)}</p>`)
    }
  }

  // ========================================
  // SECTION 3: Project Finance
  // ========================================
  if (body.fee_adjustment) {
    lines.push("<h3>Project Finance</h3>")
    lines.push("<p><strong>Pricing Adjustment / Payment Structure:</strong></p>")
    lines.push(`<p>${escape(body.fee_adjustment)}</p>`)
    if (body.fee_adjustment_reason) {
      lines.push(`<p><em>Reason:</em> ${escape(body.fee_adjustment_reason)}</p>`)
    }
  }

  // Cross-link to Motta Hub for the canonical record + threaded comments.
  lines.push("<hr />")
  lines.push(
    `<p><em>Synced from <a href="${escape(hubUrl)}">Motta Hub</a>.</em></p>`,
  )

  return lines.join("\n")
}

/**
 * Resolve a Karbon `ClientType` string to the timeline `EntityType` Karbon
 * expects. Karbon returns the value as `"Contact"` or `"Organization"` but
 * we normalize defensively in case casing/labels drift across endpoints.
 */
function normalizeClientType(
  clientType?: string | null,
): "Contact" | "Organization" | null {
  if (!clientType) return null
  const t = clientType.toLowerCase().trim()
  if (t === "contact" || t.startsWith("contact")) return "Contact"
  if (t === "organization" || t.startsWith("org")) return "Organization"
  return null
}

/**
 * Look up the Contact or Organization that owns a given work item so we can
 * post the debrief note onto that client's timeline as well.
 *
 * Strategy:
 *   1. Try Supabase first (`work_items.karbon_client_key` + `client_type`)
 *      — already populated by our hourly Karbon sync, no API call needed.
 *   2. Fall back to a live `GET /v3/WorkItems/{WorkItemKey}` if the work
 *      item isn't in our cache yet (e.g. brand-new in Karbon, or the user
 *      created the debrief before the next sync run). Karbon's WorkItem
 *      payload returns both `ClientKey` and `ClientType`.
 *
 * Returns `null` when nothing usable can be resolved — caller treats that
 * as a no-op rather than failing the whole note push.
 */
async function fetchWorkItemClient(
  workItemKarbonKey: string,
  credentials: KarbonApiConfig,
): Promise<{ entityType: "Contact" | "Organization"; entityKey: string } | null> {
  // 1. Cached lookup
  const supabase = createAdminClient()
  const { data: cached, error: cacheErr } = await supabase
    .from("work_items")
    .select("karbon_client_key, client_type")
    .eq("karbon_work_item_key", workItemKarbonKey)
    .maybeSingle()
  if (cacheErr) {
    console.warn(
      `[karbon-debrief-note] Supabase work_items lookup failed for ${workItemKarbonKey}:`,
      cacheErr.message,
    )
  }
  if (cached?.karbon_client_key) {
    const entityType = normalizeClientType(cached.client_type)
    if (entityType) {
      return { entityType, entityKey: cached.karbon_client_key }
    }
  }

  // 2. Live Karbon fallback
  const { data, error } = await karbonFetch<any>(
    `/WorkItems/${encodeURIComponent(workItemKarbonKey)}`,
    credentials,
  )
  if (error || !data) {
    console.warn(
      `[karbon-debrief-note] GET /WorkItems/${workItemKarbonKey} failed:`,
      error,
    )
    return null
  }
  const entityType = normalizeClientType(data.ClientType)
  if (!entityType || !data.ClientKey) return null
  return { entityType, entityKey: String(data.ClientKey) }
}

/**
 * Build the `Timelines` array — one entry per Karbon entity the debrief
 * touches. De-duplicates by `EntityKey` since the same key can appear via
 * both related_clients and related_work_items.
 *
 * In addition to the explicitly-selected related clients, we resolve every
 * related work item's owning Contact/Organization (Karbon stores these as
 * `ClientKey` + `ClientType` on each work item) and add THAT to the
 * timeline list too. This guarantees a debrief always lands on the client
 * profile timeline — not just the work item — even when the teammate
 * forgot to add a related client manually.
 */
async function buildTimelines(
  body: DebriefBodyForKarbon,
  credentials: KarbonApiConfig,
): Promise<Array<{ EntityType: string; EntityKey: string }>> {
  const seen = new Set<string>()
  const out: Array<{ EntityType: string; EntityKey: string }> = []

  const add = (entityType: string, key?: string | null) => {
    if (!key) return
    const dedupKey = `${entityType}:${key}`
    if (seen.has(dedupKey)) return
    seen.add(dedupKey)
    out.push({ EntityType: entityType, EntityKey: key })
  }

  // Explicit selections from the debrief form. Primary contact goes first
  // so the resulting Timelines array is in semantic priority order (the
  // Karbon API treats them as a set, but ordering helps when debugging).
  if (body.primary_contact?.karbon_key) {
    if (body.primary_contact.type === "organization") {
      add("Organization", body.primary_contact.karbon_key)
    } else if (body.primary_contact.type === "contact") {
      add("Contact", body.primary_contact.karbon_key)
    }
  }
  for (const wi of body.related_work_items || []) {
    add("WorkItem", wi.karbon_key)
  }
  for (const c of body.related_clients || []) {
    if (c.type === "contact") add("Contact", c.karbon_key)
    else if (c.type === "organization") add("Organization", c.karbon_key)
  }

  // Derive the owning Contact/Organization for every related work item.
  // Run these in parallel since they're independent network calls; a single
  // failed lookup is logged but doesn't prevent the others from succeeding.
  const workItemKeys = (body.related_work_items || [])
    .map((wi) => wi.karbon_key)
    .filter((k): k is string => Boolean(k))
  if (workItemKeys.length > 0) {
    const resolved = await Promise.all(
      workItemKeys.map((key) => fetchWorkItemClient(key, credentials)),
    )
    for (const r of resolved) {
      if (r) add(r.entityType, r.entityKey)
    }
  }

  return out
}

/**
 * Resolve the author's Karbon-recognized email. We pass the team member's
 * Motta email — Karbon resolves it against the user directory to attribute
 * authorship correctly (matching how the Karbon UI itself records notes
 * authored from the timeline).
 */
async function resolveAuthorEmail(createdById?: string | null): Promise<string | null> {
  if (!createdById) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("team_members")
    .select("email")
    .eq("id", createdById)
    .maybeSingle()
  if (error) {
    console.error("[karbon-debrief-note] author lookup failed:", error.message)
    return null
  }
  return data?.email || null
}

export async function postDebriefNoteToKarbon(
  debrief: DebriefForKarbon,
  body: DebriefBodyForKarbon,
): Promise<KarbonDebriefNoteResult> {
  const credentials = getKarbonCredentials()
  if (!credentials) {
    console.warn("[karbon-debrief-note] Karbon credentials missing — skipping note push.")
    return { ok: false, skipped: "no_credentials" }
  }

  const timelines = await buildTimelines(body, credentials)
  if (timelines.length === 0) {
    // Nothing to attach to — pushing an unattached note creates a floating
    // timeline entry the firm can't navigate to. Skip cleanly.
    return { ok: false, skipped: "no_targets" }
  }

  const authorEmail = await resolveAuthorEmail(body.created_by_id)
  if (!authorEmail) {
    console.warn("[karbon-debrief-note] No author email — Karbon requires AuthorEmailAddress.")
    return { ok: false, skipped: "no_author_email" }
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://mottahub-motta.vercel.app"
  const hubUrl = `${siteUrl}/debriefs?id=${debrief.id}`

  // Subject line uses the work item name as the primary identifier, matching
  // how the firm organizes work in Karbon. Falls back to the primary
  // contact name (canonical tag) before any related-client name, since the
  // primary is the explicit "this debrief is FOR" choice.
  const primaryWorkItem = (body.related_work_items || []).find((w) => w.title)?.title
  const primaryName =
    body.primary_contact?.name ||
    (body.related_clients || []).find((c) => c.name)?.name
  const subject = primaryWorkItem
    ? primaryWorkItem // Use work item name directly as subject
    : primaryName
      ? `Debrief — ${primaryName}`
      : "Client Debrief"

  const noteBody = buildNoteBody(debrief, body, hubUrl)

  const payload: Record<string, unknown> = {
    Subject: subject,
    Body: noteBody,
    AuthorEmailAddress: authorEmail,
    Timelines: timelines,
  }

  // TodoDate is set to the meeting date (debrief_date) as requested — the note
  // should be dated to when the meeting occurred so it appears correctly in
  // the Karbon timeline. Karbon expects ISO 8601; debrief_date is YYYY-MM-DD.
  if (debrief.debrief_date) {
    payload.TodoDate = debrief.debrief_date
  }

  const { data, error } = await karbonFetch<{ NoteKey?: string }>(
    "/Notes",
    credentials,
    { method: "POST", body: payload },
  )

  if (error) {
    console.error("[karbon-debrief-note] Karbon POST failed:", error)
    return { ok: false, error, attachedTimelines: timelines.length }
  }

  return {
    ok: true,
    noteKey: (data as any)?.NoteKey,
    attachedTimelines: timelines.length,
  }
}
