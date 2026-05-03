/**
 * Force a fresh re-sync of a single client (contact OR organization) from
 * Karbon. Used by the "Re-sync from Karbon" button on the client detail page.
 *
 * Resolves the karbon perma-key from Supabase (or accepts the karbon key
 * directly), then calls the relevant `upsert*ByKey` helper which fetches the
 * latest record from Karbon's API and upserts it into Supabase.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  upsertContactByKey,
  upsertOrganizationByKey,
  upsertContactLikeByKey,
} from "@/lib/karbon/upsert"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    let karbonKey: string | null = null
    let kind: "contact" | "organization" | "unknown" = "unknown"

    if (UUID_RE.test(id)) {
      // Resolve UUID → karbon key
      const [{ data: contact }, { data: org }] = await Promise.all([
        supabase
          .from("contacts")
          .select("karbon_contact_key")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("organizations")
          .select("karbon_organization_key")
          .eq("id", id)
          .maybeSingle(),
      ])
      if (contact?.karbon_contact_key) {
        karbonKey = contact.karbon_contact_key
        kind = "contact"
      } else if (org?.karbon_organization_key) {
        karbonKey = org.karbon_organization_key
        kind = "organization"
      }
    } else {
      // Treat as karbon key — figure out which side it lives on (if any)
      karbonKey = id
      const [{ data: contact }, { data: org }] = await Promise.all([
        supabase
          .from("contacts")
          .select("id")
          .eq("karbon_contact_key", id)
          .maybeSingle(),
        supabase
          .from("organizations")
          .select("id")
          .eq("karbon_organization_key", id)
          .maybeSingle(),
      ])
      if (contact) kind = "contact"
      else if (org) kind = "organization"
    }

    if (!karbonKey) {
      return NextResponse.json(
        { ok: false, error: "Could not resolve a Karbon key for this client" },
        { status: 404 },
      )
    }

    // Run the right upsert. If we don't know which kind it is, try Contact →
    // Organization → ClientGroup in that order (the standard webhook fallback).
    const result =
      kind === "organization"
        ? await upsertOrganizationByKey(karbonKey)
        : kind === "contact"
          ? await upsertContactByKey(karbonKey)
          : await upsertContactLikeByKey(karbonKey)

    return NextResponse.json({
      ok: result.ok,
      action: result.action,
      table: result.table,
      kind,
      karbonKey,
      error: result.error,
    })
  } catch (error) {
    console.error("[v0] Error syncing client:", error)
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to sync client",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
