/**
 * GET /api/prospects/[id]/proconnect-match
 *
 * Read-only preview step for "Create Tax Return in PTO". Given a
 * prospect submission, resolves whether its linked Hub contact/org
 * already has a matching row in `proconnect_clients` and returns enough
 * detail for a human to confirm before any write to ProConnect happens.
 *
 * This endpoint NEVER calls ProConnect and NEVER creates a client. It
 * only reads `prospect_submissions` and `proconnect_clients` (already
 * synced locally). Per the product decision for this feature: Create
 * Tax Return only ever targets a client that already exists in
 * ProConnect — creating a new ProConnect client is out of scope and the
 * doc warns duplicates are hard to undo, so we don't guess here.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireLeadership } from "@/lib/auth/require-leadership"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireLeadership()
    if (!auth.ok) return auth.response

    const { id } = await params
    if (!id || !isUuid(id)) {
      return NextResponse.json({ error: "Invalid prospect id" }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: submission, error: submissionError } = await supabase
      .from("prospect_submissions")
      .select(
        [
          "id",
          "submitter_full_name",
          "submitter_first_name",
          "submitter_last_name",
          "business_name",
          "service_focus",
          "entity_types",
          "contact_id",
          "organization_id",
        ].join(","),
      )
      .eq("id", id)
      .maybeSingle()

    if (submissionError) throw submissionError
    if (!submission) {
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 })
    }
    const row = submission as Record<string, any>

    if (!row.contact_id && !row.organization_id) {
      return NextResponse.json({
        ok: true,
        matchState: "no_hub_link",
        message:
          "This prospect isn't linked to a Hub contact or organization yet. Link it before creating a tax return.",
        client: null,
      })
    }

    // A prospect could in theory have both a contact and an org linked
    // (e.g. a person who also has a business submission) — check both
    // and treat more than one ProConnect match as ambiguous rather than
    // silently picking one.
    const matches: Array<Record<string, any>> = []

    if (row.contact_id) {
      const { data, error } = await supabase
        .from("proconnect_clients")
        .select(
          "proconnect_client_id, client_type, display_name, first_name, last_name, business_name, email, hub_contact_id, hub_organization_id",
        )
        .eq("hub_contact_id", row.contact_id)
      if (error) throw error
      matches.push(...(data || []))
    }

    if (row.organization_id) {
      const { data, error } = await supabase
        .from("proconnect_clients")
        .select(
          "proconnect_client_id, client_type, display_name, first_name, last_name, business_name, email, hub_contact_id, hub_organization_id",
        )
        .eq("hub_organization_id", row.organization_id)
      if (error) throw error
      matches.push(...(data || []))
    }

    // De-dupe (a client row could theoretically show up from both checks)
    const uniqueMatches = Array.from(
      new Map(matches.map((m) => [m.proconnect_client_id, m])).values(),
    )

    if (uniqueMatches.length === 0) {
      return NextResponse.json({
        ok: true,
        matchState: "no_match",
        message:
          "No matching ProConnect client found for this prospect's linked contact/organization. Create Tax Return requires an existing ProConnect client — this tool does not create new ProConnect clients.",
        client: null,
      })
    }

    if (uniqueMatches.length > 1) {
      return NextResponse.json({
        ok: true,
        matchState: "ambiguous",
        message: `Found ${uniqueMatches.length} possible ProConnect clients for this prospect. Resolve the ambiguity in Tax → Client Links before creating a return.`,
        client: null,
        candidates: uniqueMatches,
      })
    }

    return NextResponse.json({
      ok: true,
      matchState: "matched",
      client: uniqueMatches[0],
      suggestedName:
        row.business_name ||
        row.submitter_full_name ||
        [row.submitter_first_name, row.submitter_last_name].filter(Boolean).join(" ") ||
        uniqueMatches[0].display_name ||
        "",
    })
  } catch (err: any) {
    console.error("[v0] GET /api/prospects/[id]/proconnect-match error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}
