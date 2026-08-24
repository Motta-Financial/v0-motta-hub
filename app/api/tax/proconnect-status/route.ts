import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { buildExportPath, getPhase1Hosts } from "@/lib/proconnect/data"
import { getTokenStatus } from "@/lib/proconnect/oauth"

export const dynamic = "force-dynamic"

/**
 * GET /api/tax/proconnect-status
 *
 * Returns the current ProConnect connection state used by the
 * /tax/settings Connection Status card. It is intentionally
 * lightweight — no Intuit API calls, just a snapshot of:
 *
 *  - whether we have a stored access/refresh token
 *  - when it was last refreshed and when it expires
 *  - the realm id (so the user knows which firm is connected)
 *  - last successful client/engagement sync timestamps
 *  - last 5 webhook events (status + entity)
 *  - `deployment`: config drift between `main` and the RUNNING build
 *
 * On `deployment`. Four separate incidents have been traced to which
 * deployment is serving rather than to code: a promoted preview reverted the
 * Export path on 2026-08-15 and 403'd on a live client call; a second
 * promoted branch served production from 2026-08-21; PROCONNECT_TOKEN_KEY
 * existed for a full day before any running build carried it (env vars bake
 * in at build time); and the webhook verifier token's presence could only be
 * confirmed by reading the Vercel dashboard by hand. Each took an unrelated
 * investigation to notice. These fields make the running build state
 * answerable in the UI.
 *
 * Booleans and counts ONLY — never a token, verifier string, or allowlisted
 * return id. Staff-only via the normal middleware session gate; do not add a
 * middleware exemption for this route.
 */

/**
 * Report tables that a merged migration should have created but hasn't.
 * `scripts/*.sql` are applied by hand, so a merged feature can be live in
 * code and non-functional in the database — create-tax-return fails closed
 * until scripts/401 is run, which reads as an Intuit error to whoever hits
 * it first.
 */
type TableProbe = {
  from: (table: string) => {
    select: (
      columns: string,
      opts: { count: "exact"; head: true }
    ) => PromiseLike<{ error: { code?: string } | null }>
  }
}

async function findMissingTables(
  supabase: TableProbe,
  tables: { table: string; migration: string }[]
): Promise<{ table: string; migration: string }[]> {
  const checks = await Promise.all(
    tables.map(async (t) => {
      const { error } = await supabase.from(t.table).select("*", { count: "exact", head: true })
      // PGRST205 = "Could not find the table ... in the schema cache".
      // Any other error (RLS, transient) is NOT evidence of absence.
      return error?.code === "PGRST205" ? t : null
    })
  )
  return checks.filter((t): t is { table: string; migration: string } => t !== null)
}
export async function GET() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. OAuth singleton
  const { data: token } = await supabase
    .from("proconnect_oauth_tokens")
    .select(
      "realm_id, expires_at, updated_at, created_at, scope, token_type, connected_by_team_member_id, last_refresh_error"
    )
    .eq("is_singleton", true)
    .maybeSingle()

  const connected = !!token
  const now = Date.now()
  const expiresAt = token?.expires_at ? new Date(token.expires_at).getTime() : null
  const accessExpired = expiresAt !== null && expiresAt <= now
  // A non-null refresh error means the stored refresh token stopped working,
  // so an admin must re-consent. Surfaced as "Reconnect required" in the UI.
  const reconnectRequired = !!token?.last_refresh_error

  // Resolve who connected the firm (admin name shown on the settings card).
  let connectedBy: { name: string | null } | null = null
  if (token?.connected_by_team_member_id) {
    const { data: tm } = await supabase
      .from("team_members")
      .select("full_name")
      .eq("id", token.connected_by_team_member_id)
      .maybeSingle()
    connectedBy = { name: tm?.full_name ?? null }
  }

  // 2. Last sync watermarks
  const [{ data: clientWatermark }, { data: engagementWatermark }] = await Promise.all([
    supabase
      .from("proconnect_clients")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1),
    supabase
      .from("proconnect_engagements")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1),
  ])

  // 3. Recent webhook events (latest 5)
  const { data: recentWebhooks } = await supabase
    .from("proconnect_webhook_events")
    .select("id, received_at, event_type, entity_id, operation, processing_status, processing_error")
    .order("received_at", { ascending: false })
    .limit(5)

  // 4. Counts
  const [{ count: clientCount }, { count: engagementCount }] = await Promise.all([
    supabase.from("proconnect_clients").select("id", { count: "exact", head: true }),
    supabase.from("proconnect_engagements").select("id", { count: "exact", head: true }),
  ])

  // 5. Phase 1 return-data export health. Exports run on every TaxReturn
  // webhook; failures are recorded on the event row (processing_error
  // starts with "export failed:"). This surfaced the fact that exports
  // had NEVER succeeded (403 scope_missing — app not allow-listed for
  // the data endpoints) after months of silent soft-fails.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [
    { data: lastSnapshot },
    { count: snapshotCount },
    { count: exportFailures7d },
    { data: lastExportFailure },
  ] = await Promise.all([
    supabase
      .from("proconnect_return_snapshots")
      .select("exported_at")
      .order("exported_at", { ascending: false })
      .limit(1),
    supabase.from("proconnect_return_snapshots").select("id", { count: "exact", head: true }),
    supabase
      .from("proconnect_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "TaxReturn")
      .eq("processing_status", "failed")
      .gte("received_at", sevenDaysAgo),
    supabase
      .from("proconnect_webhook_events")
      .select("processing_error, received_at")
      .eq("event_type", "TaxReturn")
      .eq("processing_status", "failed")
      .order("received_at", { ascending: false })
      .limit(1),
  ])

  const lastExportError = lastExportFailure?.[0]?.processing_error ?? null
  const scopeBlocked =
    !!lastExportError &&
    (lastExportError.includes("scope_missing") || lastExportError.includes("access_denied"))
  const phase1Status: "ok" | "blocked" | "inactive" =
    scopeBlocked && (snapshotCount ?? 0) === 0
      ? "blocked"
      : (snapshotCount ?? 0) > 0
        ? "ok"
        : "inactive"

  // 6. Deployment & configuration drift. Local only — no Intuit calls.
  const hosts = getPhase1Hosts()
  // Assert the path this module ACTUALLY builds, not a copy of it.
  const exportPath = buildExportPath("CLIENT", "RETURN")
  const tokenStatus = await getTokenStatus().catch(() => null)
  const missingTables = await findMissingTables(supabase, [
    { table: "proconnect_tax_return_creation_jobs", migration: "scripts/401" },
  ])

  const gitRef = process.env.VERCEL_GIT_COMMIT_REF ?? null
  const vercelEnv = process.env.VERCEL_ENV ?? null

  const deployment = {
    gitRef,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    vercelEnv,
    /**
     * The highest-value field here. Production serving anything but `main`
     * means a promoted preview is shadowing merged code — silently, and
     * indefinitely, until someone happens to look.
     */
    servingNonMain: vercelEnv === "production" && gitRef !== null && gitRef !== "main",
    exportPathHasOiiClient: exportPath.includes("/oii-client/"),
    importHostIsSeparate: hosts.importBase !== hosts.exportBase,
    tokenEncryption: {
      configured: tokenStatus?.encryptionConfigured ?? null,
      atRestEncrypted: tokenStatus?.atRestEncrypted ?? null,
    },
    webhookVerifierConfigured: !!process.env.PROCONNECT_WEBHOOK_VERIFIER_TOKEN,
    writeAllowlistCount: (process.env.PROCONNECT_WRITE_ALLOWED_RETURN_IDS ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean).length,
    missingTables,
  }

  return NextResponse.json({
    deployment,
    phase1: {
      status: phase1Status,
      snapshotCount: snapshotCount ?? 0,
      lastSuccessfulExport: lastSnapshot?.[0]?.exported_at ?? null,
      exportFailures7d: exportFailures7d ?? 0,
      lastExportError,
      lastExportErrorAt: lastExportFailure?.[0]?.received_at ?? null,
    },
    connected,
    realmId: token?.realm_id ?? null,
    scope: token?.scope ?? null,
    tokenType: token?.token_type ?? null,
    accessExpiresAt: token?.expires_at ?? null,
    accessExpired,
    lastTokenRefresh: token?.updated_at ?? null,
    connectedSince: token?.created_at ?? null,
    connectedBy,
    reconnectRequired,
    lastRefreshError: token?.last_refresh_error ?? null,
    lastClientSync: clientWatermark?.[0]?.synced_at ?? null,
    lastEngagementSync: engagementWatermark?.[0]?.synced_at ?? null,
    clientCount: clientCount ?? 0,
    engagementCount: engagementCount ?? 0,
    recentWebhooks: recentWebhooks ?? [],
  })
}
