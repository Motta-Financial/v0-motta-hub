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
import { addWebhook, listWebhooks, deleteWebhook } from "@/lib/jotform/client"

const DEFAULT_FORM_ID = "242306172162144" // Motta | Intake Form

function getServiceClient() {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

function getAppBaseUrl(req: Request): string {
  // The webhook is a SERVER-TO-SERVER callback that must reach THIS Hub
  // app's API route. It must therefore resolve to the Hub's own origin
  // (e.g. https://hub.motta.cpa), NOT the public marketing site.
  //
  // `NEXT_PUBLIC_APP_URL` is deliberately excluded: in this project it is
  // set to the marketing domain (https://motta.cpa), which is a SEPARATE
  // Vercel deployment that does not serve /api/jotform/webhook and returns
  // 404. Registering the webhook there silently drops every submission.
  // `APP_BASE_URL` / `AUTH0_BASE_URL` are the Hub's own self-URL.
  const explicit = process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL
  if (explicit) {
    // Some envs store bare hostnames like "hub.motta.cpa" without a scheme.
    // Jotform requires fully-qualified https://… URLs, so normalize.
    const trimmed = explicit.replace(/\/+$/, "")
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  }
  // Last resort: the request's own host (the Hub deployment serving this
  // route). Correct in prod; resolves to localhost in dev.
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

  // 3. Inspect existing webhooks. Only treat the form as already wired
  //    when the EXACT tokenized callback is present. A prefix match here
  //    is a trap: a token-less `…/api/jotform/webhook` (or one carrying a
  //    rotated/wrong token) would satisfy it, so we'd skip the add and
  //    leave the form pointed at a URL the webhook route 401s — silently
  //    dropping every submission. Exact-match forces a repair in that case.
  const existing = await listWebhooks(jotformFormId).catch(() => ({}) as Record<string, string>)
  const existingUrls = Object.values(existing)
  const alreadyRegistered = existingUrls.some((u) => u === callback)

  let added = false
  if (!alreadyRegistered) {
    await addWebhook(jotformFormId, callback)
    added = true
  }

  // 3b. Prune stale copies of OUR OWN webhook route. This covers both a
  //     wrong ORIGIN (e.g. a previous registration that pointed at the
  //     marketing domain https://motta.cpa, which 404s) AND a same-origin
  //     copy carrying the wrong/missing `?token=` (which the route 401s).
  //     Anything on path /api/jotform/webhook that isn't the exact current
  //     callback is removed; genuine third-party webhooks (n8n, Zapier,
  //     etc.) live on other paths and are left untouched. Because this
  //     loops over `existing` (the pre-add snapshot), the freshly added
  //     correct callback is never a deletion candidate.
  const removedStale: string[] = []
  for (const [hookId, hookUrl] of Object.entries(existing)) {
    try {
      const parsed = new URL(hookUrl)
      const isOurRoute = parsed.pathname === "/api/jotform/webhook"
      const isStale = hookUrl !== callback
      if (isOurRoute && isStale) {
        await deleteWebhook(jotformFormId, hookId)
        removedStale.push(hookUrl)
      }
    } catch {
      // Non-URL value — skip.
    }
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
    removed_stale: removedStale,
    webhooks: Object.values(refreshed),
  })
}
