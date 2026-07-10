/**
 * ProConnect Nightly Sync Cron
 *
 * Runs the bulk sync inline on Vercel (maxDuration 300s). The previous
 * implementation proxied to a Supabase Edge Function named
 * `proconnect-sync` that was never deployed, so the nightly sync 404'd
 * every day. The bulk strategy (one /v1/clients call + one
 * /v2/engagements call per tax year + one custom-status call) is ~8
 * ProConnect API calls total, which completes in well under a minute —
 * the original reason for the Edge Function (per-client fan-out
 * timeouts) no longer applies.
 *
 * Schedule: Nightly (configured in vercel.json)
 *
 * Environment variables:
 * - CRON_SECRET: Vercel cron secret for authorization
 * - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL): Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: service-role key
 * - RESEND_API_KEY / RESEND_FROM_EMAIL: failure alerts
 */

import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { createClient } from "@supabase/supabase-js"
import { runBulkSync } from "@/lib/proconnect/sync"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const CRON_SECRET = process.env.CRON_SECRET
const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@motta.co"

// Alert after this many consecutive failures
const FAILURE_THRESHOLD = 3

// Who to alert
const ALERT_RECIPIENTS = ["team@motta.co"]

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

/**
 * Get consecutive failure count from sync logs
 */
async function getConsecutiveFailures(): Promise<number> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("status")
    .order("started_at", { ascending: false })
    .limit(10)

  if (error || !data) return 0

  let count = 0
  for (const log of data) {
    if (log.status === "failed") {
      count++
    } else {
      break
    }
  }
  return count
}

async function wasAlertSent(): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("alert_sent_at")
    .order("started_at", { ascending: false })
    .limit(FAILURE_THRESHOLD)

  if (error || !data) return false
  return data.some((log) => log.alert_sent_at != null)
}

async function markAlertSent(syncLogId: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase
    .from("proconnect_sync_logs")
    .update({
      alert_sent_at: new Date().toISOString(),
      consecutive_failure_count: await getConsecutiveFailures(),
      is_consecutive_failure: true,
    })
    .eq("id", syncLogId)
}

async function sendFailureAlert(
  syncLogId: string,
  consecutiveFailures: number,
  errors: string[]
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("[Cron] No RESEND_API_KEY configured, skipping alert")
    return false
  }

  const resend = new Resend(RESEND_API_KEY)
  const errorSummary = errors.slice(0, 10).join("\n- ")

  try {
    await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: ALERT_RECIPIENTS,
      subject: `[Motta Hub] ProConnect Sync Failed ${consecutiveFailures}x`,
      html: `
        <h2>ProConnect Sync Failure Alert</h2>
        <p>The ProConnect sync has failed <strong>${consecutiveFailures} times in a row</strong>.</p>
        <h3>Details</h3>
        <ul>
          <li><strong>Sync Log ID:</strong> ${syncLogId}</li>
          <li><strong>Consecutive Failures:</strong> ${consecutiveFailures}</li>
          <li><strong>Time:</strong> ${new Date().toISOString()}</li>
        </ul>
        <h3>Recent Errors</h3>
        <pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto;">- ${errorSummary || "No specific errors captured"}</pre>
        <h3>Next Steps</h3>
        <ol>
          <li>Check the Vercel function logs for /api/cron/proconnect-sync</li>
          <li>Verify ProConnect OAuth tokens are valid (/tax/settings)</li>
          <li>Verify ProConnect API is accessible</li>
          <li>Manual sync: POST to /api/cron/proconnect-sync</li>
        </ol>
      `,
    })

    console.log("[Cron] Failure alert sent to:", ALERT_RECIPIENTS.join(", "))
    return true
  } catch (err) {
    console.error("[Cron] Failed to send alert:", err)
    return false
  }
}

async function runSync(syncType: "full" | "manual") {
  const result = await runBulkSync(syncType)

  console.log("[Cron] Bulk sync complete:", {
    success: result.success,
    clients: result.clientsSynced,
    engagements: result.engagementsSynced,
    customStatuses: result.customStatusesSynced,
    errors: result.errors.length,
    duration: `${result.duration}ms`,
  })

  // Check if we need to send a failure alert
  if (!result.success && result.syncLogId) {
    const consecutiveFailures = await getConsecutiveFailures()

    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      const alreadySent = await wasAlertSent()

      if (!alreadySent) {
        const sent = await sendFailureAlert(
          result.syncLogId,
          consecutiveFailures,
          result.errors
        )
        if (sent) {
          await markAlertSent(result.syncLogId)
        }
      }
    }
  }

  return result
}

function isAuthorized(request: NextRequest): boolean {
  // Vercel cron invocations carry the x-vercel-cron header; manual
  // invocations must present the CRON_SECRET bearer token.
  if (request.headers.get("x-vercel-cron")) return true
  const authHeader = request.headers.get("authorization")
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return true
  return !CRON_SECRET
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[Cron] Starting nightly ProConnect bulk sync...")

  try {
    const result = await runSync("full")

    return NextResponse.json({
      success: result.success,
      syncLogId: result.syncLogId,
      clientsSynced: result.clientsSynced,
      engagementsSynced: result.engagementsSynced,
      customStatusesSynced: result.customStatusesSynced,
      errorCount: result.errors.length,
      duration: result.duration,
    })
  } catch (err) {
    console.error("[Cron] Fatal error running bulk sync:", err)

    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

// Allow POST for manual triggers
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[Cron] Manual ProConnect bulk sync triggered...")

  try {
    const result = await runSync("manual")

    return NextResponse.json({
      success: result.success,
      syncLogId: result.syncLogId,
      clientsSynced: result.clientsSynced,
      engagementsSynced: result.engagementsSynced,
      customStatusesSynced: result.customStatusesSynced,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 20),
      duration: result.duration,
    })
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
