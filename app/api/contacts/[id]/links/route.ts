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

  // NOTE: `contacts` has NO `ignition_client_id` column. Naming it here made
  // PostgREST reject the whole select, so `contact` came back null, the
  // function fell through to organizations, and every caller 404'd with
  // "contact not found" — breaking the Platform Links panel for EVERY contact
  // in the Hub. The column was never actually used either: Ignition is read
  // natively from `ignition_clients` further down (a client can have several
  // Ignition records, so a scalar on `contacts` could not represent it).
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, full_name, primary_email, karbon_contact_key")
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

/** client_mapping stores ONE platform per row, keyed by source_system. */
const SOURCE_SYSTEM_FOR_COLUMN = {
  karbon_client_id: "KARBON",
  proconnect_client_id: "PROCONNECT",
  ignition_client_id: "IGNITION",
} as const

type MappingColumn = keyof typeof SOURCE_SYSTEM_FOR_COLUMN

/**
 * Mirror the current link state into client_mapping, one row per platform.
 *
 * Two bugs were fixed here, both of which would fire on the very first write:
 *
 *  1. It selected the existing row with `.eq(internal_client_id).maybeSingle()`.
 *     That is NOT unique — client_mapping holds one row per
 *     (internal_client_id, source_system), so any client already linked to two
 *     platforms has two rows and maybeSingle() errors. This is common, not an
 *     edge case: 361 clients have more than one ProConnect mapping row.
 *  2. It inserted `source_system: 'motta_hub'`, which violates
 *     client_mapping_source_system_check — the column only permits
 *     'PROCONNECT', 'KARBON', 'IGNITION' or 'MANUAL', so every insert raised
 *     23514. Each platform now writes its own correct source_system.
 *
 * NOTE ON THE VIEW: master_client_mapping no longer reads from this table for
 * ProConnect/Ignition — it reads the native columns those systems write, because
 * nothing kept client_mapping current (see
 * scripts/391_fix_master_client_mapping_view.sql). This mirror is retained for
 * consumers that still query client_mapping directly, but it is no longer what
 * drives the admin dashboard.
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
  for (const column of Object.keys(patch) as MappingColumn[]) {
    const value = patch[column]
    if (value === undefined) continue
    const sourceSystem = SOURCE_SYSTEM_FOR_COLUMN[column]

    // Target this client's row for THIS platform specifically.
    const { data: rows } = await supabase
      .from("client_mapping")
      .select("id")
      .eq("internal_client_id", internalClientId)
      .eq("source_system", sourceSystem)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)

    const existing = rows?.[0]
    if (existing) {
      await supabase
        .from("client_mapping")
        .update({ [column]: value, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
    } else if (value !== null) {
      // Only mint a row when there is actually a link to record.
      await supabase.from("client_mapping").insert({
        internal_client_id: internalClientId,
        client_type: clientType,
        source_system: sourceSystem,
        [column]: value,
      })
    }
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

      // client_mapping holds one row per (internal_client_id, source_system),
      // so a client linked to several platforms has several rows and
      // .maybeSingle() would error. Fetch them all and fold below.
      supabase
        .from("client_mapping")
        .select(
          "id, karbon_client_id, ignition_client_id, proconnect_client_id, source_system, updated_at",
        )
        .eq("internal_client_id", row.id)
        .order("updated_at", { ascending: false, nullsFirst: false }),
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
      // Fold the per-platform rows back into the single snapshot shape the UI
      // already expects, so widening the query above is not a breaking change.
      // Rows arrive newest-first, so `??=` keeps the freshest value per column.
      mapping: (() => {
        const rows = mappingRes.data ?? []
        if (rows.length === 0) return null
        const folded: {
          id: string | null
          karbon_client_id: string | null
          ignition_client_id: string | null
          proconnect_client_id: string | null
          source_systems: string[]
          updated_at: string | null
        } = {
          id: null,
          karbon_client_id: null,
          ignition_client_id: null,
          proconnect_client_id: null,
          source_systems: [],
          updated_at: null,
        }
        for (const r of rows as Record<string, string | null>[]) {
          folded.id ??= r.id ?? null
          folded.karbon_client_id ??= r.karbon_client_id ?? null
          folded.ignition_client_id ??= r.ignition_client_id ?? null
          folded.proconnect_client_id ??= r.proconnect_client_id ?? null
          folded.updated_at ??= r.updated_at ?? null
          if (r.source_system) folded.source_systems.push(r.source_system)
        }
        return folded
      })(),
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
