/**
 * ProConnect Nightly Sync Cron
 *
 * Runs a full sync of clients, engagements, and custom statuses.
 * Sends an email alert via Resend after 3 consecutive failures.
 *
 * Schedule: Nightly (configured in vercel.json)
 * Endpoint: /api/cron/proconnect-sync
 *
 * Environment variables:
 * - CRON_SECRET: Vercel cron secret for authorization
 * - RESEND_API_KEY: For failure alerts
 * - RESEND_FROM_EMAIL: Sender email for alerts
 */

import { NextRequest, NextResponse } from "next/server"
import { runFullSync, getSyncStats } from "@/lib/proconnect/sync"
import { Resend } from "resend"
import { createClient } from "@supabase/supabase-js"

const CRON_SECRET = process.env.CRON_SECRET
const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@motta.co"
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Alert after this many consecutive failures
const FAILURE_THRESHOLD = 3

// Who to alert
const ALERT_RECIPIENTS = ["team@motta.co"]

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
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

/**
 * Check if alert was already sent for current failure streak
 */
async function wasAlertSent(): Promise<boolean> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("alert_sent_at")
    .order("started_at", { ascending: false })
    .limit(FAILURE_THRESHOLD)

  if (error || !data) return false

  // If any of the recent failures had an alert sent, don't send another
  return data.some((log) => log.alert_sent_at != null)
}

/**
 * Mark alert as sent for the current sync log
 */
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

/**
 * Send failure alert email via Resend
 */
async function sendFailureAlert(
  syncLogId: string,
  consecutiveFailures: number,
  errors: string[]
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("[ProConnect Cron] No RESEND_API_KEY configured, skipping alert")
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
          <li>Check the ProConnect OAuth tokens (may need refresh)</li>
          <li>Verify ProConnect API is accessible</li>
          <li>Review the proconnect_sync_logs table for details</li>
          <li>Manual sync: POST to /api/proconnect/sync</li>
        </ol>
        
        <p style="color: #666; font-size: 12px;">
          This alert is sent after ${FAILURE_THRESHOLD} consecutive failures. 
          You won't receive another until a successful sync occurs.
        </p>
      `,
    })

    console.log("[ProConnect Cron] Failure alert sent to:", ALERT_RECIPIENTS.join(", "))
    return true
  } catch (err) {
    console.error("[ProConnect Cron] Failed to send alert:", err)
    return false
  }
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization")
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[ProConnect Cron] Starting nightly sync...")

  try {
    const result = await runFullSync("full")

    // Log results
    console.log("[ProConnect Cron] Sync completed:", {
      success: result.success,
      clients: result.clientsSynced,
      engagements: result.engagementsSynced,
      customStatuses: result.customStatusesSynced,
      errors: result.errors.length,
      duration: `${result.duration}ms`,
    })

    // Check if we need to send a failure alert
    if (!result.success) {
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
    console.error("[ProConnect Cron] Fatal error:", err)

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
  // For manual triggers, still verify cron secret if present
  const authHeader = request.headers.get("authorization")
  if (CRON_SECRET && authHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[ProConnect Cron] Manual sync triggered...")

  const result = await runFullSync("manual")

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
}
