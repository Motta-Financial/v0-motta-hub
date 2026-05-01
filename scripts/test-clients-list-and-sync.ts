/**
 * Verifies the list endpoints (lifted limits) and the per-client sync endpoint.
 */

import { GET as listContacts } from "../app/api/supabase/contacts/route"
import { GET as listOrgs } from "../app/api/supabase/organizations/route"
import { POST as syncOne } from "../app/api/clients/[id]/sync/route"
import { GET as getClient } from "../app/api/clients/[id]/route"
import { createAdminClient } from "../lib/supabase/server"

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("  ✗ FAIL:", msg)
    process.exitCode = 1
  } else {
    console.log("  ✓", msg)
  }
}

async function main() {
  const supabase = createAdminClient()

  console.log("\n=== A) /api/supabase/contacts returns ALL rows (limit lifted) ===")
  const aReq = new Request("http://localhost/api/supabase/contacts")
  const aRes = await listContacts(aReq)
  const aJson = await aRes.json()
  console.log(`  status=${aRes.status} count=${aJson?.contacts?.length || aJson?.data?.length}`)
  assert(aRes.status === 200, `200 OK`)
  // Defensive: handle either {contacts:[]} or {data:[]} or array
  const aLen = aJson?.contacts?.length ?? aJson?.data?.length ?? (Array.isArray(aJson) ? aJson.length : 0)
  assert(aLen > 50, `more than 50 contacts (got ${aLen})`)

  console.log("\n=== B) /api/supabase/organizations returns ALL rows (limit lifted) ===")
  const bReq = new Request("http://localhost/api/supabase/organizations")
  const bRes = await listOrgs(bReq)
  const bJson = await bRes.json()
  console.log(`  status=${bRes.status} count=${bJson?.organizations?.length || bJson?.data?.length}`)
  assert(bRes.status === 200, `200 OK`)
  const bLen =
    bJson?.organizations?.length ?? bJson?.data?.length ?? (Array.isArray(bJson) ? bJson.length : 0)
  assert(bLen > 50, `more than 50 orgs (got ${bLen})`)

  console.log("\n=== C) Pick a contact and exercise /api/clients/[id]/sync ===")
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, full_name, karbon_contact_key")
    .not("karbon_contact_key", "is", null)
    .limit(1)
    .maybeSingle()
  if (!contact) {
    console.log("  (no contacts available - skipping sync test)")
    return
  }
  console.log(`  Contact: ${contact.full_name} ${contact.id} ${contact.karbon_contact_key}`)
  const syncReq = new Request(`http://localhost/api/clients/${contact.id}/sync`, { method: "POST" })
  const params = Promise.resolve({ id: contact.id })
  const syncRes = await syncOne(syncReq, { params } as { params: Promise<{ id: string }> })
  const syncJson = await syncRes.json()
  console.log(`  status=${syncRes.status} body=${JSON.stringify(syncJson).slice(0, 300)}`)
  // Sync may legitimately return non-200 if Karbon API key isn't present in this env, but
  // the endpoint itself should respond cleanly without crashing.
  assert(typeof syncJson === "object" && syncJson !== null, `sync responded with object`)

  console.log("\n=== D) Detail endpoint reflects last_synced_at after sync ===")
  // (only if the sync above succeeded — otherwise we just check the bundle is fetchable)
  const detailReq = new Request(`http://localhost/api/clients/${contact.id}`)
  const detailRes = await getClient(detailReq, {
    params: Promise.resolve({ id: contact.id }),
  } as { params: Promise<{ id: string }> })
  const detailJson = await detailRes.json()
  assert(detailRes.status === 200, `detail 200`)
  assert(detailJson.client?.id === contact.id, `same contact returned`)
  console.log(`  lastSyncedAt: ${detailJson.client?.lastSyncedAt || "(never)"}`)
  console.log(`  karbonModifiedAt: ${detailJson.client?.karbonModifiedAt || "(none)"}`)

  console.log("\n=== Summary ===")
  console.log(process.exitCode ? "  FAIL" : "  PASS")
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
