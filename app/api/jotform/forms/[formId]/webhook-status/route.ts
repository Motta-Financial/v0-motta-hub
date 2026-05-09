/**
 * GET /api/jotform/forms/[formId]/webhook-status
 *
 * Lightweight status snapshot for the JotformStatusCard. Multi-form
 * version of the original /api/jotform/intake/webhook-status — that
 * route stays for backwards compatibility, but new pages (like
 * /feedback) consume this one with the form's Jotform ID in the path.
 *
 * Returns the same shape regardless of form kind:
 *   - form metadata (id, title, live submission count, stored count)
 *   - every webhook URL currently registered on Jotform's side
 *   - whether the Hub URL is the *only* one registered
 *   - last 24h delivery counters + last success/failure timestamps
 *
 * Differs from /api/jotform/health by being cheap to call repeatedly
 * (SWR-friendly) and shaped for direct UI consumption.
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getForm, listWebhooks } from "@/lib/jotform/client"

// Map a form `kind` to the denormalized table that holds its rows.
// Centralized here so a future form just needs an entry.
const KIND_TABLE: Record<string, string> = {
  intake: "jotform_intake_submissions",
  feedback: "jotform_feedback_submissions",
}

export async function GET(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params

  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: formRow } = await supabase
    .from("jotform_forms")
    .select("jotform_form_id, title, kind, webhook_url, webhook_subscribed, last_synced_at")
    .eq("jotform_form_id", formId)
    .maybeSingle()

  if (!formRow) {
    return NextResponse.json({ error: "Form not registered" }, { status: 404 })
  }

  // Live form metadata + webhook list (fail-soft — card still renders
  // if Jotform is briefly down).
  let jotformForm: { id: string; title: string; status: string; count: number } | null = null
  let jotformError: string | null = null
  try {
    const f = await getForm(formId)
    jotformForm = { id: f.id, title: f.title, status: f.status, count: Number(f.count) }
  } catch (err) {
    jotformError = (err as Error).message
  }

  let registeredWebhooks: string[] = []
  let webhooksError: string | null = null
  try {
    const hooks = await listWebhooks(formId)
    registeredWebhooks = Object.values(hooks)
  } catch (err) {
    webhooksError = (err as Error).message
  }

  const expectedPrefix = formRow.webhook_url?.split("?")[0] ?? null
  const hubRegistered =
    !!expectedPrefix && registeredWebhooks.some((u) => u.split("?")[0] === expectedPrefix)
  const otherWebhooks = expectedPrefix
    ? registeredWebhooks.filter((u) => u.split("?")[0] !== expectedPrefix)
    : registeredWebhooks

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const submissionsTable = KIND_TABLE[formRow.kind ?? "intake"] ?? "jotform_intake_submissions"

  const [{ count: events24h }, { count: failed24h }, lastSuccess, lastFailure, totalRows] = await Promise.all([
    supabase
      .from("jotform_webhook_events")
      .select("*", { count: "exact", head: true })
      .eq("jotform_form_id", formId)
      .gte("received_at", since),
    supabase
      .from("jotform_webhook_events")
      .select("*", { count: "exact", head: true })
      .eq("jotform_form_id", formId)
      .eq("processing_status", "failed")
      .gte("received_at", since),
    supabase
      .from("jotform_webhook_events")
      .select("received_at, processed_at")
      .eq("jotform_form_id", formId)
      .eq("processing_status", "processed")
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("jotform_webhook_events")
      .select("received_at, processing_error")
      .eq("jotform_form_id", formId)
      .eq("processing_status", "failed")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(submissionsTable)
      .select("*", { count: "exact", head: true })
      .eq("jotform_form_id", formId),
  ])

  return NextResponse.json({
    form: {
      id: formId,
      title: formRow.title ?? jotformForm?.title ?? "Form",
      kind: formRow.kind ?? "other",
      status: jotformForm?.status ?? null,
      live_submission_count: jotformForm?.count ?? null,
      stored_submission_count: totalRows.count ?? 0,
      last_synced_at: formRow.last_synced_at ?? null,
    },
    jotform_api: { ok: jotformError === null, error: jotformError },
    webhook: {
      expected_url: formRow.webhook_url ?? null,
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
