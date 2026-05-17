import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/jotform/intake — list intake submissions for the admin UI.
 *
 * Uses the **admin client** because intake leads are firm-wide
 * operational data: any signed-in staff member needs to see the full
 * inbox to triage. We deliberately do NOT return `raw_answers` here —
 * that JSON blob can be 5–20kB per row and only the detail view needs
 * it. The list query stays small + fast even at 1k+ submissions.
 *
 * Supported filters (query params):
 *   ?status=new|contacted|qualified|converted|declined
 *   ?focus=Personal Only|Business Only|Both Personal & Business
 *   ?linked=yes|no             — filter by whether the row is linked
 *                                to a contact or organization
 *   ?state=<state>             — filter on submitter_state (exact match,
 *                                full state name as Jotform delivers it)
 *   ?referral=<text>           — ILIKE match on referral_source
 *   ?professional=<uuid>|none  — filter on preferred_team_member_id;
 *                                'none' surfaces submissions where
 *                                the prospect didn't pick anyone
 *                                (or whose pick couldn't be resolved)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD — date-range filter on
 *                                jotform_created_at
 *   ?search=<free text>        — matches name, email, business_name (ILIKE)
 *   ?limit=<n> (default 200, max 1000)
 *
 * Returned shape mirrors the table columns the list view renders, plus
 * a small `assignedTo` projection so the table doesn't need a second
 * round-trip to resolve team-member names/avatars and a `linkedClient`
 * projection that resolves contact_id/organization_id to a display
 * name + entity type + clickable id.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const status = searchParams.get("status")
    const focus = searchParams.get("focus")
    const linked = searchParams.get("linked") // "yes" | "no" | null
    const stateFilter = searchParams.get("state")?.trim()
    const referralFilter = searchParams.get("referral")?.trim()
    // "none" is a sentinel for "the prospect didn't pick anyone (or
    // we couldn't resolve who they picked)"; any other value is
    // treated as a UUID equality match on `preferred_team_member_id`.
    const professionalFilter = searchParams.get("professional")?.trim()
    const fromDate = searchParams.get("from")?.trim()
    const toDate = searchParams.get("to")?.trim()
    const search = searchParams.get("search")?.trim()
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000)

    let query = supabase
      .from("jotform_intake_submissions")
      .select(
        `
        id,
        jotform_submission_id,
        jotform_created_at,
        submitter_full_name,
        submitter_first_name,
        submitter_last_name,
        submitter_email,
        submitter_phone,
        submitter_state,
        services_requested,
        service_focus,
        entity_types,
        business_name,
        business_revenue_range,
        business_summary,
        lead_status,
        triage_notes,
        assigned_to_id,
        contact_id,
        organization_id,
        link_method,
        linked_at,
        lead_id,
        referral_source,
        preferred_team_member,
        preferred_team_member_id
        `,
      )
      .order("jotform_created_at", { ascending: false, nullsFirst: false })
      .limit(limit)

    if (status) query = query.eq("lead_status", status)
    if (focus) query = query.eq("service_focus", focus)
    if (stateFilter) query = query.eq("submitter_state", stateFilter)
    // `referral_source` is free text — use ILIKE so a partial match
    // ("emily") finds the row even when the prospect typed a longer
    // shoutout ("Emily Mooza, Andrew Castronovo").
    if (referralFilter) {
      const safe = referralFilter.replace(/[%,()]/g, " ")
      query = query.ilike("referral_source", `%${safe}%`)
    }
    if (professionalFilter) {
      if (professionalFilter === "none") {
        query = query.is("preferred_team_member_id", null)
      } else {
        query = query.eq("preferred_team_member_id", professionalFilter)
      }
    }
    if (fromDate) query = query.gte("jotform_created_at", fromDate)
    // `to` is treated as inclusive of the entire day. We stay date-only
    // (`YYYY-MM-DD`) at the API surface to keep the URL cacheable; if a
    // narrower window ever matters we'll add an `?to_time=` later.
    if (toDate) query = query.lt("jotform_created_at", `${toDate}T23:59:59.999Z`)

    // "linked=yes" → must have at least one of contact_id / org_id.
    // "linked=no"  → both must be null. Done at the SQL layer so
    // the row count returned to the client is honest.
    if (linked === "yes") {
      query = query.or("contact_id.not.is.null,organization_id.not.is.null")
    } else if (linked === "no") {
      query = query.is("contact_id", null).is("organization_id", null)
    }

    if (search) {
      // PostgREST `or` filter with three ILIKE branches. We escape `%` and
      // commas in the search term to keep this safe; PostgREST treats `,`
      // as a separator inside `or(...)` so a comma in the search would
      // otherwise be interpreted as a list of conditions.
      const safe = search.replace(/[%,()]/g, " ")
      const pattern = `%${safe}%`
      query = query.or(
        `submitter_full_name.ilike.${pattern},submitter_email.ilike.${pattern},business_name.ilike.${pattern}`,
      )
    }

    const { data, error } = await query
    if (error) throw error

    // Resolve assigned_to_id → team member display info in a single
    // follow-up query. Avoids N round-trips and keeps the API
    // self-contained so the table can render immediately. We resolve
    // *both* `assigned_to_id` (queue ownership) and
    // `preferred_team_member_id` (the prospect's pick) from the same
    // batched lookup, since they often refer to the same person.
    const teamMemberIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((r) => [r.assigned_to_id, r.preferred_team_member_id])
          .filter(Boolean) as string[],
      ),
    )
    const teamMemberById = new Map<
      string,
      { id: string; name: string; avatarUrl: string | null; heroProfileSlug: string | null }
    >()
    if (teamMemberIds.length > 0) {
      const { data: members } = await supabase
        .from("team_members")
        .select("id, full_name, first_name, last_name, avatar_url, hero_profile_slug")
        .in("id", teamMemberIds)
      for (const m of members ?? []) {
        teamMemberById.set(m.id, {
          id: m.id,
          name: m.full_name || `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
          avatarUrl: m.avatar_url ?? null,
          heroProfileSlug: m.hero_profile_slug ?? null,
        })
      }
    }

    // Resolve linked client display info. Two parallel lookups (one
    // per table) keyed by the FK columns. The list view shows the
    // matched client as a chip, so we just need name + id.
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
      // Surface the most-specific link first: a contact wins over an
      // organization on the (rare) row where both happen to be set,
      // because contact-level matches are higher confidence.
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
        assignedTo: r.assigned_to_id ? teamMemberById.get(r.assigned_to_id) ?? null : null,
        // The Motta professional the prospect explicitly asked for on
        // the form. May or may not equal `assignedTo`. Falls back to
        // null when the prospect skipped the question or chose someone
        // we couldn't resolve to an active team_members row.
        preferredProfessional: r.preferred_team_member_id
          ? teamMemberById.get(r.preferred_team_member_id) ?? null
          : null,
        linkedClient,
      }
    })

    return NextResponse.json({ rows, count: rows.length })
  } catch (err: any) {
    console.error("[v0] GET /api/jotform/intake error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}
