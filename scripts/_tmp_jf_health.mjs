import { createClient } from "@supabase/supabase-js"
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const API = "https://api.jotform.com"
const KEY = process.env.JOTFORM_API_KEY
const jf = async (p) => { const r = await fetch(`${API}${p}${p.includes("?")?"&":"?"}apiKey=${KEY}`, { cache: "no-store" }); const j = await r.json(); return { status: r.status, code: j.responseCode, content: j.content, message: j.message } }

// 1. Forms registered in our DB (all columns)
const { data: forms } = await supabase.from("jotform_forms").select("*")
console.log("=== jotform_forms (our DB) ===")
for (const f of forms ?? []) console.log(JSON.stringify(f))

// 2. For each form, get Jotform-side webhooks + latest submission
for (const f of forms ?? []) {
  const fid = f.jotform_form_id
  const wh = await jf(`/form/${fid}/webhooks`)
  console.log(`\n=== Webhooks registered on Jotform for form ${fid} (${f.kind}) ===`)
  console.log("HTTP", wh.status, "code", wh.code, "->", JSON.stringify(wh.content))
  const subs = await jf(`/form/${fid}/submissions?limit=5&orderby=created_at`)
  console.log(`--- Jotform latest 5 submissions for ${fid} ---`)
  if (Array.isArray(subs.content)) {
    for (const s of subs.content) console.log(`  ${s.id}  created=${s.created_at}  status=${s.status}`)
  } else console.log("  ", JSON.stringify(subs))
}

// 3. Recent webhook events (all columns, last 10)
const { data: ev } = await supabase.from("jotform_webhook_events").select("*").order("created_at", { ascending: false }).limit(8)
console.log("\n=== recent jotform_webhook_events ===")
for (const e of ev ?? []) console.log(JSON.stringify(e).slice(0, 400))
