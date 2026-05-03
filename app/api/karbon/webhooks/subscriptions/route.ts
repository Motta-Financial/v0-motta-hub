/**
 * Karbon webhook subscription manager.
 *
 * Per the Karbon API v3 spec (corrected from prior implementation):
 *   - POST /v3/WebhookSubscriptions      body: { TargetUrl, WebhookType, SigningKey? }
 *   - GET  /v3/WebhookSubscriptions/{WebhookType}
 *   - DELETE /v3/WebhookSubscriptions             — deletes ALL subscriptions
 *   - DELETE /v3/WebhookSubscriptions('{TargetUrl}')  — delete by target URL
 *
 * The 8 valid WebhookTypes are:
 *   Contact, Work, Note, User, IntegrationTask, Invoice, EstimateSummary, CustomField
 *
 * Important: `Contact` covers Contacts, Organizations, AND ClientGroups —
 * subscribing once gives you all three.
 */
import { type NextRequest, NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { getKarbonCredentials } from "@/lib/karbon-api"
import {
  resolveWebhookTargetUrl,
  KARBON_WEBHOOK_TYPES,
  type KarbonWebhookType,
} from "@/lib/karbon/webhook-url"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const KARBON_BASE = "https://api.karbonhq.com/v3"

function karbonHeaders() {
  const creds = getKarbonCredentials()
  if (!creds) throw new Error("Karbon API credentials not configured")
  return {
    Authorization: `Bearer ${creds.bearerToken}`,
    AccessKey: creds.accessKey,
    "Content-Type": "application/json",
  }
}

// ---------------------------------------------------------------------------
// GET — list subscriptions across all types, joined with our local registry
// ---------------------------------------------------------------------------
export async function GET() {
  let headers: HeadersInit
  try {
    headers = karbonHeaders()
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 })
  }

  const remote: any[] = []
  for (const type of KARBON_WEBHOOK_TYPES) {
    try {
      const res = await fetch(`${KARBON_BASE}/WebhookSubscriptions/${type}`, { headers })
      if (res.ok) {
        const json = await res.json()
        const items = Array.isArray(json.value) ? json.value : Array.isArray(json) ? json : []
        for (const it of items) remote.push({ ...it, _webhookType: type })
      }
    } catch (e) {
      console.warn(`[karbon-subs] Failed to list ${type}:`, (e as Error).message)
    }
  }

  const db = tryCreateAdminClient()
  const local = db
    ? (await db.from("karbon_webhook_subscriptions").select("*").order("webhook_type")).data || []
    : []

  return NextResponse.json({ remote, local })
}

// ---------------------------------------------------------------------------
// POST — create subscriptions for the requested types (defaults to all 8)
// ---------------------------------------------------------------------------
interface SubscribeBody {
  webhookTypes?: KarbonWebhookType[]
  targetUrl?: string
  signingKey?: string
}

export async function POST(request: NextRequest) {
  let headers: HeadersInit
  try {
    headers = karbonHeaders()
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as SubscribeBody
  const types =
    body.webhookTypes && body.webhookTypes.length > 0
      ? body.webhookTypes.filter((t) => KARBON_WEBHOOK_TYPES.includes(t))
      : [...KARBON_WEBHOOK_TYPES]

  let targetUrl: string
  try {
    targetUrl = body.targetUrl || resolveWebhookTargetUrl()
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }

  if (!targetUrl.startsWith("https://")) {
    return NextResponse.json({ error: "targetUrl must use https://" }, { status: 400 })
  }

  const signingKey = body.signingKey || process.env.KARBON_WEBHOOK_SIGNING_KEY || null
  const db = tryCreateAdminClient()
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })

  const results: Array<{ webhookType: string; ok: boolean; error?: string; karbonId?: string }> = []

  for (const type of types) {
    const subPayload: Record<string, string> = {
      TargetUrl: targetUrl,
      WebhookType: type,
    }
    if (signingKey) subPayload.SigningKey = signingKey

    try {
      const res = await fetch(`${KARBON_BASE}/WebhookSubscriptions`, {
        method: "POST",
        headers,
        body: JSON.stringify(subPayload),
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        results.push({ webhookType: type, ok: false, error: `${res.status}: ${txt}` })

        // Persist as failed
        await db
          .from("karbon_webhook_subscriptions")
          .upsert(
            {
              webhook_type: type,
              target_url: targetUrl,
              signing_key_configured: !!signingKey,
              status: "failed",
              last_failure_at: new Date().toISOString(),
              last_failure_reason: `${res.status}: ${txt}`.slice(0, 500),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "karbon_subscription_id", ignoreDuplicates: false },
          )
        continue
      }

      const json = await res.json().catch(() => ({}))
      const karbonId =
        json.WebhookSubscriptionPermaKey ||
        json.PermaKey ||
        json.SubscriptionId ||
        `${type}::${targetUrl}`

      results.push({ webhookType: type, ok: true, karbonId })

      // Persist locally — use karbon_subscription_id as the conflict target
      await db.from("karbon_webhook_subscriptions").upsert(
        {
          webhook_type: type,
          karbon_subscription_id: karbonId,
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
    } catch (e: any) {
      results.push({ webhookType: type, ok: false, error: e?.message || String(e) })
    }
  }

  return NextResponse.json({ targetUrl, results })
}

// ---------------------------------------------------------------------------
// DELETE — remove a subscription (by webhookType + targetUrl, or all)
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  let headers: HeadersInit
  try {
    headers = karbonHeaders()
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 })
  }

  const url = new URL(request.url)
  const webhookType = url.searchParams.get("webhookType") as KarbonWebhookType | null
  const targetUrl = url.searchParams.get("targetUrl")
  const all = url.searchParams.get("all") === "true"
  const db = tryCreateAdminClient()

  // DELETE all
  if (all) {
    const res = await fetch(`${KARBON_BASE}/WebhookSubscriptions`, { method: "DELETE", headers })
    if (db) await db.from("karbon_webhook_subscriptions").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    return NextResponse.json({ ok: res.ok, status: res.status })
  }

  if (!targetUrl) {
    return NextResponse.json({ error: "targetUrl query param is required" }, { status: 400 })
  }

  // DELETE by target URL: per spec the URL form is /WebhookSubscriptions('{url}')
  const encoded = encodeURIComponent(targetUrl)
  const res = await fetch(`${KARBON_BASE}/WebhookSubscriptions('${encoded}')`, {
    method: "DELETE",
    headers,
  })
  const ok = res.ok || res.status === 204

  if (db) {
    let q = db.from("karbon_webhook_subscriptions").delete().eq("target_url", targetUrl)
    if (webhookType) q = q.eq("webhook_type", webhookType)
    await q
  }

  return NextResponse.json({ ok, status: res.status })
}
