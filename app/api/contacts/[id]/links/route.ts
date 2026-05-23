/**
 * Unified Master Hub Contact link management.
 *
 * GET    /api/contacts/[id]/links
 *   Returns the current link state for the contact across every
 *   external platform, plus a `client_mapping` snapshot.
 *
 * POST   /api/contacts/[id]/links
 *   body: { platform: 'karbon'|'proconnect'|'ignition', external_id: string }
 *   Links the Master Hub Contact to an external record. Each platform
 *   has its own source-of-truth column; we update that AND mirror the
 *   change into client_mapping so the master_client_mapping view stays
 *   consistent without waiting for a sync.
 *
 * DELETE /api/contacts/[id]/links?platform=karbon|proconnect|ignition
 *   Unlinks. For Ignition we delegate to apply_ignition_client_match
 *   so the FK cascade onto proposals/invoices/payments is preserved.
 *
 * Why a single endpoint instead of three platform-specific ones?
 * The teammate UX is "link this Hub contact to its other-platform
 * twin" — that's one decision regardless of platform. Routing all
 * three through one handler also guarantees the client_mapping
 * mirror stays in lockstep, which the per-platform admin pages
 * occasionally forgot to do.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Platform = "karbon" | "proconnect" | "ignition"
const VALID_PLATFORMS: Platform[] = ["karbon", "proconnect", "ignition"]

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type EntityKind = "contact" | "organization"

/**
 * Resolve a Master Hub Contact ID to either contacts or organizations.
 * The Master Hub model treats both as first-class — orgs have their
 * own karbon_organization_key and ProConnect organization back-links,
 * so the link API has to handle both.
 */
async function resolveEntity(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<{ kind: EntityKind; row: any } | null> {
  if (!UUID_RE.test(id)) return null

  const { data: contact } = await supabase
    .from("contacts")
    .select(
      "id, full_name, primary_email, karbon_contact_key, ignition_client_id",
    )
    .eq("id", id)
    .maybeSingle()
  if (contact) return { kind: "contact", row: contact }

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, primary_email, karbon_organization_key")
    .eq("id", id)
    .maybeSingle()
  if (org) return { kind: "organization", row: org }

  return null
}

/**
 * Mirror the current link state into client_mapping. We use upsert on
 * the (internal_client_id, client_type) tuple so reruns are idempotent.
 * The view master_client_mapping reads straight off this table, so the
 * admin dashboard reflects link changes immediately without a cron
 * tick.
 */
async function syncMappingRow(
  supabase: ReturnType<typeof createAdminClient>,
  internalClientId: string,
  clientType: "PERSON" | "ORGANIZATION",
  patch: {
    karbon_client_id?: string | null
    proconnect_client_id?: string | null
    ignition_client_id?: string | null
  },
) {
  const { data: existing } = await supabase
    .from("client_mapping")
    .select("id")
    .eq("internal_client_id", internalClientId)
    .maybeSingle()

  if (existing) {
    await supabase
      .from("client_mapping")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
  } else {
    await supabase.from("client_mapping").insert({
      internal_client_id: internalClientId,
      client_type: clientType,
      source_system: "motta_hub",
      ...patch,
    })
  }
}

// ───────────────────────── GET ─────────────────────────
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const resolved = await resolveEntity(supabase, id)
    if (!resolved) {
      return NextResponse.json({ error: "contact not found" }, { status: 404 })
    }

    const { kind, row } = resolved
    const isOrg = kind === "organization"

    // Fetch the current link state from each platform's source-of-
    // truth column. Each query is independent — we run them in
    // parallel for the page-load case.
    const [pcRes, igRes, mappingRes] = await Promise.all([
      // ProConnect — back-linked via proconnect_clients.hub_contact_id
      // (or hub_organization_id for orgs).
      supabase
        .from("proconnect_clients")
        .select(
          "proconnect_client_id, display_name, email, client_type, client_state",
        )
        .eq(isOrg ? "hub_organization_id" : "hub_contact_id", row.id)
        .limit(1)
        .maybeSingle(),

      // Ignition — back-linked via ignition_clients.contact_id /
      // organization_id. There can be more than one (Ignition lets you
      // create multiple billing records for the same person), so we
      // surface them all but treat the most-recently-updated one as
      // primary in the response shape.
      supabase
        .from("ignition_clients")
        .select(
          "ignition_client_id, name, email, business_name, match_status, match_confidence, match_method, ignition_updated_at",
        )
        .eq(isOrg ? "organization_id" : "contact_id", row.id)
        .order("ignition_updated_at", { ascending: false, nullsFirst: false })
        .limit(5),

      supabase
        .from("client_mapping")
        .select(
          "id, karbon_client_id, ignition_client_id, proconnect_client_id, source_system, updated_at",
        )
        .eq("internal_client_id", row.id)
        .maybeSingle(),
    ])

    const karbonKey: string | null = isOrg
      ? row.karbon_organization_key ?? null
      : row.karbon_contact_key ?? null

    return NextResponse.json({
      contact: {
        id: row.id,
        kind,
        display_name: isOrg ? row.name : row.full_name,
        primary_email: row.primary_email,
      },
      links: {
        karbon: karbonKey
          ? {
              external_id: karbonKey,
              karbon_url: isOrg
                ? `https://app.karbonhq.com/${karbonKey}`
                : `https://app.karbonhq.com/${karbonKey}`,
            }
          : null,
        proconnect: pcRes.data
          ? {
              external_id: pcRes.data.proconnect_client_id,
              display_name: pcRes.data.display_name,
              email: pcRes.data.email,
              client_state: pcRes.data.client_state,
              client_type: pcRes.data.client_type,
            }
          : null,
        ignition: (igRes.data ?? []).map((c: any) => ({
          external_id: c.ignition_client_id,
          display_name: c.name,
          email: c.email,
          business_name: c.business_name,
          match_status: c.match_status,
          match_method: c.match_method,
          match_confidence: c.match_confidence,
        })),
      },
      mapping: mappingRes.data ?? null,
    })
  } catch (err) {
    console.error("[v0] GET /api/contacts/[id]/links failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

// ───────────────────────── POST (link) ─────────────────────────
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const platform = body.platform as Platform | undefined
    const externalId = (body.external_id as string | undefined)?.trim()

    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      return NextResponse.json(
        { error: `platform must be one of ${VALID_PLATFORMS.join("|")}` },
        { status: 400 },
      )
    }
    if (!externalId) {
      return NextResponse.json(
        { error: "external_id is required" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const resolved = await resolveEntity(supabase, id)
    if (!resolved) {
      return NextResponse.json({ error: "contact not found" }, { status: 404 })
    }
    const { kind, row } = resolved
    const isOrg = kind === "organization"
    const clientType: "PERSON" | "ORGANIZATION" = isOrg
      ? "ORGANIZATION"
      : "PERSON"

    // ── Karbon ────────────────────────────────────────────────
    if (platform === "karbon") {
      // Stamp the perma-key on the master row directly. Karbon doesn't
      // have a back-link column on its own end (Karbon is the source-of-
      // truth for billable identity, our key is the FK), so writing it
      // here is the link.
      const table = isOrg ? "organizations" : "contacts"
      const col = isOrg ? "karbon_organization_key" : "karbon_contact_key"
      const { error } = await supabase
        .from(table)
        .update({ [col]: externalId, updated_at: new Date().toISOString() })
        .eq("id", row.id)
      if (error) throw error

      await syncMappingRow(supabase, row.id, clientType, {
        karbon_client_id: externalId,
      })

      return NextResponse.json({ ok: true, platform, external_id: externalId })
    }

    // ── ProConnect ────────────────────────────────────────────
    if (platform === "proconnect") {
      // ProConnect's source-of-truth is the back-link on
      // proconnect_clients itself. Write that, and unlink any other PC
      // client that was previously pointing at this hub row (one-to-
      // one invariant).
      const backCol = isOrg ? "hub_organization_id" : "hub_contact_id"
      const otherCol = isOrg ? "hub_contact_id" : "hub_organization_id"

      // Clear any prior link from this hub row first.
      await supabase
        .from("proconnect_clients")
        .update({ [backCol]: null })
        .eq(backCol, row.id)

      // Set the new link.
      const { error } = await supabase
        .from("proconnect_clients")
        .update({ [backCol]: row.id, [otherCol]: null })
        .eq("proconnect_client_id", externalId)
      if (error) throw error

      await syncMappingRow(supabase, row.id, clientType, {
        proconnect_client_id: externalId,
      })

      return NextResponse.json({ ok: true, platform, external_id: externalId })
    }

    // ── Ignition ──────────────────────────────────────────────
    if (platform === "ignition") {
      // Delegate to the existing RPC so the cascade onto proposals,
      // invoices, and payments stays consistent. The RPC also bumps
      // match_status/method/confidence appropriately for "manual"
      // overrides.
      const { error } = await supabase.rpc("apply_ignition_client_match", {
        p_ignition_client_id: externalId,
        p_match_kind: isOrg ? "organization" : "contact",
        p_matched_id: row.id,
        p_notes: "Linked from Master Hub Contact profile",
      })
      if (error) throw error

      await syncMappingRow(supabase, row.id, clientType, {
        ignition_client_id: externalId,
      })

      return NextResponse.json({ ok: true, platform, external_id: externalId })
    }

    return NextResponse.json({ error: "unreachable" }, { status: 500 })
  } catch (err) {
    console.error("[v0] POST /api/contacts/[id]/links failed:", err)
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
    const platform = url.searchParams.get("platform") as Platform | null
    const externalId = url.searchParams.get("external_id")

    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      return NextResponse.json(
        { error: `platform must be one of ${VALID_PLATFORMS.join("|")}` },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const resolved = await resolveEntity(supabase, id)
    if (!resolved) {
      return NextResponse.json({ error: "contact not found" }, { status: 404 })
    }
    const { kind, row } = resolved
    const isOrg = kind === "organization"

    if (platform === "karbon") {
      const table = isOrg ? "organizations" : "contacts"
      const col = isOrg ? "karbon_organization_key" : "karbon_contact_key"
      await supabase
        .from(table)
        .update({ [col]: null, updated_at: new Date().toISOString() })
        .eq("id", row.id)

      await syncMappingRow(
        supabase,
        row.id,
        isOrg ? "ORGANIZATION" : "PERSON",
        { karbon_client_id: null },
      )
      return NextResponse.json({ ok: true, platform, unlinked: true })
    }

    if (platform === "proconnect") {
      const backCol = isOrg ? "hub_organization_id" : "hub_contact_id"
      await supabase
        .from("proconnect_clients")
        .update({ [backCol]: null })
        .eq(backCol, row.id)

      await syncMappingRow(
        supabase,
        row.id,
        isOrg ? "ORGANIZATION" : "PERSON",
        { proconnect_client_id: null },
      )
      return NextResponse.json({ ok: true, platform, unlinked: true })
    }

    if (platform === "ignition") {
      // External ID is REQUIRED for Ignition because a single hub row
      // may be linked to multiple ignition_clients (Ignition allows
      // multiple billing records). The RPC reset path operates on a
      // single ignition_client at a time.
      if (!externalId) {
        return NextResponse.json(
          { error: "external_id required for Ignition unlink" },
          { status: 400 },
        )
      }
      const { error } = await supabase.rpc("apply_ignition_client_match", {
        p_ignition_client_id: externalId,
        p_match_kind: "no_match",
        p_matched_id: null,
        p_notes: "Unlinked from Master Hub Contact profile",
      })
      if (error) throw error

      // Clear mapping only if no other ignition_clients are still
      // linked to this hub row.
      const { data: remaining } = await supabase
        .from("ignition_clients")
        .select("ignition_client_id")
        .eq(isOrg ? "organization_id" : "contact_id", row.id)
        .limit(1)
      if (!remaining || remaining.length === 0) {
        await syncMappingRow(
          supabase,
          row.id,
          isOrg ? "ORGANIZATION" : "PERSON",
          { ignition_client_id: null },
        )
      }
      return NextResponse.json({ ok: true, platform, unlinked: true })
    }

    return NextResponse.json({ error: "unreachable" }, { status: 500 })
  } catch (err) {
    console.error("[v0] DELETE /api/contacts/[id]/links failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
