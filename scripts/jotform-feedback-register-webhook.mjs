// Register the Hub webhook on Jotform's "Feedback + Referral" form
// (240915444941155). Pulls the per-form webhook_secret out of the
// `jotform_forms` registry, builds the URL, and POSTs it to Jotform's
// /form/{id}/webhooks endpoint.
//
// Run with:
//   NODE_TLS_REJECT_UNAUTHORIZED=0 \
//     node --env-file-if-exists=/vercel/share/.env.project \
//          scripts/jotform-feedback-register-webhook.mjs
//
// Idempotent — Jotform deduplicates by URL, so re-running is safe
// after rotating webhook_secret. After registration the script
// re-lists the form's webhooks so you can see the post-state.

import { createClient } from "@supabase/supabase-js"

const FORM_ID = process.env.JOTFORM_FEEDBACK_FORM_ID || "240915444941155"
const API_KEY = process.env.JOTFORM_API_KEY
const APP = "https://www.motta.cpa"

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const { data: row, error } = await sb
  .from("jotform_forms")
  .select("webhook_secret")
  .eq("jotform_form_id", FORM_ID)
  .maybeSingle()
if (error || !row) {
  console.error("[v0] form not in registry — run migration 046 first:", error?.message)
  process.exit(1)
}

const webhookUrl = `${APP}/api/jotform/webhook?token=${row.webhook_secret}`
console.log("[v0] Registering webhook URL:", webhookUrl)

const fd = new FormData()
fd.set("webhookURL", webhookUrl)
const res = await fetch(
  `https://api.jotform.com/form/${FORM_ID}/webhooks?apiKey=${API_KEY}`,
  { method: "POST", body: fd },
)
const body = await res.json()
console.log("[v0] Jotform response:", res.status, body.message)
if (!res.ok || body.responseCode !== 200) process.exit(1)

await sb
  .from("jotform_forms")
  .update({ webhook_url: webhookUrl, webhook_subscribed: true })
  .eq("jotform_form_id", FORM_ID)
console.log("[v0] jotform_forms row updated")

// Echo the post-state so the operator can confirm there are no rogue
// webhooks still attached to the form.
const lres = await fetch(
  `https://api.jotform.com/form/${FORM_ID}/webhooks?apiKey=${API_KEY}`,
)
const lbody = await lres.json()
console.log("\n[v0] Webhooks now registered on form", FORM_ID + ":")
for (const [id, u] of Object.entries(lbody.content || {})) {
  console.log(`  [${id}]  ${u}`)
}
