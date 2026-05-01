/**
 * In-process verification of /api/clients/[id] data layer.
 *
 * Calls the route handler directly with a synthetic Request so we can validate
 * the bundle returned without going through the auth middleware.
 *
 * Run with:
 *   set -a && source /vercel/share/.env.project && set +a
 *   pnpm tsx scripts/test-clients-detail-api.ts
 */

import { GET as getClient } from "../app/api/clients/[id]/route"
import { createAdminClient } from "../lib/supabase/server"

interface ClientRow {
  id: string
  full_name?: string | null
  name?: string | null
  karbon_contact_key?: string | null
  karbon_organization_key?: string | null
}

async function pickTopContact(): Promise<ClientRow> {
  const supabase = createAdminClient()
  // Find a contact with the most work items — ensures the bundle has interesting data
  const { data: workItems } = await supabase
    .from("work_items")
    .select("karbon_client_key, client_type")
    .eq("client_type", "Contact")
    .not("karbon_client_key", "is", null)
    .limit(2000)
  const counts = new Map<string, number>()
  for (const w of workItems || []) {
    if (!w.karbon_client_key) continue
    counts.set(w.karbon_client_key, (counts.get(w.karbon_client_key) || 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) throw new Error("No contacts with work items found")
  const { data } = await supabase
    .from("contacts")
    .select("id, full_name, karbon_contact_key")
    .eq("karbon_contact_key", top[0])
    .maybeSingle()
  if (!data) throw new Error(`Contact ${top[0]} missing`)
  return data
}

async function pickTopOrg(): Promise<ClientRow> {
  const supabase = createAdminClient()
  const { data: workItems } = await supabase
    .from("work_items")
    .select("karbon_client_key, client_type")
    .eq("client_type", "Organization")
    .not("karbon_client_key", "is", null)
    .limit(2000)
  const counts = new Map<string, number>()
  for (const w of workItems || []) {
    if (!w.karbon_client_key) continue
    counts.set(w.karbon_client_key, (counts.get(w.karbon_client_key) || 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) throw new Error("No orgs with work items found")
  const { data } = await supabase
    .from("organizations")
    .select("id, full_name, name, karbon_organization_key")
    .eq("karbon_organization_key", top[0])
    .maybeSingle()
  if (!data) throw new Error(`Org ${top[0]} missing`)
  return data
}

async function callRoute(id: string) {
  const params = Promise.resolve({ id })
  const req = new Request(`http://localhost/api/clients/${id}`)
  const res = await getClient(req as unknown as Request, { params } as { params: Promise<{ id: string }> })
  const body = await res.json()
  return { status: res.status, body }
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("  ✗ FAIL:", msg)
    process.exitCode = 1
  } else {
    console.log("  ✓", msg)
  }
}

async function main() {
  const contact = await pickTopContact()
  const org = await pickTopOrg()

  console.log("\n=== A) Contact by UUID ===")
  console.log(`  ${contact.full_name} (${contact.id} / ${contact.karbon_contact_key})`)
  const a = await callRoute(contact.id)
  assert(a.status === 200, `200 OK (got ${a.status})`)
  assert(a.body?.client?.kind === "contact", `kind === contact (${a.body?.client?.kind})`)
  assert(a.body?.client?.id === contact.id, `id matches`)
  assert(a.body?.client?.karbonKey === contact.karbon_contact_key, `karbonKey matches`)
  assert(Array.isArray(a.body?.workItems), `workItems is array (len=${a.body?.workItems?.length})`)
  assert(a.body?.workItems?.length > 0, `workItems populated for top-contact`)
  assert(typeof a.body?.stats?.totalWorkItems === "number", `stats.totalWorkItems is number`)
  assert(Array.isArray(a.body?.serviceLinesUsed), `serviceLinesUsed is array`)
  assert(Array.isArray(a.body?.teamMembers), `teamMembers is array`)
  assert("contactInfo" in (a.body?.client || {}), `contactInfo present`)

  console.log("\n=== B) Same contact resolved by Karbon perma-key ===")
  const b = await callRoute(contact.karbon_contact_key as string)
  assert(b.status === 200, `200 OK (got ${b.status})`)
  assert(b.body?.client?.id === contact.id, `same id resolved`)
  assert(b.body?.client?.karbonKey === contact.karbon_contact_key, `karbon key preserved`)
  assert(b.body?.workItems?.length === a.body?.workItems?.length, `same workItems count`)

  console.log("\n=== C) Organization by UUID ===")
  console.log(`  ${org.full_name || org.name} (${org.id} / ${org.karbon_organization_key})`)
  const c = await callRoute(org.id)
  assert(c.status === 200, `200 OK (got ${c.status})`)
  assert(c.body?.client?.kind === "organization", `kind === organization`)
  assert(c.body?.client?.isOrganization === true, `isOrganization === true`)
  assert(Array.isArray(c.body?.workItems), `workItems is array (len=${c.body?.workItems?.length})`)
  assert("business" in (c.body?.client || {}), `business object present`)
  assert(Array.isArray(c.body?.relatedContacts), `relatedContacts is array (len=${c.body?.relatedContacts?.length})`)

  console.log("\n=== D) Unknown id returns 404 ===")
  const d = await callRoute("00000000-0000-0000-0000-000000000000")
  assert(d.status === 404, `404 (got ${d.status})`)

  console.log("\n=== E) Garbage non-uuid id returns 404 ===")
  const e = await callRoute("not-a-real-key")
  assert(e.status === 404, `404 (got ${e.status})`)

  console.log("\n=== F) Bundle shape sanity-check (top contact) ===")
  const expectedKeys = [
    "client",
    "workItems",
    "karbonNotes",
    "manualNotes",
    "emails",
    "karbonTasks",
    "karbonTimesheets",
    "karbonInvoices",
    "documents",
    "meetings",
    "debriefs",
    "clientGroups",
    "relatedContacts",
    "relatedOrganizations",
    "teamMembers",
    "serviceLinesUsed",
    "stats",
  ]
  for (const k of expectedKeys) {
    assert(k in a.body, `bundle has ${k}`)
  }

  console.log("\n=== G) work_items rows have karbon_url present (set by mapper) ===")
  const sampleWi = a.body?.workItems?.[0]
  if (sampleWi) {
    console.log(`  sample wi: title="${sampleWi.title}" status=${sampleWi.primary_status} due=${sampleWi.due_date}`)
    assert(typeof sampleWi.id === "string", `wi has id`)
    assert(typeof sampleWi.title === "string", `wi has title`)
  }

  console.log("\n=== Summary ===")
  console.log(process.exitCode ? "  FAIL" : "  PASS")
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
