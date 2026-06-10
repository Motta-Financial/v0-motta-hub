import { createClient } from "@supabase/supabase-js"

const DRY = process.env.DRY === "1"
const API = "https://api.jotform.com"
const KEY = process.env.JOTFORM_API_KEY
const HUB = "https://hub.motta.cpa"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

async function jf(path, init) {
  const u = new URL(API + path)
  u.searchParams.set("apiKey", KEY)
  const res = await fetch(u, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) }, cache: "no-store" })
  const body = await res.json()
  return { status: res.status, code: body.responseCode, content: body.content, message: body.message }
}
const listWebhooks = (f) => jf(`/form/${f}/webhooks`)
const addWebhook = (f, url) => jf(`/form/${f}/webhooks`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ webhookURL: url }) })
const deleteWebhook = (f, id) => jf(`/form/${f}/webhooks/${id}`, { method: "DELETE" })

// Forms to repair: read secret from jotform_forms so the URL is correct.
const { data: forms } = await supabase
  .from("jotform_forms")
  .select("id, jotform_form_id, kind, title, webhook_secret")
  .in("jotform_form_id", ["242306172162144", "240915444941155"])

for (const f of forms ?? []) {
  const correct = `${HUB}/api/jotform/webhook?token=${f.webhook_secret}`
  console.log(`\n=== ${f.title} (${f.jotform_form_id}, ${f.kind}) ===`)
  console.log("  correct URL:", correct)

  const wh = await listWebhooks(f.jotform_form_id)
  const entries = Object.entries(wh.content ?? {}) // [hookId, url]
  console.log("  currently registered:")
  for (const [id, url] of entries) console.log(`    [${id}] ${url}`)

  // Delete any copy of OUR route (/api/jotform/webhook) that isn't the
  // exact correct URL. Leave genuine third-party webhooks (other paths)
  // untouched.
  for (const [id, url] of entries) {
    let isOurRoute = false
    try { isOurRoute = new URL(url).pathname === "/api/jotform/webhook" } catch {}
    if (isOurRoute && url !== correct) {
      console.log(`  ${DRY ? "[DRY] would delete" : "deleting"} stale: [${id}] ${url}`)
      if (!DRY) console.log("    ->", JSON.stringify(await deleteWebhook(f.jotform_form_id, id)).slice(0, 160))
    }
  }

  const alreadyCorrect = entries.some(([, url]) => url === correct)
  if (alreadyCorrect) {
    console.log("  correct webhook already present — no add needed")
  } else {
    console.log(`  ${DRY ? "[DRY] would add" : "adding"} correct webhook`)
    if (!DRY) console.log("    ->", JSON.stringify(await addWebhook(f.jotform_form_id, correct)).slice(0, 160))
  }

  if (!DRY) {
    await supabase.from("jotform_forms").update({
      webhook_url: correct,
      webhook_subscribed: true,
      last_synced_at: new Date().toISOString(),
    }).eq("id", f.id)
  }

  const after = await listWebhooks(f.jotform_form_id)
  console.log("  AFTER:", JSON.stringify(after.content))
}

console.log(`\nDone (${DRY ? "DRY RUN — nothing changed" : "applied"}).`)
