/**
 * GET /api/supabase/clients
 *
 * Returns the full set of contacts + organizations as a flat, alphabetically
 * sorted "client picker" list, alongside open work items. Used by debrief
 * tagging dialogs and other places that need to attach an entity to a record.
 *
 * Pulls directly from the Supabase `contacts` and `organizations` tables, so
 * the list is always in sync with what the Clients page displays.
 *
 * Query params:
 *  - search: case-insensitive substring filter applied to contact and
 *            organization names + email
 *  - limit:  per-collection cap (default 5000, more than enough for Motta's
 *            current ~1.2k contacts and ~650 organizations). Fetched in
 *            1,000-row pages because PostgREST caps any single response at
 *            1,000 rows regardless of .limit().
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

const PAGE_SIZE = 1000

export async function GET(request: Request) {
  const supabase = createAdminClient()

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")?.trim() || ""
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "5000"), 10_000)

    // Contacts
    const buildContactsQuery = (from: number, to: number) => {
      let q = supabase
        .from("contacts")
        .select("id, full_name, primary_email")
        .eq("status", "Active")
        .order("full_name", { ascending: true })
        .range(from, to)

      if (search) {
        q = q.or(
          `full_name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,preferred_name.ilike.%${search}%,primary_email.ilike.%${search}%`,
        )
      }
      return q
    }

    // Organizations
    const buildOrgsQuery = (from: number, to: number) => {
      let q = supabase
        .from("organizations")
        .select("id, name, full_name, primary_email")
        .order("name", { ascending: true })
        .range(from, to)

      if (search) {
        q = q.or(
          `name.ilike.%${search}%,full_name.ilike.%${search}%,trading_name.ilike.%${search}%,legal_name.ilike.%${search}%,primary_email.ilike.%${search}%`,
        )
      }
      return q
    }

    // Page through in 1,000-row chunks until the requested limit (or a short
    // page) is reached — same pattern as /api/supabase/contacts.
    const fetchPaged = async (buildQuery: (from: number, to: number) => any) => {
      const collected: any[] = []
      let from = 0
      while (collected.length < limit) {
        const to = Math.min(from + PAGE_SIZE - 1, limit - 1)
        const { data, error } = await buildQuery(from, to)
        if (error) return { data: collected, error }
        if (!data || data.length === 0) break
        collected.push(...data)
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
      return { data: collected, error: null }
    }

    // Open work items (used by the same picker)
    const workItemsQuery = supabase
      .from("work_items")
      .select("id, title, karbon_work_item_key")
      .not("status", "eq", "Completed")
      .not("status", "eq", "Cancelled")
      .order("title")
      .limit(500)

    const [contactsRes, orgsRes, workItemsRes] = await Promise.all([
      fetchPaged(buildContactsQuery),
      fetchPaged(buildOrgsQuery),
      workItemsQuery,
    ])

    if (contactsRes.error) {
      console.error("[v0] /api/supabase/clients contacts error:", contactsRes.error)
    }
    if (orgsRes.error) {
      console.error("[v0] /api/supabase/clients orgs error:", orgsRes.error)
    }
    if (workItemsRes.error) {
      console.error("[v0] /api/supabase/clients work_items error:", workItemsRes.error)
    }

    const contactItems =
      contactsRes.data?.map((c) => ({
        id: c.id,
        name: c.full_name?.trim() || c.primary_email || "Unnamed Contact",
        email: c.primary_email,
        type: "contact" as const,
      })) || []

    const orgItems =
      orgsRes.data?.map((o) => ({
        id: o.id,
        name: o.name?.trim() || o.full_name?.trim() || o.primary_email || "Unnamed Organization",
        email: o.primary_email,
        type: "organization" as const,
      })) || []

    const clients = [...contactItems, ...orgItems].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )

    return NextResponse.json({
      clients,
      workItems: workItemsRes.data || [],
      total: clients.length,
    })
  } catch (error) {
    console.error("[v0] /api/supabase/clients error:", error)
    return NextResponse.json({ error: "Failed to fetch clients and work items" }, { status: 500 })
  }
}
