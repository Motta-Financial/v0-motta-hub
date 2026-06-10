import { createClient } from "@supabase/supabase-js"
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// 1. Forms config
const { data: forms, error: fErr } = await supabase.from("jotform_forms").select("jotform_form_id, kind, title, webhook_secret, is_active, webhook_registered_at, last_submission_at")
console.log("FORMS:", fErr?.message || JSON.stringify(forms, null, 2))

// 2. Recent webhook events
const { data: events, error: eErr } = await supabase
  .from("jotform_webhook_events")
  .select("id, jotform_form_id, jotform_submission_id, status, error_message, created_at, processed_at")
  .order("created_at", { ascending: false })
  .limit(15)
console.log("\nRECENT WEBHOOK EVENTS:", eErr?.message || JSON.stringify(events, null, 2))

// 3. Count + latest intake submissions
const { count, error: cErr } = await supabase.from("jotform_intake_submissions").select("*", { count: "exact", head: true })
console.log("\nINTAKE SUBMISSION COUNT:", cErr?.message || count)

const { data: latest, error: lErr } = await supabase
  .from("jotform_intake_submissions")
  .select("id, jotform_submission_id, submitter_full_name, lead_status, jotform_created_at, created_at")
  .order("created_at", { ascending: false })
  .limit(10)
console.log("\nLATEST INTAKE ROWS:", lErr?.message || JSON.stringify(latest, null, 2))
