// One-off repair for a prospect_submissions row whose Karbon push
// silently failed (status "success" but no karbon_contact_key, and the
// prospect row left unlinked). Idempotent: re-searches Karbon by email
// before creating so it never makes a duplicate. Uses the documented
// BusinessCards[] create schema (the flat shape returns 400).
//
// Usage: node --env-file-if-exists=/vercel/share/.env.project \
//   scripts/repair-prospect-karbon.mjs <prospect_submission_id>

import pg from "pg"

const SUBMISSION_ID = process.argv[2]
if (!SUBMISSION_ID) {
  console.error("Usage: repair-prospect-karbon.mjs <prospect_submission_id>")
  process.exit(1)
}

const KARBON_BASE = "https://api.karbonhq.com/v3"
const ACCESS_KEY = process.env.KARBON_ACCESS_KEY
const BEARER = process.env.KARBON_BEARER_TOKEN

function karbonHeaders() {
  return {
    AccessKey: ACCESS_KEY,
    Authorization: `Bearer ${BEARER}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  }
}

async function searchKarbonByEmail(email) {
  const filter = encodeURIComponent(`EmailAddress eq '${email}'`)
  const res = await fetch(`${KARBON_BASE}/Contacts?$filter=${filter}&$top=1`, {
    headers: karbonHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json()
  const list = Array.isArray(data?.value) ? data.value : []
  return list[0]?.ContactKey ?? null
}

async function createKarbonContact({ firstName, lastName, email, phone }) {
  const body = {
    FirstName: firstName,
    LastName: lastName,
    ContactType: "Client",
    RestrictionLevel: "Public",
    BusinessCards: [
      {
        IsPrimaryCard: true,
        EmailAddresses: email ? [email] : [],
        PhoneNumbers: phone
          ? [{ Number: phone, CountryCode: "US", Label: "Work" }]
          : [],
      },
    ],
  }
  const res = await fetch(`${KARBON_BASE}/Contacts`, {
    method: "POST",
    headers: karbonHeaders(),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Karbon create failed ${res.status}: ${text}`)
  }
  return JSON.parse(text).ContactKey
}

async function main() {
  const url = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL).replace(
    /[?&]sslmode=[^&]+/,
    "",
  )
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()

  // 1. Load the submission + its linked-or-resolvable Hub contact.
  const { rows } = await client.query(
    `select id, submitter_full_name, submitter_email, submitter_phone, contact_id
     from public.prospect_submissions where id = $1`,
    [SUBMISSION_ID],
  )
  if (!rows.length) throw new Error(`No prospect_submission ${SUBMISSION_ID}`)
  const sub = rows[0]
  console.log("[v0] submission:", sub.submitter_full_name, sub.submitter_email)

  // Resolve the Hub contact (prefer linked contact_id, else match by email).
  let contact
  if (sub.contact_id) {
    const r = await client.query(`select * from public.contacts where id = $1`, [sub.contact_id])
    contact = r.rows[0]
  }
  if (!contact && sub.submitter_email) {
    const r = await client.query(
      `select * from public.contacts where primary_email ilike $1 order by created_at desc limit 1`,
      [sub.submitter_email],
    )
    contact = r.rows[0]
  }
  if (!contact) throw new Error("Could not resolve a Hub contact for this submission")
  console.log("[v0] hub contact:", contact.id, "| karbon_key:", contact.karbon_contact_key)

  // 2. Ensure a Karbon contact exists (idempotent).
  let karbonKey = contact.karbon_contact_key
  if (!karbonKey) {
    karbonKey = await searchKarbonByEmail(contact.primary_email)
    if (karbonKey) {
      console.log("[v0] found existing Karbon contact, linking:", karbonKey)
    } else {
      karbonKey = await createKarbonContact({
        firstName: contact.first_name || "Unknown",
        lastName: contact.last_name || "",
        email: contact.primary_email,
        phone: contact.phone_primary,
      })
      console.log("[v0] created Karbon contact:", karbonKey)
    }
  }

  // 3. Backfill the Hub contact with the Karbon key.
  await client.query(
    `update public.contacts
       set karbon_contact_key = $1,
           karbon_contact_url = $2,
           last_synced_at = now()
     where id = $3`,
    [karbonKey, `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${karbonKey}`, contact.id],
  )

  // 4. Link the prospect row + mark the push correctly.
  await client.query(
    `update public.prospect_submissions
       set contact_id = $1,
           link_method = coalesce(link_method, 'auto_name'),
           linked_at = coalesce(linked_at, now()),
           karbon_push_status = 'success',
           karbon_push_error = null,
           karbon_pushed_at = now()
     where id = $2`,
    [contact.id, SUBMISSION_ID],
  )

  console.log("[v0] DONE — Karbon", karbonKey, "linked to Hub contact", contact.id)
  await client.end()
}

main().catch((e) => {
  console.error("[v0] REPAIR FAILED:", e.message)
  process.exit(1)
})
