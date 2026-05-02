import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyListAll, type CalendlyConnectionRow } from "@/lib/calendly-api"

/**
 * Lists routing forms (and optionally their submissions) for the
 * organization tied to a connection. Requires the `routing_forms:read`
 * scope on the underlying token.
 *
 * Query params:
 *  - teamMemberId         (optional; defaults to caller)
 *  - includeSubmissions   "true" to also fetch each form's submissions
 *  - formId               restrict to a single form
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const sp = request.nextUrl.searchParams

    const connection = await resolveConnection(supabase, sp.get("teamMemberId"))
    if (!connection) {
      return NextResponse.json(
        { error: "No active Calendly connection", needsConnect: true },
        { status: 404 },
      )
    }
    if (!connection.calendly_organization_uri) {
      return NextResponse.json({ error: "No organization URI" }, { status: 400 })
    }

    const formId = sp.get("formId")
    const includeSubmissions = sp.get("includeSubmissions") === "true"

    const forms = formId
      ? [
          await (
            await import("@/lib/calendly-api")
          ).calendlyRequest<{ resource: any }>(connection, supabase, `/routing_forms/${formId}`),
        ]
            .map((r) => r?.resource)
            .filter(Boolean)
      : await calendlyListAll<any>(connection, supabase, "/routing_forms", {
          query: { organization: connection.calendly_organization_uri, count: 100 },
        })

    if (!includeSubmissions) {
      return NextResponse.json({ forms })
    }

    const enriched = await Promise.all(
      forms.map(async (form: any) => {
        const submissions = await calendlyListAll<any>(
          connection,
          supabase,
          "/routing_form_submissions",
          { query: { form: form.uri, count: 100 } },
        ).catch(() => [])
        return { ...form, submissions }
      }),
    )
    return NextResponse.json({ forms: enriched })
  } catch (err: any) {
    console.error("[calendly] /routing-forms error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to fetch routing forms" },
      { status: err?.status || 500 },
    )
  }
}

async function resolveConnection(supabase: any, explicitTeamMember: string | null) {
  let teamMemberId = explicitTeamMember
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
