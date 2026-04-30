/**
 * Karbon sync cron — runs every 15 min (see vercel.json).
 *
 * In the new live-sync architecture this cron is no longer the primary
 * data path (webhooks are). It now performs three jobs in order:
 *
 *   1. REPLAY  — drain `karbon_webhook_events` rows stuck in pending/failed.
 *                Karbon retries up to 10 times then gives up; this catches
 *                events that failed to process for transient reasons
 *                (DB blip, deploy in progress, etc.).
 *
 *   2. WATCHDOG — verify each `karbon_webhook_subscriptions` row is still
 *                 active in Karbon. After 10 consecutive delivery failures
 *                 Karbon cancels the subscription, so we re-create any that
 *                 are missing. Also flags subs that have gone unusually
 *                 quiet.
 *
 *   3. DRIFT   — once per N runs (or when a sub was just re-created), kick
 *                off an incremental `/api/karbon/sync` to reconcile any
 *                changes we missed during webhook downtime.
 */
import { NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { processWebhookEvent, type WebhookEventRow } from "@/lib/karbon/process-webhook-event"
import { getKarbonCredentials } from "@/lib/karbon-api"
import {
  KARBON_WEBHOOK_TYPES,
  resolveWebhookTargetUrl,
  type KarbonWebhookType,
} from "@/lib/karbon/webhook-url"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300 // up to 5 min — replay can take a while

const KARBON_BASE = "https://api.karbonhq.com/v3"

// Watchdog thresholds
const SUB_STALE_HOURS = 24 // warn if a sub hasn't received any event in 24h
const REPLAY_BATCH_SIZE = 50
const REPLAY_MAX_ATTEMPTS = 5

// Drift: trigger an incremental sync every Nth cron run, OR when a sub was
// just re-created (in which case events may have been lost while it was gone).
// 15-min schedule × 16 = ~4 hours.
const DRIFT_RUN_INTERVAL = 16

interface CronResult {
  ok: boolean
  startedAt: string
  durationMs: number
  replay: { attempted: number; succeeded: number; failed: number; skipped: number }
  watchdog: {
    checked: number
    healthy: number
    stale: number
    recreated: number
    failed: number
    details: Array<{ webhookType: string; action: string; reason?: string }>
  }
  drift: { triggered: boolean; reason?: string; result?: any }
}

function authorizeRequest(request: Request): boolean {
  const auth = request.headers.get("authorization")
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true
  // Vercel Cron sets this header
  if (request.headers.get("x-vercel-cron")) return true
  // In dev / when CRON_SECRET unset, allow
  if (!process.env.CRON_SECRET || process.env.NODE_ENV !== "production") return true
  return false
}

function resolveBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return "http://localhost:3000"
}

// ---------------------------------------------------------------------------
// 1. REPLAY: process backlogged webhook events
// ---------------------------------------------------------------------------
async function replayPendingEvents(db: NonNullable<ReturnType<typeof tryCreateAdminClient>>) {
  const stats = { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }

  const { data: rows, error } = await db
    .from("karbon_webhook_events")
    .select(
      "id, resource_type, action_type, resource_perma_key, parent_entity_key, client_key, client_type, retry_count",
    )
    .in("processing_status", ["pending", "failed"])
    .lt("retry_count", REPLAY_MAX_ATTEMPTS)
    .order("received_at", { ascending: true })
    .limit(REPLAY_BATCH_SIZE)

  if (error) {
    console.error("[karbon-cron] replay query failed:", error.message)
    return stats
  }
  if (!rows || rows.length === 0) return stats

  for (const row of rows as WebhookEventRow[]) {
    stats.attempted++
    try {
      const result = await processWebhookEvent(row)
      if (result.ok && (result.action === "upserted" || result.action === "soft-deleted" || result.action === "no-op")) {
        stats.succeeded++
      } else if (result.ok && result.action === "skipped") {
        stats.skipped++
      } else {
        stats.failed++
      }
    } catch (e) {
      stats.failed++
      console.error("[karbon-cron] replay error for event", row.id, (e as Error).message)
    }
  }

  return stats
}

// ---------------------------------------------------------------------------
// 2. WATCHDOG: ensure all 8 webhook types have an active subscription
// ---------------------------------------------------------------------------
async function runWatchdog(db: NonNullable<ReturnType<typeof tryCreateAdminClient>>) {
  const stats: CronResult["watchdog"] = {
    checked: 0,
    healthy: 0,
    stale: 0,
    recreated: 0,
    failed: 0,
    details: [],
  }

  const creds = getKarbonCredentials()
  if (!creds) {
    stats.details.push({ webhookType: "*", action: "skipped", reason: "no Karbon credentials" })
    return stats
  }

  let targetUrl: string
  try {
    targetUrl = resolveWebhookTargetUrl()
  } catch (e) {
    stats.details.push({ webhookType: "*", action: "skipped", reason: (e as Error).message })
    return stats
  }

  const headers = {
    Authorization: `Bearer ${creds.bearerToken}`,
    AccessKey: creds.accessKey,
    "Content-Type": "application/json",
  }

  const signingKey = process.env.KARBON_WEBHOOK_SIGNING_KEY || null
  const staleCutoff = new Date(Date.now() - SUB_STALE_HOURS * 60 * 60 * 1000).toISOString()

  for (const type of KARBON_WEBHOOK_TYPES as readonly KarbonWebhookType[]) {
    stats.checked++

    // Check Karbon-side: does a sub exist for our targetUrl?
    let karbonHasSub = false
    let karbonSubId: string | null = null
    try {
      const res = await fetch(`${KARBON_BASE}/WebhookSubscriptions/${type}`, { headers })
      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        const items = Array.isArray(json.value) ? json.value : Array.isArray(json) ? json : []
        const match = items.find(
          (s: any) => (s.TargetUrl || s.targetUrl) === targetUrl || (s.TargetUrl || "").startsWith(targetUrl),
        )
        if (match) {
          karbonHasSub = true
          karbonSubId =
            match.WebhookSubscriptionPermaKey || match.PermaKey || match.SubscriptionId || `${type}::${targetUrl}`
        }
      }
    } catch (e) {
      stats.details.push({ webhookType: type, action: "check-failed", reason: (e as Error).message })
      stats.failed++
      continue
    }

    // Check our local registry for the row
    const { data: localRow } = await db
      .from("karbon_webhook_subscriptions")
      .select("id, status, last_event_at, failure_count, karbon_subscription_id")
      .eq("webhook_type", type)
      .eq("target_url", targetUrl)
      .maybeSingle()

    if (karbonHasSub) {
      // Healthy on Karbon's side — sync local row
      stats.healthy++
      const isStale = localRow?.last_event_at && localRow.last_event_at < staleCutoff
      if (isStale) {
        stats.stale++
        stats.details.push({
          webhookType: type,
          action: "stale",
          reason: `no events since ${localRow!.last_event_at}`,
        })
      }

      await db.from("karbon_webhook_subscriptions").upsert(
        {
          webhook_type: type,
          karbon_subscription_id: karbonSubId,
          target_url: targetUrl,
          signing_key_configured: !!signingKey,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "karbon_subscription_id", ignoreDuplicates: false },
      )
      continue
    }

    // Karbon doesn't have it — recreate
    try {
      const res = await fetch(`${KARBON_BASE}/WebhookSubscriptions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          TargetUrl: targetUrl,
          WebhookType: type,
          ...(signingKey ? { SigningKey: signingKey } : {}),
        }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        stats.failed++
        stats.details.push({ webhookType: type, action: "recreate-failed", reason: `${res.status}: ${txt}` })
        await db.from("karbon_webhook_subscriptions").upsert(
          {
            webhook_type: type,
            target_url: targetUrl,
            karbon_subscription_id: localRow?.karbon_subscription_id || `${type}::${targetUrl}`,
            signing_key_configured: !!signingKey,
            status: "failed",
            failure_count: (localRow?.failure_count || 0) + 1,
            last_failure_at: new Date().toISOString(),
            last_failure_reason: `${res.status}: ${txt}`.slice(0, 500),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "karbon_subscription_id", ignoreDuplicates: false },
        )
        continue
      }
      const json = await res.json().catch(() => ({}))
      const newId =
        json.WebhookSubscriptionPermaKey || json.PermaKey || json.SubscriptionId || `${type}::${targetUrl}`
      stats.recreated++
      stats.details.push({ webhookType: type, action: "recreated" })
      await db.from("karbon_webhook_subscriptions").upsert(
        {
          webhook_type: type,
          karbon_subscription_id: newId,
          target_url: targetUrl,
          signing_key_configured: !!signingKey,
          status: "active",
          failure_count: 0,
          last_failure_at: null,
          last_failure_reason: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "karbon_subscription_id", ignoreDuplicates: false },
      )
    } catch (e) {
      stats.failed++
      stats.details.push({ webhookType: type, action: "recreate-error", reason: (e as Error).message })
    }
  }

  return stats
}

// ---------------------------------------------------------------------------
// 3. DRIFT: occasional incremental reconciliation
// ---------------------------------------------------------------------------
async function maybeRunDrift(
  db: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  watchdog: CronResult["watchdog"],
): Promise<{ triggered: boolean; reason?: string; result?: any }> {
  // Always run if any sub was just recreated (we may have missed events)
  if (watchdog.recreated > 0) {
    return triggerDrift("subscription-recreated")
  }

  // Otherwise run every Nth time. Use cron run count from sync_log.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await db
    .from("sync_log")
    .select("id", { count: "exact", head: true })
    .gte("started_at", since)
    .eq("sync_direction", "karbon_to_supabase")
    .contains("error_details", { source: "cron" })

  // Run if we haven't done a cron-triggered drift in the last 4 hours
  // (DRIFT_RUN_INTERVAL ticks at 15min cadence ≈ 4 hours).
  const last = await db
    .from("sync_log")
    .select("started_at")
    .eq("sync_direction", "karbon_to_supabase")
    .contains("error_details", { source: "cron" })
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastAt = last.data?.started_at ? new Date(last.data.started_at).getTime() : 0
  const fourHoursAgo = Date.now() - DRIFT_RUN_INTERVAL * 15 * 60 * 1000

  if (lastAt < fourHoursAgo) {
    return triggerDrift(`scheduled-drift (last cron sync >${DRIFT_RUN_INTERVAL * 15}m ago, count=${count || 0})`)
  }

  return { triggered: false, reason: `recent cron sync at ${last.data?.started_at}` }
}

async function triggerDrift(reason: string) {
  const baseUrl = resolveBaseUrl()
  try {
    const res = await fetch(
      `${baseUrl}/api/karbon/sync?incremental=true&expand=false&source=cron`,
      {
        headers: {
          "Content-Type": "application/json",
          ...(process.env.CRON_SECRET ? { "x-internal-secret": process.env.CRON_SECRET } : {}),
        },
      },
    )
    const result = await res.json().catch(() => ({ error: res.statusText }))
    return { triggered: true, reason, result: { ok: res.ok, status: res.status, ...result } }
  } catch (e) {
    return { triggered: true, reason, result: { ok: false, error: (e as Error).message } }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  if (!authorizeRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const db = tryCreateAdminClient()
  if (!db) {
    return NextResponse.json(
      { ok: false, error: "Supabase admin client not configured", startedAt },
      { status: 500 },
    )
  }

  const result: CronResult = {
    ok: true,
    startedAt,
    durationMs: 0,
    replay: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
    watchdog: { checked: 0, healthy: 0, stale: 0, recreated: 0, failed: 0, details: [] },
    drift: { triggered: false },
  }

  // 1. Replay
  try {
    result.replay = await replayPendingEvents(db)
  } catch (e) {
    console.error("[karbon-cron] replay failed:", (e as Error).message)
    result.ok = false
  }

  // 2. Watchdog
  try {
    result.watchdog = await runWatchdog(db)
  } catch (e) {
    console.error("[karbon-cron] watchdog failed:", (e as Error).message)
    result.ok = false
  }

  // 3. Drift
  try {
    result.drift = await maybeRunDrift(db, result.watchdog)
  } catch (e) {
    console.error("[karbon-cron] drift failed:", (e as Error).message)
    result.ok = false
  }

  result.durationMs = Date.now() - t0
  return NextResponse.json(result)
}
