/**
 * Zoom Team Chat contacts → Hub contacts sync.
 *
 * Zoom exposes each user's contact directory via
 * `GET /v2/chat/users/me/contacts?type=company|external` — a USER-level
 * endpoint (S2S tokens can't call it), so we walk every active
 * `zoom_connections` row and pull both directory types with that
 * member's OAuth token. Requires the `team_chat:read:list_contacts`
 * (classic: `chat_contact:read`) scope on the user-managed OAuth app;
 * connections whose grant predates the scope fail gracefully and are
 * reported per-connection so the UI can prompt a reconnect.
 *
 * Every payload field is persisted: stable fields are typed columns on
 * `zoom_contacts`, and the verbatim contact object lands in `raw_data`.
 *
 * Hub linking
 * ───────────
 *   • external contacts — resolved through `findOrCreateHubContact`
 *     (email → business name → name+phone, creating a Hub contact when
 *     none exists). This is the "Zoom contacts should be linked to Hub
 *     contacts" bridge: once linked, meeting participants that match a
 *     Zoom contact inherit the Hub client link automatically (see
 *     process-meeting-participants.ts).
 *   • company contacts — the firm's own directory. Never becomes a Hub
 *     contact (those are teammates); stored with match_method
 *     'internal_directory' for completeness.
 *
 * Idempotent: rows upsert on (zoom_connection_id, contact_type,
 * zoom_contact_key) where the key is Zoom's contact id, falling back to
 * the lowercased email.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getActiveZoomConnections,
  zoomFetch,
  type ZoomConnection,
} from "@/lib/zoom-auth"
import { findOrCreateHubContact, isInternalEmail } from "@/lib/hub/find-or-create-contact"

interface ZoomChatContact {
  id?: string
  email?: string
  first_name?: string
  last_name?: string
  display_name?: string
  pronoun?: string
  phone_numbers?: unknown
  department?: string
  dept?: string
  job_title?: string
  location?: string
  presence_status?: string
  [key: string]: unknown
}

export interface ZoomContactsSyncResult {
  connectionsScanned: number
  contactsSeen: number
  contactsUpserted: number
  hubMatched: number
  hubCreated: number
  errors: Array<{ zoom_email: string; error: string }>
}

const CONTACT_TYPES = ["external", "company"] as const

async function fetchContactsPage(
  conn: ZoomConnection,
  type: (typeof CONTACT_TYPES)[number],
  nextToken: string | null,
): Promise<{ contacts: ZoomChatContact[]; nextToken: string | null }> {
  const params = new URLSearchParams({ type, page_size: "50" })
  if (nextToken) params.set("next_page_token", nextToken)
  const res = await zoomFetch(
    conn,
    `https://api.zoom.us/v2/chat/users/me/contacts?${params.toString()}`,
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`chat/contacts(${type}) ${res.status}: ${body.slice(0, 160)}`)
  }
  const data = (await res.json()) as {
    contacts?: ZoomChatContact[]
    next_page_token?: string
  }
  return { contacts: data.contacts ?? [], nextToken: data.next_page_token || null }
}

/**
 * Sync the Zoom contact directories for every active connection (or a
 * single one) into `zoom_contacts`, linking external contacts to Hub
 * contacts/organizations as we go.
 */
export async function syncZoomContacts(opts: {
  supabase: SupabaseClient
  zoomConnectionId?: string | null
}): Promise<ZoomContactsSyncResult> {
  const { supabase } = opts

  const result: ZoomContactsSyncResult = {
    connectionsScanned: 0,
    contactsSeen: 0,
    contactsUpserted: 0,
    hubMatched: 0,
    hubCreated: 0,
    errors: [],
  }

  let connections = await getActiveZoomConnections()
  if (opts.zoomConnectionId) {
    connections = connections.filter((c) => c.id === opts.zoomConnectionId)
  }
  result.connectionsScanned = connections.length

  for (const conn of connections) {
    for (const type of CONTACT_TYPES) {
      try {
        let nextToken: string | null = null
        // 40 pages × 50 = 2,000 contacts per type per user — beyond that
        // is degenerate and can wait for the next hourly sweep.
        for (let page = 0; page < 40; page++) {
          const { contacts, nextToken: token } = await fetchContactsPage(conn, type, nextToken)
          result.contactsSeen += contacts.length

          for (const c of contacts) {
            const email = (c.email || "").trim().toLowerCase() || null
            const zoomContactId = (c.id || "").trim() || null
            const key = zoomContactId ?? email
            if (!key) continue

            const fullName =
              [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
              (c.display_name || "").trim() ||
              null

            // ── Hub resolution ────────────────────────────────────
            let hubContactId: string | null = null
            let hubOrganizationId: string | null = null
            let matchMethod: string | null = null

            if (type === "company" || (email && isInternalEmail(email))) {
              matchMethod = "internal_directory"
            } else if (email || fullName) {
              try {
                const resolved = await findOrCreateHubContact(
                  { email, fullName },
                  { source: "zoom", supabase, skipInternal: true },
                )
                hubContactId = resolved.contact_id
                hubOrganizationId = resolved.organization_id
                matchMethod = resolved.method
                if (resolved.contact_id || resolved.organization_id) {
                  if (resolved.created) result.hubCreated++
                  else result.hubMatched++
                }
              } catch (err) {
                console.warn("[v0] [Zoom Contacts] hub resolution failed:", err)
              }
            }

            const row: Record<string, unknown> = {
              zoom_connection_id: conn.id,
              owner_team_member_id: conn.team_member_id ?? null,
              zoom_contact_key: key,
              contact_type: type,
              zoom_contact_id: zoomContactId,
              email,
              first_name: c.first_name ?? null,
              last_name: c.last_name ?? null,
              display_name: c.display_name ?? fullName,
              pronoun: c.pronoun ?? null,
              phone_numbers: c.phone_numbers ?? null,
              department: c.department ?? c.dept ?? null,
              job_title: c.job_title ?? null,
              location: c.location ?? null,
              presence_status: c.presence_status ?? null,
              raw_data: c,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
            // Only write link columns when resolution produced something —
            // a transient resolution failure on a re-sync must not null
            // out a previously established Hub link.
            if (hubContactId || hubOrganizationId) {
              row.hub_contact_id = hubContactId
              row.hub_organization_id = hubOrganizationId
              row.match_method = matchMethod
              row.linked_at = new Date().toISOString()
            } else if (matchMethod) {
              row.match_method = matchMethod
            }

            const { error: upsertErr } = await supabase.from("zoom_contacts").upsert(row, {
              onConflict: "zoom_connection_id,contact_type,zoom_contact_key",
            })
            if (upsertErr) {
              result.errors.push({
                zoom_email: conn.zoom_email,
                error: `upsert ${key}: ${upsertErr.message}`,
              })
            } else {
              result.contactsUpserted++
            }
          }

          nextToken = token
          if (!nextToken) break
        }
      } catch (err) {
        // Most common: 400/403 because the token predates the
        // team_chat:read:list_contacts scope. Report and continue with
        // the next connection — never fail the whole sweep.
        result.errors.push({
          zoom_email: conn.zoom_email,
          error: err instanceof Error ? err.message : "unknown",
        })
      }
    }
  }

  return result
}
