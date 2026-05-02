import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  CALENDLY_REQUESTED_SCOPES,
  calendlyRequest,
  fetchMe,
  getAppBaseUrl,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"

/**
 * Connection diagnostics: for each active connection, returns the
 * results of probing each major Calendly capability so the UI can
 * flag missing scopes or token problems with a clear message.
 *
 * Returns up-to-date info per connection including:
 *   - granted vs. requested scopes
 *   - whether the access_token currently works
 *   - which webhook subscriptions exist
 *   - last sync metadata
 */
export async function GET() {
  const supabase = await createClient()

  const { data: connections, error } = await supabase
    .from("calendly_connections")
    .select(`*, team_members ( id, full_name, email, avatar_url, title )`)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const callbackUrl = `${getAppBaseUrl()}/api/calendly/webhook`
  const out = []

  for (const c of connections || []) {
    const conn = c as CalendlyConnectionRow & { team_members?: any }
    const grantedScopes = (conn.scope || "").split(/[\s,]+/).filter(Boolean)
    const missingScopes = CALENDLY_REQUESTED_SCOPES.filter((s) => !grantedScopes.includes(s))

    let tokenOk = false
    let webhookCount = 0
    let webhookForOurUrl = false
    let probeError: string | null = null

    try {
      const me = await fetchMe(conn, supabase)
      tokenOk = !!me

      if (me) {
        // Probe webhooks under both org + user scope.
        const subs = await calendlyRequest<{ collection: any[] }>(
          conn,
          supabase,
          "/webhook_subscriptions",
          {
            query: {
              organization: me.current_organization,
              user: me.uri,
              scope: "user",
              count: 100,
            },
          },
        ).catch(() => null)
        const list = subs?.collection || []
        webhookCount = list.length
        webhookForOurUrl = list.some(
          (w) => w.callback_url === callbackUrl && w.state === "active",
        )
      }
    } catch (err: any) {
      probeError = err?.message || String(err)
    }

    out.push({
      id: conn.id,
      teamMember: conn.team_members,
      calendlyUser: {
        name: conn.calendly_user_name,
        email: conn.calendly_user_email,
        avatar: conn.calendly_user_avatar,
        timezone: conn.calendly_user_timezone,
        uri: conn.calendly_user_uri,
        organizationUri: conn.calendly_organization_uri,
      },
      tokens: {
        expiresAt: conn.expires_at,
        tokenOk,
        probeError,
        grantedScopes,
        missingScopes,
        needsReauth: missingScopes.length > 0 || !tokenOk,
      },
      webhooks: {
        callbackUrl,
        totalSubscriptions: webhookCount,
        configuredForUs: webhookForOurUrl,
      },
      sync: {
        enabled: conn.sync_enabled,
        active: conn.is_active,
        lastSyncedAt: conn.last_synced_at,
      },
    })
  }

  return NextResponse.json({
    connections: out,
    requestedScopes: CALENDLY_REQUESTED_SCOPES,
    appCallbackUrl: callbackUrl,
  })
}
