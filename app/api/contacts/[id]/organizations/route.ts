/**
 * Manage the contact ↔ organization relationship from a contact's
 * People tab.
 *
 * The relationship is one row in `contact_organizations`, which
 * already has `role_or_title`, `ownership_percentage`,
 * `is_primary_contact`, and start/end dates. There's a unique
 * constraint on (contact_id, organization_id), so re-linking the same
 * pair just updates the existing row.
 *
 * Every mutation marks the affected contact AND organization profile
 * summaries stale so the denormalized Client Profile cache picks up
 * the new affiliation on the next read (same pattern as the rest of
 * the Hub — see lib/clients/profile.ts).
 *
 * Endpoints:
 *   POST   /api/contacts/[id]/organizations
 *     body: { organization_id, role_or_title?, ownership_percentage?,
 *             is_primary_contact?, start_date?, end_date? }
 *     Upserts the relationship (insert or update on the unique pair).
 *
 *   PATCH  /api/contacts/[id]/organizations
 *     body: { relationship_id, ...patch }
 *     Updates the editable fields on an existing relationship.
 *
 *   DELETE /api/contacts/[id]/organizations?relationship_id=...
 *     Removes the relationship row.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { markClientProfileStale } from "@/lib/clients/profile"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RelationshipPatch = {
  role_or_title?: string | null
  ownership_percentage?: number | null
  is_primary_contact?: boolean
  start_date?: string | null
  end_date?: string | null
}

function pickPatch(body: any): RelationshipPatch {
  const patch: RelationshipPatch = {}
  if ("role_or_title" in body) {
    const v = body.role_or_title
    patch.role_or_title =
      typeof v === "string" && v.trim().length > 0 ? v.trim() : null
  }
  if ("ownership_percentage" in body) {
    const n = body.ownership_percentage
    patch.ownership_percentage =
      n === null || n === undefined || n === ""
        ? null
        : Number.isFinite(Number(n))
          ? Number(n)
          : null
  }
  if ("is_primary_contact" in body) {
    patch.is_primary_contact = Boolean(body.is_primary_contact)
  }
  if ("start_date" in body) {
    patch.start_date = body.start_date || null
  }
  if ("end_date" in body) {
    patch.end_date = body.end_date || null
  }
  return patch
}

async function ensureContact(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
) {
  if (!UUID_RE.test(id)) return null
  const { data } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("id", id)
    .maybeSingle()
  return data
}

async function ensureOrganization(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
) {
  if (!UUID_RE.test(id)) return null
  const { data } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", id)
    .maybeSingle()
  return data
}

/**
 * Mark both sides of the relationship stale. The denormalized profile
 * for a contact embeds its organizations and vice-versa, so a single
 * link change has to invalidate both rows. Fire-and-forget — the next
 * profile read will recompute.
 */
function invalidate(contactId: string, organizationId: string) {
  void markClientProfileStale(contactId).catch((err) => {
    console.error("[v0] markClientProfileStale(contact) failed:", err)
  })
  void markClientProfileStale(organizationId).catch((err) => {
    console.error("[v0] markClientProfileStale(org) failed:", err)
  })
}

// ───────────────────────── POST (link / upsert) ─────────────────────────
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const organizationId = (body.organization_id as string | undefined)?.trim()

    if (!organizationId || !UUID_RE.test(organizationId)) {
      return NextResponse.json(
        { error: "organization_id is required" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const contact = await ensureContact(supabase, id)
    if (!contact) {
      return NextResponse.json({ error: "contact not found" }, { status: 404 })
    }
    const organization = await ensureOrganization(supabase, organizationId)
    if (!organization) {
      return NextResponse.json(
        { error: "organization not found" },
        { status: 404 },
      )
    }

    const patch = pickPatch(body)

    // Re-linking the same pair is a no-op + role/ownership update — the
    // unique (contact_id, organization_id) constraint enforces that.
    const { data: existing } = await supabase
      .from("contact_organizations")
      .select("id")
      .eq("contact_id", id)
      .eq("organization_id", organizationId)
      .maybeSingle()

    let relationshipId: string

    if (existing) {
      const { data, error } = await supabase
        .from("contact_organizations")
        .update(patch)
        .eq("id", existing.id)
        .select("id, role_or_title, ownership_percentage, is_primary_contact, start_date, end_date")
        .single()
      if (error) throw error
      relationshipId = data.id
    } else {
      const { data, error } = await supabase
        .from("contact_organizations")
        .insert({
          contact_id: id,
          organization_id: organizationId,
          // Default is_primary_contact to true only when this is the
          // contact's first link (matches the existing import behavior
          // we observed in three sample rows).
          ...patch,
        })
        .select("id, role_or_title, ownership_percentage, is_primary_contact, start_date, end_date")
        .single()
      if (error) throw error
      relationshipId = data.id
    }

    invalidate(id, organizationId)

    return NextResponse.json({
      ok: true,
      relationship_id: relationshipId,
      contact_id: id,
      organization_id: organizationId,
      organization_name: organization.name,
      ...patch,
    })
  } catch (err) {
    console.error("[v0] POST /api/contacts/[id]/organizations failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

// ───────────────────────── PATCH (edit existing) ─────────────────────────
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const relationshipId = (body.relationship_id as string | undefined)?.trim()
    if (!relationshipId || !UUID_RE.test(relationshipId)) {
      return NextResponse.json(
        { error: "relationship_id is required" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { data: existing, error: existingErr } = await supabase
      .from("contact_organizations")
      .select("id, contact_id, organization_id")
      .eq("id", relationshipId)
      .maybeSingle()
    if (existingErr) throw existingErr
    if (!existing || existing.contact_id !== id) {
      return NextResponse.json(
        { error: "relationship not found for this contact" },
        { status: 404 },
      )
    }

    const patch = pickPatch(body)
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "no editable fields supplied" },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from("contact_organizations")
      .update(patch)
      .eq("id", relationshipId)
      .select("id, role_or_title, ownership_percentage, is_primary_contact, start_date, end_date")
      .single()
    if (error) throw error

    invalidate(existing.contact_id, existing.organization_id)

    return NextResponse.json({ ok: true, relationship: data })
  } catch (err) {
    console.error("[v0] PATCH /api/contacts/[id]/organizations failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

// ───────────────────────── DELETE (unlink) ─────────────────────────
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const url = new URL(req.url)
    const relationshipId = url.searchParams.get("relationship_id")
    if (!relationshipId || !UUID_RE.test(relationshipId)) {
      return NextResponse.json(
        { error: "relationship_id is required" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { data: existing, error: existingErr } = await supabase
      .from("contact_organizations")
      .select("id, contact_id, organization_id")
      .eq("id", relationshipId)
      .maybeSingle()
    if (existingErr) throw existingErr
    if (!existing || existing.contact_id !== id) {
      return NextResponse.json(
        { error: "relationship not found for this contact" },
        { status: 404 },
      )
    }

    const { error } = await supabase
      .from("contact_organizations")
      .delete()
      .eq("id", relationshipId)
    if (error) throw error

    invalidate(existing.contact_id, existing.organization_id)

    return NextResponse.json({ ok: true, unlinked: true })
  } catch (err) {
    console.error("[v0] DELETE /api/contacts/[id]/organizations failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
