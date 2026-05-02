import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  calendlyListAll,
  calendlyRequest,
  extractUuid,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"

/**
 * Returns the organization tied to a connection along with its
 * memberships and pending invitations. Requires `organizations:read`.
 *
 *  GET                           → {organization, memberships, invitations}
 *  POST   { email, teamMemberId? } → invite a user to the organization
 *                                    (requires `organizations:write`)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const sp = request.nextUrl.searchParams

    const connection = await resolveConnection(supabase, sp.get("teamMemberId"))
    if (!connection || !connection.calendly_organization_uri) {
      return NextResponse.json(
        { error: "No connection or organization URI", needsConnect: !connection },
        { status: 404 },
      )
    }

    const orgUuid = extractUuid(connection.calendly_organization_uri)
    if (!orgUuid) return NextResponse.json({ error: "Invalid org URI" }, { status: 400 })

    const [orgRes, memberships, invitations] = await Promise.all([
      calendlyRequest<{ resource: any }>(
        connection,
        supabase,
        `/organizations/${orgUuid}`,
      ).catch(() => null),
      calendlyListAll<any>(connection, supabase, "/organization_memberships", {
        query: { organization: connection.calendly_organization_uri, count: 100 },
      }).catch(() => []),
      calendlyListAll<any>(
        connection,
        supabase,
        `/organizations/${orgUuid}/invitations`,
        { query: { count: 100 } },
      ).catch(() => []),
    ])

    return NextResponse.json({
      organization: orgRes?.resource ?? null,
      memberships,
      invitations,
    })
  } catch (err: any) {
    console.error("[calendly] /organization error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to fetch organization" },
      { status: err?.status || 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { email, teamMemberId } = body
    if (!email) {
      return NextResponse.json({ error: "email required" }, { status: 400 })
    }
    const connection = await resolveConnection(supabase, teamMemberId)
    if (!connection || !connection.calendly_organization_uri) {
      return NextResponse.json({ error: "No connection" }, { status: 404 })
    }
    const orgUuid = extractUuid(connection.calendly_organization_uri)
    if (!orgUuid) return NextResponse.json({ error: "Invalid org URI" }, { status: 400 })

    const created = await calendlyRequest<{ resource: any }>(
      connection,
      supabase,
      `/organizations/${orgUuid}/invitations`,
      { method: "POST", body: { email } },
    )
    return NextResponse.json({ invitation: created?.resource ?? null })
  } catch (err: any) {
    console.error("[calendly] /organization invite error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to invite" },
      { status: err?.status || 500 },
    )
  }
}

async function resolveConnection(
  supabase: any,
  explicit: string | null,
): Promise<CalendlyConnectionRow | null> {
  let teamMemberId = explicit
  if (!teamMemberId) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data: tm } = await supabase
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .single()
    teamMemberId = tm?.id ?? null
  }
  if (!teamMemberId) return null
  const { data } = await supabase
    .from("calendly_connections")
    .select("*")
    .eq("team_member_id", teamMemberId)
    .eq("is_active", true)
    .maybeSingle()
  return (data as CalendlyConnectionRow | null) ?? null
}
