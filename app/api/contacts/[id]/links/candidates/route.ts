/**
 * Candidate search for the Master Hub Contact link picker.
 *
 * GET /api/contacts/[id]/links/candidates?platform=karbon|proconnect|ignition&q=...
 *
 * Returns up to 25 unlinked external records matching the query, so
 * the teammate can pick one and POST /links to create the link.
 *
 * Search semantics:
 *   - Karbon       — contacts/organizations rows in our Hub that
 *                    have a karbon_*_key set but are NOT already
 *                    the current contact. We surface these because
 *                    Karbon contacts only ever land in Motta Hub via
 *                    the sync, so the cached copy is what the
 *                    teammate needs to pick.
 *   - ProConnect   — proconnect_clients with no hub_contact_id /
 *                    hub_organization_id set yet (i.e. unmatched).
 *   - Ignition     — ignition_clients where match_status='unmatched'.
 *                    The Ignition side already has a candidate-suggest
 *                    RPC, but that runs the OTHER direction (suggest
 *                    Hub contacts for an Ignition row); here we want
 *                    "show me unmatched Ignition rows for THIS Hub
 *                    contact" so the teammate can pick one to link.
 *
 * Each platform returns the same shape:
 *   { external_id, display_name, email, hint }
 * — `hint` is a humanized substring used by the UI (e.g. business
 * name, ProConnect entity type, Ignition match_method) so the picker
 * can disambiguate same-name rows at a glance.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Platform = "karbon" | "proconnect" | "ignition"
const VALID: Platform[] = ["karbon", "proconnect", "ignition"]

interface Candidate {
  external_id: string
  display_name: string | null
  email: string | null
  hint: string | null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contactId } = await params
    const url = new URL(req.url)
    const platform = url.searchParams.get("platform") as Platform | null
    const q = (url.searchParams.get("q") ?? "").trim()

    if (!platform || !VALID.includes(platform)) {
      return NextResponse.json(
        { error: `platform must be one of ${VALID.join("|")}` },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    // Postgres LIKE escape: % and _ are wildcards, \\ escapes them.
    const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null

    if (platform === "karbon") {
      // Karbon "candidates" come from our local cache of Karbon
      // contacts + organizations. Both tables get a Karbon perma-key
      // mirrored from Karbon's webhook + nightly sync; that's the
      // value we'll write back to the contact being linked.
      //
      // Filter: must have a karbon_*_key, must not BE the current
      // contact (you can't link a contact to itself), and the
      // search term must match name or email.
      const [contactsRes, orgsRes] = await Promise.all([
        (() => {
          let query = supabase
            .from("contacts")
            .select("id, full_name, primary_email, karbon_contact_key")
            .not("karbon_contact_key", "is", null)
            .neq("id", contactId)
            .limit(15)
          if (like) {
            query = query.or(
              `full_name.ilike.${like},primary_email.ilike.${like}`,
            )
          }
          return query
        })(),
        (() => {
          let query = supabase
            .from("organizations")
            .select(
              "id, name, primary_email, karbon_organization_key, industry",
            )
            .not("karbon_organization_key", "is", null)
            .neq("id", contactId)
            .limit(15)
          if (like) {
            query = query.or(`name.ilike.${like},primary_email.ilike.${like}`)
          }
          return query
        })(),
      ])

      const candidates: Candidate[] = [
        ...(contactsRes.data ?? []).map((c: any) => ({
          external_id: c.karbon_contact_key as string,
          display_name: c.full_name,
          email: c.primary_email,
          hint: "Karbon contact",
        })),
        ...(orgsRes.data ?? []).map((o: any) => ({
          external_id: o.karbon_organization_key as string,
          display_name: o.name,
          email: o.primary_email,
          hint: o.industry
            ? `Karbon organization · ${o.industry}`
            : "Karbon organization",
        })),
      ]
      return NextResponse.json({ candidates: candidates.slice(0, 25) })
    }

    if (platform === "proconnect") {
      // ProConnect candidates = clients with no hub link yet.
      // We treat hub_contact_id IS NULL AND hub_organization_id IS
      // NULL as "unlinked" (the auto-matcher writes ONE of them when
      // it succeeds, never both).
      let query = supabase
        .from("proconnect_clients")
        .select(
          "proconnect_client_id, display_name, email, business_name, client_type, client_state",
        )
        .is("hub_contact_id", null)
        .is("hub_organization_id", null)
        .order("display_name", { ascending: true })
        .limit(25)
      if (like) {
        query = query.or(
          `display_name.ilike.${like},email.ilike.${like},business_name.ilike.${like}`,
        )
      }
      const { data, error } = await query
      if (error) throw error

      const candidates: Candidate[] = (data ?? []).map((c: any) => ({
        external_id: c.proconnect_client_id,
        display_name: c.display_name || c.business_name || c.email,
        email: c.email,
        hint: [c.client_type, c.client_state].filter(Boolean).join(" · ") || null,
      }))
      return NextResponse.json({ candidates })
    }

    if (platform === "ignition") {
      // Ignition candidates = unmatched billing records. We bypass
      // the suggest_ignition_client_candidates RPC here because that
      // one is keyed by an Ignition row to find Hub matches; we want
      // the inverse direction.
      let query = supabase
        .from("ignition_clients")
        .select(
          "ignition_client_id, name, email, business_name, client_type, match_status, ignition_updated_at",
        )
        .eq("match_status", "unmatched")
        .order("ignition_updated_at", { ascending: false, nullsFirst: false })
        .limit(25)
      if (like) {
        query = query.or(
          `name.ilike.${like},email.ilike.${like},business_name.ilike.${like}`,
        )
      }
      const { data, error } = await query
      if (error) throw error

      const candidates: Candidate[] = (data ?? []).map((c: any) => ({
        external_id: c.ignition_client_id,
        display_name: c.name || c.business_name || c.email,
        email: c.email,
        hint: c.client_type
          ? `Ignition · ${c.client_type}`
          : "Ignition · unmatched",
      }))
      return NextResponse.json({ candidates })
    }

    return NextResponse.json({ error: "unreachable" }, { status: 500 })
  } catch (err) {
    console.error("[v0] /api/contacts/[id]/links/candidates failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
