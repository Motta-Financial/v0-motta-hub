/**
 * ProConnect Nightly Sync Cron - Edge Function Proxy
 *
 * This Vercel cron is now a thin wrapper that invokes the Supabase Edge
 * Function (which does the actual sync work). This was migrated from the
 * Vercel-only implementation because of repeated 60-second timeouts.
 *
 * The Edge Function lives at: supabase/functions/proconnect-sync/index.ts
 * URL: https://<project-ref>.supabase.co/functions/v1/proconnect-sync
 *
 * Schedule: Nightly (configured in vercel.json)
 *
 * Environment variables:
 * - CRON_SECRET: Vercel cron secret for authorization
 * - SUPABASE_URL: Used to build the Edge Function URL
 * - SUPABASE_SERVICE_ROLE_KEY: Used to authenticate to the Edge Function
 * - RESEND_API_KEY: For failure alerts
 * - RESEND_FROM_EMAIL: Sender email for alerts
 */

import { NextRequest, NextResponse } from "next/server"
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

// Build the Edge Function URL from SUPABASE_URL
// e.g. https://gylupzxitoebhqjnvzuw.supabase.co/functions/v1/proconnect-sync
function getEdgeFunctionUrl(): string {
  return `${SUPABASE_URL}/functions/v1/proconnect-sync`
}

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

/**
 * Invoke the Supabase Edge Function and wait for the response.
 * The Edge Function has a 400s limit and runs the full sync to completion.
 */
async function invokeEdgeFunction(syncType: string): Promise<{
  success: boolean
  syncLogId: string | null
  clientsSynced: number
  engagementsSynced: number
  customStatusesSynced: number
  errorCount: number
  errors: string[]
  duration: number
}> {
  const url = getEdgeFunctionUrl()

  console.log(`[Cron] Invoking Edge Function: ${url}`)

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ syncType }),
  })

  const result = await response.json()

  if (!response.ok) {
    throw new Error(`Edge Function failed: ${response.status} - ${JSON.stringify(result)}`)
  }

  return {
    success: result.success || false,
    syncLogId: result.syncLogId || null,
    clientsSynced: result.clientsSynced || 0,
    engagementsSynced: result.engagementsSynced || 0,
    customStatusesSynced: result.customStatusesSynced || 0,
    errorCount: result.errorCount || 0,
    errors: result.errors || [],
    duration: result.duration || 0,
  }
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
          <li>Check the Supabase Edge Function logs in the dashboard</li>
          <li>Verify ProConnect OAuth tokens are valid</li>
          <li>Verify ProConnect API is accessible</li>
          <li>Manual sync: POST to /api/proconnect/sync</li>
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

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization")
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[Cron] Starting nightly sync via Edge Function...")

  try {
    const result = await invokeEdgeFunction("full")

    console.log("[Cron] Edge Function complete:", {
      success: result.success,
      clients: result.clientsSynced,
      engagements: result.engagementsSynced,
      customStatuses: result.customStatusesSynced,
      errors: result.errorCount,
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

    return NextResponse.json({
      success: result.success,
      syncLogId: result.syncLogId,
      clientsSynced: result.clientsSynced,
      engagementsSynced: result.engagementsSynced,
      customStatusesSynced: result.customStatusesSynced,
      errorCount: result.errorCount,
      duration: result.duration,
    })
  } catch (err) {
    console.error("[Cron] Fatal error invoking Edge Function:", err)

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
  const authHeader = request.headers.get("authorization")
  if (CRON_SECRET && authHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[Cron] Manual sync triggered via Edge Function...")

  try {
    const result = await invokeEdgeFunction("manual")

    return NextResponse.json({
      success: result.success,
      syncLogId: result.syncLogId,
      clientsSynced: result.clientsSynced,
      engagementsSynced: result.engagementsSynced,
      customStatusesSynced: result.customStatusesSynced,
      errorCount: result.errorCount,
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
