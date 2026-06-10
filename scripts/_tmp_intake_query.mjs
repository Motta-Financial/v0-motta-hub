import { createClient } from "@supabase/supabase-js"
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Exact projection from app/api/jotform/intake/route.ts
const sel = `
  id, jotform_submission_id, jotform_created_at, submitter_full_name,
  submitter_first_name, submitter_last_name, submitter_email, submitter_phone,
  submitter_state, services_requested, service_focus, entity_types,
  business_name, business_revenue_range, business_summary, lead_status,
  triage_notes, assigned_to_id, contact_id, organization_id, link_method,
  linked_at, lead_id, referral_source, preferred_team_member, preferred_team_member_id
`
const { data, error } = await supabase
  .from("jotform_intake_submissions")
  .select(sel)
  .order("jotform_created_at", { ascending: false, nullsFirst: false })
  .limit(5)

console.log("ERROR:", error ? JSON.stringify(error, null, 2) : "none")
console.log("ROWS RETURNED:", data?.length ?? 0)
if (data?.[0]) console.log("FIRST ROW NAME:", data[0].submitter_full_name, "| created:", data[0].jotform_created_at)
