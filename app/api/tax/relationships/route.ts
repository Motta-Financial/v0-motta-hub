import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"
import type { RelationshipStatus } from "@/lib/tax/relationships/types"

/**
 * GET /api/tax/relationships
 *
 * Lists relationships for the review queue and the per-profile cards.
 * Query params:
 *   ?status=needs_review|confirmed|rejected|all  (default: needs_review)
 *   ?individual=<proconnect_client_id>           (per-individual filter)
 *   ?business=<proconnect_client_id>             (per-business filter)
 *   ?clientId=<proconnect_client_id>             (matches either side)
 *   ?limit=N                                     (default: 100, max 500)
 *
 * Reads from `tax_client_relationships_enriched` so the row already
 * carries display names and tax_id last4 for both sides.
 */
export async function GET(req: NextRequest) {
  try {
    const admin = createAdminClient()
    const { searchParams } = new URL(req.url)
    const status = (searchParams.get("status") ?? "needs_review") as
      | RelationshipStatus
      | "all"
    const individual = searchParams.get("individual")
    const business = searchParams.get("business")
    const clientId = searchParams.get("clientId")
    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? "100")))

    let q = admin.from("tax_client_relationships_enriched").select("*").limit(limit)
    if (status !== "all") q = q.eq("status", status)
    if (individual) q = q.eq("individual_proconnect_client_id", individual)
    if (business) q = q.eq("business_proconnect_client_id", business)
    if (clientId) {
      q = q.or(
        `individual_proconnect_client_id.eq.${clientId},business_proconnect_client_id.eq.${clientId}`,
      )
    }
    q = q.order("confidence", { ascending: false }).order("updated_at", { ascending: false })

    const { data, error } = await q
    if (error) {
      console.error("[v0] /api/tax/relationships GET failed", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, relationships: data ?? [] })
  } catch (err) {
    console.error("[v0] /api/tax/relationships GET threw", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/tax/relationships
 *
 * Body shape A (manual link):
 *   {
 *     action: "manual",
 *     individual_proconnect_client_id: "...",
 *     business_proconnect_client_id: "...",
 *     relationship_type: "k1_issuer" | "owner" | ...,
 *     notes?: string
 *   }
 *
 * Body shape B (review action — confirm or reject):
 *   {
 *     action: "confirm" | "reject",
 *     id: "<relationship_id>",
 *     notes?: string
 *   }
 *
 * Reviews are immutable from the audit standpoint: rejecting a
 * relationship sets status=rejected but never deletes the underlying
 * signals. A subsequent scan will not re-create a rejected
 * relationship until a new signal pushes it back into review (the
 * scorer respects human-locked statuses — see `upsertScoredGroup`).
 */
export async function POST(req: NextRequest) {
  try {
    const admin = createAdminClient()
    const body = (await req.json().catch(() => null)) as
      | {
          action: "manual"
          individual_proconnect_client_id: string
          business_proconnect_client_id: string
          relationship_type: string
          notes?: string
        }
      | {
          action: "confirm" | "reject"
          id: string
          notes?: string
        }
      | null
    if (!body) return NextResponse.json({ error: "body required" }, { status: 400 })

    if (body.action === "manual") {
      if (
        !body.individual_proconnect_client_id ||
        !body.business_proconnect_client_id ||
        !body.relationship_type
      ) {
        return NextResponse.json(
          { error: "individual/business/relationship_type required" },
          { status: 400 },
        )
      }
      const { data, error } = await admin
        .from("tax_client_relationships")
        .upsert(
          {
            individual_proconnect_client_id: body.individual_proconnect_client_id,
            business_proconnect_client_id: body.business_proconnect_client_id,
            relationship_type: body.relationship_type,
            status: "confirmed",
            confidence: 1,
            direction: "individual_to_business",
            notes: body.notes ?? null,
            reviewed_at: new Date().toISOString(),
          },
          {
            onConflict:
              "individual_proconnect_client_id,business_proconnect_client_id,relationship_type",
          },
        )
        .select("id")
        .single()
      if (error) {
        console.error("[v0] manual link failed", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      // Append a `manual` signal so the audit trail still has a record.
      await admin.from("tax_client_relationship_signals").insert({
        relationship_id: data!.id,
        signal_source: "manual",
        signal_kind: "hub_link",
        signal_value: body.notes ?? null,
        confidence: 1,
        raw: { manual: true },
      })

      return NextResponse.json({ ok: true, id: data!.id })
    }

    if (body.action === "confirm" || body.action === "reject") {
      const status: RelationshipStatus =
        body.action === "confirm" ? "confirmed" : "rejected"
      const { error } = await admin
        .from("tax_client_relationships")
        .update({
          status,
          notes: body.notes ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", body.id)
      if (error) {
        console.error("[v0] review action failed", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[v0] /api/tax/relationships POST threw", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "request failed" },
      { status: 500 },
    )
  }
}
