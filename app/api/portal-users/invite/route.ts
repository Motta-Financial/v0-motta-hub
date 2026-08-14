import { NextResponse, type NextRequest } from "next/server"
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getTeamMemberByAuthId } from "@/lib/team-members"
import { sendEmail, buildPasswordResetEmailHtml } from "@/lib/email"

/**
 * POST /api/portal-users/invite
 * Body: { kind: "contact" | "organization", entityId: string, email: string, fullName?: string }
 *
 * Any signed-in, active team member can invite a client to the portal for
 * one of their contact/organization records (gated the same way every other
 * `/api/clients/*` write is — by the Hub-session check in middleware.ts, not
 * an admin-only role). This uses the service-role key to create auth users
 * and mint recovery links, so unlike a plain RLS-scoped write it never runs
 * on behalf of the caller's own Postgres role.
 *
 * Idempotent: if the email already has an active `portal_users` row, this
 * re-sends the invite instead of erroring, and just adds `portal_user_access`
 * for the given entity if it isn't already granted (supports one login
 * seeing several linked contact/organization records).
 */

interface InviteBody {
  kind?: "contact" | "organization"
  entityId?: string
  email?: string
  fullName?: string | null
}

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables")
  }

  return createSupabaseAdminClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function resolveSiteUrl(request: NextRequest): string {
  const origin = request.headers.get("origin")
  if (origin) return origin.replace(/\/$/, "")
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL
  if (envUrl) {
    const normalized = envUrl.startsWith("http") ? envUrl : `https://${envUrl}`
    return normalized.replace(/\/$/, "")
  }
  return "https://hub.motta.cpa"
}

async function findExistingAuthUser(admin: ReturnType<typeof createAdminClient>, email: string) {
  const lower = email.toLowerCase()
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) return null
  return data.users.find((u) => u.email?.toLowerCase() === lower) ?? null
}

export async function POST(request: NextRequest) {
  try {
    // Baseline auth: middleware.ts already requires a logged-in, active
    // Hub session for every /api/* route. We just resolve WHO is acting,
    // for the `invited_by` audit column.
    const userSupabase = await createClient()
    const {
      data: { user },
    } = await userSupabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const actingTeamMember = await getTeamMemberByAuthId(user.id, user.email)

    const body: InviteBody = await request.json()
    const { kind, entityId, email, fullName } = body

    if (!kind || (kind !== "contact" && kind !== "organization")) {
      return NextResponse.json({ error: "kind must be 'contact' or 'organization'" }, { status: 400 })
    }
    if (!entityId) {
      return NextResponse.json({ error: "Missing entityId" }, { status: 400 })
    }
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 })
    }

    const admin = createAdminClient()

    // Confirm the entity actually exists so we don't create dangling access
    // rows for a bad id.
    const table = kind === "organization" ? "organizations" : "contacts"
    const { data: entityRow, error: entityErr } = await admin
      .from(table)
      .select("id")
      .eq("id", entityId)
      .maybeSingle()

    if (entityErr || !entityRow) {
      return NextResponse.json({ error: `${kind === "organization" ? "Organization" : "Contact"} not found` }, { status: 404 })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const displayName = fullName?.trim() || normalizedEmail.split("@")[0]

    // 1. Find-or-create the auth user.
    let authUser = await findExistingAuthUser(admin, normalizedEmail)
    if (!authUser) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: { full_name: displayName, portal_user: true },
      })
      if (createErr || !created.user) {
        return NextResponse.json(
          { error: createErr?.message || "Could not create auth user" },
          { status: 500 },
        )
      }
      authUser = created.user
    }

    // 2. Find-or-create the portal_users row for this auth user.
    const { data: existingPortalUser } = await admin
      .from("portal_users")
      .select("id, is_active, full_name")
      .eq("auth_user_id", authUser.id)
      .maybeSingle()

    let portalUserId: string
    if (existingPortalUser) {
      portalUserId = existingPortalUser.id
      // Re-activate + refresh the name if a deactivated/renamed record is
      // being re-invited.
      await admin
        .from("portal_users")
        .update({
          is_active: true,
          full_name: fullName?.trim() || existingPortalUser.full_name,
        })
        .eq("id", portalUserId)
    } else {
      const { data: inserted, error: insertErr } = await admin
        .from("portal_users")
        .insert({
          auth_user_id: authUser.id,
          email: normalizedEmail,
          full_name: displayName,
          is_active: true,
          invited_by: actingTeamMember?.id ?? null,
        })
        .select("id")
        .single()

      if (insertErr || !inserted) {
        return NextResponse.json(
          { error: insertErr?.message || "Could not create portal user" },
          { status: 500 },
        )
      }
      portalUserId = inserted.id
    }

    // 3. Grant access to this entity if not already granted.
    const accessFilter =
      kind === "organization"
        ? { organization_id: entityId, contact_id: null }
        : { contact_id: entityId, organization_id: null }

    const { data: existingAccess } = await admin
      .from("portal_user_access")
      .select("id")
      .eq("portal_user_id", portalUserId)
      .match(accessFilter)
      .maybeSingle()

    if (!existingAccess) {
      const { error: accessErr } = await admin.from("portal_user_access").insert({
        portal_user_id: portalUserId,
        ...accessFilter,
      })
      if (accessErr) {
        return NextResponse.json({ error: accessErr.message }, { status: 500 })
      }
    }

    // 4. Generate an invite link and email it via Resend. Same shape as the
    //    staff invite flow, but pointed at the client-portal's own
    //    set-password page (not the Hub's) since these are different
    //    audiences that happen to share the same auth.users pool.
    const siteUrl = resolveSiteUrl(request)
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: {
        redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/client-portal/set-password")}`,
      },
    })

    if (linkErr || !linkData?.properties?.hashed_token) {
      return NextResponse.json(
        { error: linkErr?.message || "Could not generate invite link" },
        { status: 500 },
      )
    }

    const actionUrl = new URL(`${siteUrl}/auth/confirm`)
    actionUrl.searchParams.set("token_hash", linkData.properties.hashed_token)
    actionUrl.searchParams.set("type", "recovery")
    actionUrl.searchParams.set("next", "/client-portal/set-password")

    const html = buildPasswordResetEmailHtml({
      recipientName: displayName,
      actionUrl: actionUrl.toString(),
      mode: "invite",
      expiresInHours: 24,
      audience: "portal",
    })

    const sendResult = await sendEmail({
      to: normalizedEmail,
      subject: "You're invited to the Motta Financial client portal",
      html,
    })

    if (!sendResult.success) {
      return NextResponse.json(
        { error: `Portal access granted but invite email failed to send: ${sendResult.error}` },
        { status: 502 },
      )
    }

    return NextResponse.json({
      ok: true,
      portalUserId,
      email: normalizedEmail,
      fullName: displayName,
    })
  } catch (error) {
    console.error("[v0] /api/portal-users/invite error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send invite" },
      { status: 500 },
    )
  }
}
