/**
 * POST /api/jotform/webhook/subscribe
 *
 * Registers the Motta Hub webhook URL on the intake Jotform. Idempotent:
 * if a Hub-shaped URL is already registered we return early without
 * adding a duplicate. Existing third-party webhooks (e.g. the n8n one)
 * are left in place — Jotform supports multiple webhooks per form.
 *
 * Body (optional JSON):
 *   { formId?: string }   // defaults to the intake form
 *
 * Returns the list of webhooks now registered on the form.
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { addWebhook, listWebhooks } from "@/lib/jotform/client"

const DEFAULT_FORM_ID = "242306172162144" // Motta | Intake Form

function getServiceClient() {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

function getAppBaseUrl(req: Request): string {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_BASE_URL ??
    process.env.AUTH0_BASE_URL
  if (explicit) {
    // Some envs store bare hostnames like "motta.cpa" without a scheme.
    // Jotform requires fully-qualified https://… URLs, so normalize.
    const trimmed = explicit.replace(/\/+$/, "")
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  }
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}`
}

export async function POST(req: Request) {
  let body: { formId?: string } = {}
  try {
    body = (await req.json()) as { formId?: string }
  } catch {
    /* empty body is fine */
  }
  const jotformFormId = body.formId ?? DEFAULT_FORM_ID

  const supabase = getServiceClient()

  // 1. Find (or initialize) the form row + grab the per-form secret.
  const { data: formRow, error } = await supabase
    .from("jotform_forms")
    .select("id, jotform_form_id, webhook_secret, title")
    .eq("jotform_form_id", jotformFormId)
    .maybeSingle()

  if (error || !formRow) {
    return NextResponse.json(
      {
        ok: false,
        error: `Form ${jotformFormId} not found in jotform_forms. Run the 045 migration first.`,
      },
      { status: 404 },
    )
  }

  if (!formRow.webhook_secret) {
    return NextResponse.json(
      { ok: false, error: "Form row is missing webhook_secret" },
      { status: 500 },
    )
  }

  // 2. Build the public callback URL.
  const baseUrl = getAppBaseUrl(req)
  const callback = `${baseUrl}/api/jotform/webhook?token=${formRow.webhook_secret}`

  // 3. Inspect existing webhooks. If our base URL is already registered,
  //    skip the add (Jotform's API will silently dedupe but we want to
  //    return a consistent response).
  const existing = await listWebhooks(jotformFormId).catch(() => ({}) as Record<string, string>)
  const existingUrls = Object.values(existing)
  const alreadyRegistered = existingUrls.some(
    (u) => u.startsWith(`${baseUrl}/api/jotform/webhook`),
  )

  let added = false
  if (!alreadyRegistered) {
    await addWebhook(jotformFormId, callback)
    added = true
  }

  // 4. Update the form row with the latest webhook URL.
  await supabase
    .from("jotform_forms")
    .update({
      webhook_url: callback,
      webhook_subscribed: true,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", formRow.id)

  // 5. Return the current list (post-add).
  const refreshed = await listWebhooks(jotformFormId).catch(() => existing)

  return NextResponse.json({
    ok: true,
    form: { id: formRow.jotform_form_id, title: formRow.title },
    callback_url: callback,
    added,
    already_registered: alreadyRegistered,
    webhooks: Object.values(refreshed),
  })
}
