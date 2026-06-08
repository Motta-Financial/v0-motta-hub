import { createClient } from "@supabase/supabase-js"
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const cid = "653e6f3c-f493-458e-baf8-9216c4bd576d"

const { data: contact } = await supabase.from("contacts").select("*").eq("id", cid).single()
console.log("CONTACT:", JSON.stringify({ id: contact.id, full_name: contact.full_name, primary_email: contact.primary_email, phone_primary: contact.phone_primary, city: contact.city, state: contact.state, karbon_contact_key: contact.karbon_contact_key, source: contact.source, employer: contact.employer }, null, 2))

const { data: ps } = await supabase.from("prospect_submissions").select("*").eq("contact_id", cid)
console.log("PROSPECT_SUBMISSIONS:", JSON.stringify(ps, null, 2))

const { data: js } = await supabase.from("jotform_intake_submissions").select("*").eq("contact_id", cid)
console.log("JOTFORM_INTAKE:", JSON.stringify(js, null, 2))

const { data: co } = await supabase.from("contact_organizations").select("*").eq("contact_id", cid)
console.log("CONTACT_ORGS:", JSON.stringify(co, null, 2))
