/**
 * /api/zoom/contacts
 *
 * GET  — list synced Zoom Team Chat contacts (zoom_contacts) with their
 *        Hub contact/organization links. Any signed-in team member.
 *        Query params: q (name/email search), type (external|company),
 *        linked (true|false), limit, offset.
 *
 * POST — trigger the contacts sync now (walks every active connection's
 *        /chat/users/me/contacts directory). Admin session or
 *        CRON_SECRET bearer, mirroring the other Zoom sync triggers.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { syncZoomContacts } from "@/lib/zoom/sync-contacts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const q = (req.nextUrl.searchParams.get("q") || "").trim()
  const type = (req.nextUrl.searchParams.get("type") || "").trim()
  const linked = req.nextUrl.searchParams.get("linked")
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), 200)
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0)

  const admin = createAdminClient()

  let query = admin
    .from("zoom_contacts")
    .select(
      `id, contact_type, zoom_contact_id, email, first_name, last_name, display_name,
       pronoun, phone_numbers, department, job_title, location,
       hub_contact_id, hub_organization_id, match_method, linked_at, synced_at,
       owner_team_member_id,
       contacts:hub_contact_id(id, full_name, is_prospect),
       organizations:hub_organization_id(id, name),
       team_members:owner_team_member_id(id, full_name)`,
      { count: "exact" },
    )
    .order("display_name", { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (type === "external" || type === "company") query = query.eq("contact_type", type)
  if (linked === "true") query = query.not("hub_contact_id", "is", null)
  if (linked === "false") query = query.is("hub_contact_id", null).is("hub_organization_id", null)
  if (q) {
    // Escape PostgREST .or() specials so a search string can't break the
    // filter expression.
    const safe = q.replace(/[,()]/g, " ").trim()
    if (safe) {
      query = query.or(
        `display_name.ilike.%${safe}%,email.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`,
      )
    }
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ contacts: data ?? [], total: count ?? 0, limit, offset })
}

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!hasCronSecret(req)) {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response
  }

  let zoomConnectionId: string | null = null
  try {
    const body = (await req.json()) as { zoomConnectionId?: string }
    if (typeof body.zoomConnectionId === "string") zoomConnectionId = body.zoomConnectionId
  } catch {
    // empty body → sync every connection
  }

  try {
    const supabase = createAdminClient()
    const result = await syncZoomContacts({ supabase, zoomConnectionId })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[v0] [Zoom Contacts] sync failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
