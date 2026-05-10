import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/jotform/feedback — list feedback submissions for the
 * /feedback admin page.
 *
 * Mirrors /api/jotform/intake in shape and conventions: admin client,
 * trims `raw_answers` out of the projection, resolves `reviewed_by_id`
 * to a small team-member object so the table can render in one
 * round-trip.
 *
 * Supported filters:
 *   ?status=new|reviewed|responded|closed     (triage_status)
 *   ?segment=promoter|passive|detractor       (rating_overall buckets)
 *   ?with_referrals=1                         (referral_count > 0)
 *   ?linked=yes|no                            (filter by client link)
 *   ?search=<text> matches name, email, comments (ILIKE)
 *   ?limit=<n> default 200, max 1000
 *
 * Segment definitions (1-5 star scale, applied to rating_overall):
 *   promoter   → 5
 *   passive    → 4
 *   detractor  → 1, 2, or 3
 *
 * These are stricter than NPS but match how the firm actually uses the
 * "rate your overall experience" question — anything below a 5 gets
 * triaged for follow-up.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const status = searchParams.get("status")
    const segment = searchParams.get("segment")
    const withReferrals = searchParams.get("with_referrals")
    const linked = searchParams.get("linked") // "yes" | "no" | null
    const search = searchParams.get("search")?.trim()
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000)

    let query = supabase
      .from("jotform_feedback_submissions")
      .select(
        `
        id,
        jotform_submission_id,
        jotform_created_at,
        submitter_full_name,
        submitter_first_name,
        submitter_last_name,
        submitter_email,
        client_status,
        rating_overall,
        rating_service_quality,
        rating_communication,
        rating_responsiveness,
        rating_friendliness,
        feedback_comments,
        permission_to_share,
        has_referral_interest,
        referral_count,
        triage_status,
        reviewed_by_id,
        reviewed_at,
        karbon_work_item_id,
        karbon_work_item_title,
        contact_id,
        organization_id,
        link_method,
        linked_at
        `,
      )
      .order("jotform_created_at", { ascending: false, nullsFirst: false })
      .limit(limit)

    if (status) query = query.eq("triage_status", status)
    if (withReferrals === "1") query = query.gt("referral_count", 0)

    // Linked-client filter mirrors /api/jotform/intake: applied
    // server-side so the count and list stay consistent.
    if (linked === "yes") {
      query = query.or("contact_id.not.is.null,organization_id.not.is.null")
    } else if (linked === "no") {
      query = query.is("contact_id", null).is("organization_id", null)
    }

    if (segment === "promoter") {
      query = query.eq("rating_overall", 5)
    } else if (segment === "passive") {
      query = query.eq("rating_overall", 4)
    } else if (segment === "detractor") {
      query = query.lte("rating_overall", 3).gt("rating_overall", 0)
    }

    if (search) {
      const safe = search.replace(/[%,()]/g, " ")
      const pattern = `%${safe}%`
      query = query.or(
        `submitter_full_name.ilike.${pattern},submitter_email.ilike.${pattern},feedback_comments.ilike.${pattern}`,
      )
    }

    const { data, error } = await query
    if (error) throw error

    // Resolve reviewed_by_id → team member display info, matching the
    // pattern used in /api/jotform/intake.
    const reviewerIds = Array.from(
      new Set((data ?? []).map((r) => r.reviewed_by_id).filter(Boolean) as string[]),
    )
    const reviewerById = new Map<string, { id: string; name: string; avatarUrl: string | null }>()
    if (reviewerIds.length > 0) {
      const { data: members } = await supabase
        .from("team_members")
        .select("id, full_name, first_name, last_name, avatar_url")
        .in("id", reviewerIds)
      for (const m of members ?? []) {
        reviewerById.set(m.id, {
          id: m.id,
          name: m.full_name || `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
          avatarUrl: m.avatar_url ?? null,
        })
      }
    }

    // Resolve linked-client display info — same shape as intake.
    const contactIds = Array.from(
      new Set((data ?? []).map((r) => r.contact_id).filter(Boolean) as string[]),
    )
    const orgIds = Array.from(
      new Set((data ?? []).map((r) => r.organization_id).filter(Boolean) as string[]),
    )
    const contactById = new Map<string, { id: string; name: string }>()
    const orgById = new Map<string, { id: string; name: string }>()
    if (contactIds.length > 0) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, full_name, first_name, last_name")
        .in("id", contactIds)
      for (const c of contacts ?? []) {
        contactById.set(c.id, {
          id: c.id,
          name: c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unnamed contact",
        })
      }
    }
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name, full_name")
        .in("id", orgIds)
      for (const o of orgs ?? []) {
        orgById.set(o.id, { id: o.id, name: o.name || o.full_name || "Unnamed organization" })
      }
    }

    const rows = (data ?? []).map((r) => {
      let linkedClient: { type: "contact" | "organization"; id: string; name: string } | null = null
      if (r.contact_id) {
        const c = contactById.get(r.contact_id)
        if (c) linkedClient = { type: "contact", id: c.id, name: c.name }
      } else if (r.organization_id) {
        const o = orgById.get(r.organization_id)
        if (o) linkedClient = { type: "organization", id: o.id, name: o.name }
      }
      return {
        ...r,
        reviewedBy: r.reviewed_by_id ? reviewerById.get(r.reviewed_by_id) ?? null : null,
        linkedClient,
      }
    })

    return NextResponse.json({ rows, count: rows.length })
  } catch (err: any) {
    console.error("[v0] GET /api/jotform/feedback error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}
