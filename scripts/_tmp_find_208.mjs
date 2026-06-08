import { createClient } from "@supabase/supabase-js"
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: subs } = await supabase
  .from("prospect_submissions")
  .select("id, prospect_type, submitter_full_name, submitter_email, business_name, business_state, business_email, business_phone, business_email_same_as_owner, business_phone_same_as_owner, contact_id, organization_id, push_to_karbon, karbon_push_status, enrichment, created_at")
  .or("business_name.ilike.%208%,business_name.ilike.%mobile detailing%,submitter_full_name.ilike.%arthun%")
  .order("created_at", { ascending: false })
  .limit(10)
console.log("PROSPECT MATCHES:", JSON.stringify(subs, null, 2))

const { data: orgs } = await supabase.from("organizations").select("id, name, karbon_organization_key, primary_email, state, source").or("name.ilike.%208%,name.ilike.%mobile detailing%").limit(10)
console.log("ORG MATCHES:", JSON.stringify(orgs, null, 2))

const { data: contacts } = await supabase.from("contacts").select("id, full_name, primary_email, karbon_contact_key").ilike("full_name", "%arthun%").limit(10)
console.log("CONTACT MATCHES:", JSON.stringify(contacts, null, 2))
