/**
 * GET /api/jotform/intake/webhook-status
 *
 * Lightweight status snapshot for the "Jotform Integration" card on
 * /intake. Returns just enough for the admin to confirm the webhook
 * pipeline is healthy without leaving the Hub:
 *
 *   - The Jotform form (id, title, live submission count)
 *   - Every webhook URL currently registered on Jotform's side
 *   - Whether our expected Hub URL is the *only* one registered
 *   - Last 24h: events received / processed / failed
 *   - Last successful delivery timestamp
 *   - Hub-side stored row count
 *
 * Differs from /api/jotform/health by being cheap to call repeatedly
 * (SWR-friendly) and shaped for direct UI consumption.
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getForm, listWebhooks } from "@/lib/jotform/client"

const INTAKE_FORM_ID = "242306172162144"

export async function GET() {
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // 1. Pull the form row from our registry — this is the source of
  //    truth for the URL we *expect* to be registered (we wrote it
  //    when we ran the subscribe step).
  const { data: formRow } = await supabase
    .from("jotform_forms")
    .select("jotform_form_id, title, webhook_url, webhook_subscribed, last_synced_at")
    .eq("jotform_form_id", INTAKE_FORM_ID)
    .maybeSingle()

  // 2. Pull the live form metadata from Jotform (title, status, count)
  //    + the live webhook list. Both fail-soft so the card still
  //    renders if Jotform is briefly down.
  let jotformForm: { id: string; title: string; status: string; count: number } | null = null
  let jotformError: string | null = null
  try {
    const f = await getForm(INTAKE_FORM_ID)
    jotformForm = {
      id: f.id,
      title: f.title,
      status: f.status,
      count: Number(f.count),
    }
  } catch (err) {
    jotformError = (err as Error).message
  }

  let registeredWebhooks: string[] = []
  let webhooksError: string | null = null
  try {
    const hooks = await listWebhooks(INTAKE_FORM_ID)
    registeredWebhooks = Object.values(hooks)
  } catch (err) {
    webhooksError = (err as Error).message
  }

  // 3. Cross-check: is the Hub the *only* registered consumer?
  //    `webhook_url` from our row may have a slightly different
  //    trailing slash or token, so compare by origin + path prefix.
  const expectedPrefix = formRow?.webhook_url?.split("?")[0] ?? null
  const hubRegistered =
    !!expectedPrefix && registeredWebhooks.some((u) => u.split("?")[0] === expectedPrefix)
  const otherWebhooks = expectedPrefix
    ? registeredWebhooks.filter((u) => u.split("?")[0] !== expectedPrefix)
    : registeredWebhooks

  // 4. Recent delivery telemetry (last 24h) + last success / last
  //    failure so the card can show "Last delivery 4 minutes ago".
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ count: events24h }, { count: failed24h }, lastSuccess, lastFailure, totalRows] = await Promise.all([
    supabase
      .from("jotform_webhook_events")
      .select("*", { count: "exact", head: true })
      .gte("received_at", since),
    supabase
      .from("jotform_webhook_events")
      .select("*", { count: "exact", head: true })
      .eq("processing_status", "failed")
      .gte("received_at", since),
    supabase
      .from("jotform_webhook_events")
      .select("received_at, processed_at")
      .eq("processing_status", "processed")
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("jotform_webhook_events")
      .select("received_at, processing_error")
      .eq("processing_status", "failed")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("jotform_intake_submissions")
      .select("*", { count: "exact", head: true })
      .eq("jotform_form_id", INTAKE_FORM_ID),
  ])

  return NextResponse.json({
    form: {
      id: INTAKE_FORM_ID,
      title: formRow?.title ?? jotformForm?.title ?? "Motta | Intake Form",
      status: jotformForm?.status ?? null,
      live_submission_count: jotformForm?.count ?? null,
      stored_submission_count: totalRows.count ?? 0,
      last_synced_at: formRow?.last_synced_at ?? null,
    },
    jotform_api: {
      ok: jotformError === null,
      error: jotformError,
    },
    webhook: {
      expected_url: formRow?.webhook_url ?? null,
      hub_registered: hubRegistered,
      other_webhooks_count: otherWebhooks.length,
      other_webhooks: otherWebhooks,
      registered_webhooks: registeredWebhooks,
      list_error: webhooksError,
    },
    deliveries: {
      events_24h: events24h ?? 0,
      failed_24h: failed24h ?? 0,
      last_success_at: lastSuccess.data?.processed_at ?? null,
      last_failure_at: lastFailure.data?.received_at ?? null,
      last_failure_error: lastFailure.data?.processing_error ?? null,
    },
  })
}
