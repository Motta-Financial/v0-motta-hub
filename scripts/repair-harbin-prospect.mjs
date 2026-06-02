/**
 * One-off repair for the Nicole Harbin prospect submission.
 *
 * Symptom: prospect row 5984caad marked karbon_push_status="success" but
 * the Hub contact (dabc9989) has no karbon_contact_key, no Karbon contact
 * exists, and the prospect row's contact_id link-back never persisted.
 *
 * This mirrors pushHubContactToKarbon: create the Karbon contact, write the
 * key back to the Hub contact, then link + correct the prospect row.
 * Idempotent guards re-check both the Hub key and Karbon (by email) right
 * before creating so a re-run can never produce a duplicate.
 */
import { Client } from "pg"

const CONTACT_ID = "dabc9989-441d-43a5-a02e-644aa4f3e6e9"
const PROSPECT_ID = "5984caad-11ae-49b1-83cf-60b8266b9e6e"
const KARBON_BASE = "https://api.karbonhq.com/v3"

const accessKey = process.env.KARBON_ACCESS_KEY
const bearer = process.env.KARBON_BEARER_TOKEN
if (!accessKey || !bearer) {
  console.error("Missing Karbon credentials")
  process.exit(1)
}
const kHeaders = {
  AccessKey: accessKey,
  Authorization: `Bearer ${bearer}`,
  Accept: "application/json",
  "Content-Type": "application/json",
}

function pgClient() {
  const url = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL).replace(
    /[?&]sslmode=[^&]+/,
    "",
  )
  return new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
}

async function searchKarbonByEmail(email) {
  const url = `${KARBON_BASE}/Contacts?$filter=${encodeURIComponent(`EmailAddress eq '${email}'`)}&$top=5`
  const res = await fetch(url, { headers: kHeaders })
  if (!res.ok) throw new Error(`Karbon search failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  return Array.isArray(json.value) ? json.value : []
}

async function main() {
  const c = pgClient()
  await c.connect()

  // 1. Re-read the contact; bail if it somehow already has a key.
  const { rows: cr } = await c.query(
    "select id, first_name, last_name, primary_email, phone_primary, karbon_contact_key from public.contacts where id=$1",
    [CONTACT_ID],
  )
  const contact = cr[0]
  if (!contact) throw new Error("Contact not found")
  console.log("[repair] contact:", JSON.stringify(contact))

  let contactKey = contact.karbon_contact_key

  if (!contactKey) {
    // 2. Idempotency guard: search Karbon by email immediately before create.
    const email = contact.primary_email
    const existing = email ? await searchKarbonByEmail(email) : []
    if (existing.length > 0) {
      contactKey = existing[0].ContactKey
      console.log("[repair] found existing Karbon contact, linking:", contactKey)
    } else {
      // 3. Create in Karbon.
      const body = {
        FirstName: contact.first_name || "Unknown",
        LastName: contact.last_name || "",
        EmailAddress: contact.primary_email || null,
        PhoneNumber: contact.phone_primary || null,
        ContactType: "Client",
        Source: "Motta Hub Prospect Form",
      }
      const res = await fetch(`${KARBON_BASE}/Contacts`, {
        method: "POST",
        headers: kHeaders,
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Karbon create failed: ${res.status} ${await res.text()}`)
      const created = await res.json()
      contactKey = created.ContactKey
      if (!contactKey) throw new Error("Karbon returned no ContactKey")
      console.log("[repair] created Karbon contact:", contactKey)
    }

    // 4. Write the key back to the Hub contact.
    await c.query(
      "update public.contacts set karbon_contact_key=$1, karbon_url=$2, last_synced_at=now() where id=$3",
      [contactKey, `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${contactKey}`, CONTACT_ID],
    )
    console.log("[repair] wrote karbon_contact_key to Hub contact")
  } else {
    console.log("[repair] contact already had a key, skipping create:", contactKey)
  }

  // 5. Link + correct the prospect row.
  const { rowCount } = await c.query(
    `update public.prospect_submissions
       set contact_id=$1,
           organization_id=null,
           link_method='auto_name',
           linked_at=now(),
           karbon_push_status='success',
           karbon_push_error=null,
           karbon_pushed_at=now()
     where id=$2`,
    [CONTACT_ID, PROSPECT_ID],
  )
  console.log("[repair] prospect row updated, rowCount:", rowCount)

  // 6. Verify.
  const { rows: vr } = await c.query(
    `select p.contact_id, p.link_method, p.karbon_push_status, ct.karbon_contact_key, ct.karbon_url
       from public.prospect_submissions p
       join public.contacts ct on ct.id = p.contact_id
      where p.id=$1`,
    [PROSPECT_ID],
  )
  console.log("[repair] VERIFY:", JSON.stringify(vr[0]))

  await c.end()
  console.log("[repair] done")
}

main().catch((e) => {
  console.error("[repair] ERROR:", e.message)
  process.exit(1)
})
