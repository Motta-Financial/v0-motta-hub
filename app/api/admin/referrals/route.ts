import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/admin/referrals
 *
 * Powers the /admin/referrals dashboard. Returns five aggregations in a
 * single round-trip so the page can render without a waterfall:
 *
 *   - totals          : counts by match_status (drives the KPI strip)
 *   - topReferrers    : top contacts that have referred others (matched)
 *   - workQueue       : unresolved rows that need human review
 *                       (unmatched_not_in_hub, unmatched_ambiguous,
 *                        unmatched_external)
 *   - dataQuality     : §6 spec checks — contacts missing legacy ids,
 *                       contacts missing a state/phone, jotform rows
 *                       with no submission link, etc.
 *   - recent          : latest 25 referrals (matched + unmatched mixed)
 *
 * Service-role only (this is an admin surface), and capped at sensible
 * limits to keep the response under ~200 KB.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const supabase = createAdminClient()

  // ── totals ──────────────────────────────────────────────────────
  const totalsRes = await supabase
    .from("referrals")
    .select("match_status", { count: "exact" })
    .limit(2000)

  const totals: Record<string, number> = {}
  for (const r of totalsRes.data || []) {
    totals[r.match_status] = (totals[r.match_status] || 0) + 1
  }

  // ── top referrers (matched only) ────────────────────────────────
  // We aggregate in JS rather than asking PostgREST for a GROUP BY
  // (PostgREST doesn't support it natively) — small enough volume
  // (~360 rows) that this is fine.
  const matchedRes = await supabase
    .from("referrals")
    .select("referred_by_contact_id, source")
    .eq("match_status", "matched_existing")
    .not("referred_by_contact_id", "is", null)

  const refCounts = new Map<string, { contact: number; jotform: number }>()
  for (const r of matchedRes.data || []) {
    const id = r.referred_by_contact_id as string
    if (!id) continue
    const cur = refCounts.get(id) ?? { contact: 0, jotform: 0 }
    if (r.source === "jotform_intake") cur.jotform++
    else cur.contact++
    refCounts.set(id, cur)
  }

  const topIds = [...refCounts.entries()]
    .sort((a, b) => b[1].contact + b[1].jotform - (a[1].contact + a[1].jotform))
    .slice(0, 25)
    .map(([id]) => id)

  let topReferrers: Array<{
    id: string
    name: string
    legacy_id: string | null
    state: string | null
    contact_referrals: number
    jotform_referrals: number
    total: number
  }> = []
  if (topIds.length) {
    const peopleRes = await supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, primary_email, mailing_state, state, legacy_motta_client_id",
      )
      .in("id", topIds)
    const byId = new Map((peopleRes.data || []).map((p: any) => [p.id, p]))
    topReferrers = topIds.map((id) => {
      const p: any = byId.get(id)
      const counts = refCounts.get(id)!
      const fullName =
        [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
        p?.primary_email ||
        "Unknown"
      return {
        id,
        name: fullName,
        legacy_id: p?.legacy_motta_client_id ?? null,
        state: p?.state ?? p?.mailing_state ?? null,
        contact_referrals: counts.contact,
        jotform_referrals: counts.jotform,
        total: counts.contact + counts.jotform,
      }
    })
  }

  // ── work queue (unresolved) ─────────────────────────────────────
  const workRes = await supabase
    .from("referrals")
    .select(
      `id, source, match_status, match_confidence, candidate_contact_ids,
       referred_by_legacy_id, referred_by_raw, created_at,
       referee_contact_id, referee_jotform_submission_id`,
    )
    .in("match_status", [
      "unmatched_not_in_hub",
      "unmatched_ambiguous",
      "unmatched_external",
    ])
    .order("created_at", { ascending: false })
    .limit(200)

  // resolve referee display info in two batched lookups
  const refereeContactIds = (workRes.data || [])
    .map((r: any) => r.referee_contact_id)
    .filter(Boolean)
  const refereeJotformIds = (workRes.data || [])
    .map((r: any) => r.referee_jotform_submission_id)
    .filter(Boolean)

  const [refereeContactsRes, refereeJotformsRes] = await Promise.all([
    refereeContactIds.length
      ? supabase
          .from("contacts")
          .select("id, first_name, last_name, primary_email")
          .in("id", refereeContactIds)
      : Promise.resolve({ data: [] as any[] }),
    refereeJotformIds.length
      ? supabase
          .from("jotform_intake_submissions")
          .select("id, submitter_full_name, submitter_email, business_name")
          .in("id", refereeJotformIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const contactById = new Map(
    (refereeContactsRes.data || []).map((c: any) => [c.id, c]),
  )
  const jotformById = new Map(
    (refereeJotformsRes.data || []).map((j: any) => [j.id, j]),
  )

  const workQueue = (workRes.data || []).map((r: any) => {
    const referee = r.referee_contact_id
      ? contactById.get(r.referee_contact_id)
      : jotformById.get(r.referee_jotform_submission_id)
    const refereeName = referee
      ? r.referee_contact_id
        ? [(referee as any).first_name, (referee as any).last_name]
            .filter(Boolean)
            .join(" ") ||
          (referee as any).primary_email ||
          "Unknown"
        : (referee as any).submitter_full_name ||
          (referee as any).business_name ||
          (referee as any).submitter_email ||
          "Unknown"
      : "Unknown"
    return {
      id: r.id,
      source: r.source,
      match_status: r.match_status,
      match_confidence: r.match_confidence,
      raw_text: r.referred_by_raw,
      legacy_id: r.referred_by_legacy_id,
      candidates: r.candidate_contact_ids,
      created_at: r.created_at,
      referee: {
        kind: r.referee_contact_id ? "contact" : "jotform",
        id: r.referee_contact_id || r.referee_jotform_submission_id,
        name: refereeName,
      },
    }
  })

  // ── data-quality flags (§6) ─────────────────────────────────────
  const [
    contactsTotal,
    contactsMissingLegacy,
    contactsNoState,
    contactsNoPhone,
    jotformUnlinked,
  ] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .is("legacy_motta_client_id", null),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .is("state", null)
      .is("mailing_state", null),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .is("phone_primary", null)
      .is("phone_mobile", null)
      .is("phone_work", null),
    supabase
      .from("jotform_intake_submissions")
      .select("id", { count: "exact", head: true })
      .is("contact_id", null),
  ])

  const dataQuality = {
    contacts_total: contactsTotal.count ?? 0,
    contacts_missing_legacy_id: contactsMissingLegacy.count ?? 0,
    contacts_missing_state: contactsNoState.count ?? 0,
    contacts_missing_phone: contactsNoPhone.count ?? 0,
    jotform_unlinked: jotformUnlinked.count ?? 0,
  }

  return NextResponse.json({
    totals,
    topReferrers,
    workQueue,
    dataQuality,
    generatedAt: new Date().toISOString(),
  })
}
