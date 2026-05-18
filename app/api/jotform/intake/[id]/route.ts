import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Detail + triage actions for a single intake submission.
 *
 *   GET    → full row including `raw_answers` (every Jotform Q/A pair)
 *   PATCH  → mutate triage state: lead_status, assigned_to_id, triage_notes
 *
 * Both use the admin client because intake submissions are firm-wide
 * operational data and any staff member needs to be able to read /
 * triage them. Only the three triage columns are PATCH-able; everything
 * else is sourced from Jotform and would be overwritten on the next
 * submission update if we let the UI mutate it.
 */

const ALLOWED_STATUSES = new Set([
  "new",
  "contacted",
  "qualified",
  "converted",
  "declined",
])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("jotform_intake_submissions")
      .select("*")
      .eq("id", id)
      .single()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let assignedTo: { id: string; name: string; avatarUrl: string | null } | null = null
    if (data.assigned_to_id) {
      const { data: m } = await supabase
        .from("team_members")
        .select("id, full_name, first_name, last_name, avatar_url")
        .eq("id", data.assigned_to_id)
        .maybeSingle()
      if (m) {
        assignedTo = {
          id: m.id,
          name: m.full_name || `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
          avatarUrl: m.avatar_url ?? null,
        }
      }
    }

    // ── Resolve linked-client display info for both sides ─────────────
    // The detail sheet shows two "Linked client" controls — one for the
    // prospect (contact_id / organization_id) and one for the referrer
    // (referral_contact_id / referral_organization_id). We hydrate
    // names here so the UI can render the link without a second
    // round-trip per record.
    type LinkedClient = { type: "contact" | "organization"; id: string; name: string; email: string | null } | null
    async function hydrateLinkedClient(
      contactId: string | null,
      orgId: string | null,
    ): Promise<LinkedClient> {
      if (contactId) {
        const { data: c } = await supabase
          .from("contacts")
          .select("id, full_name, primary_email")
          .eq("id", contactId)
          .maybeSingle()
        if (c) {
          return {
            type: "contact",
            id: c.id,
            name: c.full_name || "(unnamed contact)",
            email: c.primary_email ?? null,
          }
        }
      }
      if (orgId) {
        const { data: o } = await supabase
          .from("organizations")
          .select("id, name, primary_email")
          .eq("id", orgId)
          .maybeSingle()
        if (o) {
          return {
            type: "organization",
            id: o.id,
            name: o.name || "(unnamed organization)",
            email: o.primary_email ?? null,
          }
        }
      }
      return null
    }

    const [linkedClient, referralLinkedClient] = await Promise.all([
      hydrateLinkedClient(data.contact_id, data.organization_id),
      hydrateLinkedClient(data.referral_contact_id, data.referral_organization_id),
    ])

    return NextResponse.json({
      submission: { ...data, assignedTo, linkedClient, referralLinkedClient },
    })
  } catch (err: any) {
    console.error("[v0] GET /api/jotform/intake/[id] error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const supabase = createAdminClient()

    const updates: Record<string, unknown> = {}

    if (body.lead_status !== undefined) {
      if (body.lead_status !== null && !ALLOWED_STATUSES.has(body.lead_status)) {
        return NextResponse.json(
          { error: `Invalid lead_status. Allowed: ${[...ALLOWED_STATUSES].join(", ")}` },
          { status: 400 },
        )
      }
      updates.lead_status = body.lead_status
    }
    if (body.assigned_to_id !== undefined) {
      updates.assigned_to_id = body.assigned_to_id || null
    }
    if (body.triage_notes !== undefined) {
      updates.triage_notes = body.triage_notes
    }
    if (body.action_items !== undefined) {
      // Action items from the triage sheet — store as JSONB
      updates.action_items = body.action_items
    }

    // ── Linked-client mutations (prospect + referrer) ──────────────
    // The Intake detail sheet exposes a "Link to client" picker for
    // both the prospect (contact_id/organization_id) and the
    // referrer (referral_contact_id/referral_organization_id). The
    // payload always sets the two columns of a pair together so the
    // pair is mutually exclusive (a record is EITHER a contact OR an
    // organization, never both). We accept null to clear a link.
    if (body.contact_id !== undefined) {
      updates.contact_id = body.contact_id || null
    }
    if (body.organization_id !== undefined) {
      updates.organization_id = body.organization_id || null
    }
    if (body.referral_contact_id !== undefined) {
      updates.referral_contact_id = body.referral_contact_id || null
    }
    if (body.referral_organization_id !== undefined) {
      updates.referral_organization_id = body.referral_organization_id || null
    }

    // ── Identity overrides ─────────────────────────────────────────
    // Triagers can correct typos in the prospect's submitted name or
    // the free-text referral source so subsequent client-link search
    // queries actually find the underlying Hub record. We deliberately
    // overwrite the original Jotform values rather than tracking
    // overrides separately: the form's raw payload still lives in
    // `raw_answers` for audit, and downstream consumers (Karbon notes,
    // Daily Briefing) want the corrected name. Keeping
    // `submitter_full_name` consistent with the first/last pair is
    // the caller's responsibility — the UI sends both together.
    if (body.submitter_first_name !== undefined) {
      updates.submitter_first_name = body.submitter_first_name || null
    }
    if (body.submitter_last_name !== undefined) {
      updates.submitter_last_name = body.submitter_last_name || null
    }
    if (body.submitter_full_name !== undefined) {
      updates.submitter_full_name = body.submitter_full_name || null
    }
    if (body.business_name !== undefined) {
      updates.business_name = body.business_name || null
    }
    if (body.referral_source !== undefined) {
      updates.referral_source = body.referral_source || null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("jotform_intake_submissions")
      .update(updates)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ submission: data })
  } catch (err: any) {
    console.error("[v0] PATCH /api/jotform/intake/[id] error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}
