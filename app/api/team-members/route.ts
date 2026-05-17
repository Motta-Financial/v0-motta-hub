import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { ALFRED_EMAIL, isAlfredServiceAccount } from "@/lib/alfred/service-account"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const role = searchParams.get("role")
    const status = searchParams.get("status")

    // Default behavior:
    //   - exclude is_active=false members (Alumni / deactivated)
    //   - exclude system accounts ("Company" role: Motta Financial, Karbon HQ)
    // Pass ?include_all=true to bypass these filters (admin views).
    // Pass ?include_inactive=true to keep system accounts hidden but include
    // inactive humans (e.g. directory pages that show Active/Inactive tabs).
    const includeAll = searchParams.get("include_all") === "true"
    const includeInactive = includeAll || searchParams.get("include_inactive") === "true"

    let query = supabase.from("team_members").select("*").order("full_name", { ascending: true })

    if (role) {
      query = query.eq("role", role)
    } else if (!includeAll) {
      // System accounts (role='Company': Motta Financial, Karbon HQ) should
      // never appear in user-facing selectors regardless of is_active. We
      // explicitly OR in role.is.null so PostgREST doesn't drop NULL-role
      // rows due to SQL three-valued logic on `not.eq`.
      query = query.or("role.is.null,role.neq.Company")
    }
    if (!includeInactive) {
      query = query.eq("is_active", true)
    }
    if (status) {
      query = query.eq("status", status)
    }

    const { data: teamMembers, error } = await query

    if (error) throw error

    // ── ALFRED de-duplication ──────────────────────────────────────
    // ALFRED is intentionally represented by two `team_members` rows
    // that cannot be physically merged:
    //   1) The original human-facing row, which carries the Supabase
    //      `auth_user_id` (so anyone signing in as ALFRED resolves
    //      back to a real team_member), along with `start_date`,
    //      `timezone`, etc. Its email is `info@mottafinancial.com`.
    //   2) The protected service-account sentinel (created by
    //      scripts/052_alfred_service_account.sql) with
    //      `is_service_account = TRUE`, `hero_profile_slug = 'alfred'`,
    //      and email `Info@mottafinancial.com`. A DB trigger
    //      (trg_team_members_protect_service_account) blocks any
    //      attempt to delete it or flip the flag off.
    //
    // `isAlfredServiceAccount()` matches both rows (case-insensitive
    // email), which is why the Team page rendered two ALFRED cards.
    // Rather than fight the schema, we collapse the pair here into a
    // single richer record by merging non-null fields from the
    // service-account row onto the human-auth row. The human-auth
    // row's id is preserved so downstream consumers (auth lookups,
    // links to /team/[id], etc.) keep working unchanged.
    const rows = teamMembers || []
    const alfredRows = rows.filter((m) => isAlfredServiceAccount(m))
    let merged = rows
    if (alfredRows.length > 1) {
      // Prefer the row with an auth_user_id as the canonical base —
      // it's the one a real human session resolves to. Fall back to
      // the lowercase-email row if no auth link exists yet (e.g.
      // local environments where auth hasn't been wired). The service
      // account row provides the supplementary fields below.
      const base =
        alfredRows.find((m) => !!m.auth_user_id) ??
        alfredRows.find((m) => m.email === ALFRED_EMAIL.toLowerCase()) ??
        alfredRows[0]
      const supplement =
        alfredRows.find((m) => m.is_service_account === true) ??
        alfredRows.find((m) => m.id !== base.id) ??
        base

      // Field-by-field merge: take base's value first, fall back to
      // supplement when base is null/empty. We explicitly force
      // is_service_account=true on the merged record so badges and
      // protection logic in the UI continue to render correctly.
      const pick = <K extends keyof typeof base>(k: K) =>
        base[k] != null && base[k] !== "" ? base[k] : (supplement as any)[k]

      const mergedAlfred = {
        ...base,
        is_service_account: true,
        hero_profile_slug: pick("hero_profile_slug"),
        title: pick("title"),
        // Role/department on the human-auth row ("Assistant" / "Firm")
        // are intentionally preserved when present so the card keeps
        // its existing copy; the service-account row's values are
        // only used if the human row's field is empty.
        role: pick("role"),
        department: pick("department"),
        start_date: pick("start_date"),
        timezone: pick("timezone"),
        avatar_url: pick("avatar_url"),
        karbon_url: pick("karbon_url"),
      }

      // Drop every ALFRED row from the original list and re-insert the
      // single merged record at the original position of the base row
      // so alphabetical ordering from the SQL ORDER BY is preserved.
      const baseIndex = rows.findIndex((m) => m.id === base.id)
      merged = rows.filter((m) => !isAlfredServiceAccount(m))
      merged.splice(baseIndex === -1 ? 0 : baseIndex, 0, mergedAlfred)
    }

    return NextResponse.json({ team_members: merged })
  } catch (error) {
    console.error("Error fetching team members:", error)
    return NextResponse.json({ error: "Failed to fetch team members" }, { status: 500 })
  }
}
