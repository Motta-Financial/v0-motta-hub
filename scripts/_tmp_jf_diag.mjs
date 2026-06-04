import { createClient } from "@supabase/supabase-js"
const API_BASE = "https://api.jotform.com"
const KEY = process.env.JOTFORM_API_KEY
const INTAKE_FORM_ID = "242306172162144"

async function jf(path) {
  const url = new URL(API_BASE + path)
  url.searchParams.set("apiKey", KEY)
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, cache: "no-store" })
  const body = await res.json()
  if (!res.ok || body.responseCode !== 200) throw new Error(`${path} -> ${res.status} code=${body.responseCode} ${body.message}`)
  return body.content
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

console.log("=== JOTFORM API KEY ===", KEY ? "present" : "MISSING")

// form metadata + live count
const form = await jf(`/form/${INTAKE_FORM_ID}`)
console.log("=== FORM ===", JSON.stringify({ id: form.id, title: form.title, status: form.status, liveCount: form.count, updated: form.updated_at }, null, 2))

// registered webhooks
const hooks = await jf(`/form/${INTAKE_FORM_ID}/webhooks`)
console.log("=== REGISTERED WEBHOOKS ===", JSON.stringify(hooks, null, 2))

// our form registry row
const { data: formRow } = await db.from("jotform_forms").select("*").eq("jotform_form_id", INTAKE_FORM_ID).maybeSingle()
console.log("=== HUB jotform_forms ROW ===", JSON.stringify(formRow, null, 2))

// stored count
const { count: stored } = await db.from("jotform_intake_submissions").select("*", { count: "exact", head: true }).eq("jotform_form_id", INTAKE_FORM_ID)
console.log("=== STORED SUBMISSIONS (this form) ===", stored)

// recent submissions in Hub
const { data: recentRows } = await db.from("jotform_intake_submissions")
  .select("jotform_submission_id, submitter_full_name, submitter_email, jotform_created_at, created_at, link_method").order("jotform_created_at", { ascending: false }).limit(6)
console.log("=== RECENT HUB ROWS ===", JSON.stringify(recentRows, null, 2))

// recent live submissions from Jotform
const subs = await jf(`/form/${INTAKE_FORM_ID}/submissions?limit=6&orderby=created_at`)
console.log("=== RECENT JOTFORM SUBMISSIONS ===", JSON.stringify((subs||[]).map(s => ({ id: s.id, created: s.created_at, status: s.status })), null, 2))

// recent webhook events
const { data: events } = await db.from("jotform_webhook_events")
  .select("jotform_submission_id, jotform_form_id, processing_status, processing_error, received_at, processed_at").order("received_at", { ascending: false }).limit(8)
console.log("=== RECENT WEBHOOK EVENTS ===", JSON.stringify(events, null, 2))
