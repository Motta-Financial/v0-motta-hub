#!/usr/bin/env node
/**
 * Audit script: match ProConnect clients to Hub contacts/organizations
 * by email and tax ID. READ-ONLY — produces a report, makes no changes.
 *
 * Run:
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     scripts/audit_proconnect_to_hub_match.js
 */

const { createClient } = require("@supabase/supabase-js")

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function norm(s) {
  return (s || "").trim().toLowerCase()
}
function normTaxId(s) {
  return (s || "").replace(/\D/g, "")
}

;(async () => {
  console.log("Loading ProConnect clients...")
  const { data: pcClients, error: pcErr } = await supabase
    .from("proconnect_clients")
    .select(
      "id, proconnect_client_id, hub_contact_id, email, tax_id, first_name, last_name, business_name, client_type"
    )
  if (pcErr) throw pcErr
  console.log(`  ${pcClients.length} ProConnect clients`)

  const alreadyLinked = pcClients.filter((c) => c.hub_contact_id).length
  const unlinked = pcClients.filter((c) => !c.hub_contact_id)
  console.log(`  ${alreadyLinked} already linked, ${unlinked.length} unlinked`)

  console.log("Loading contacts...")
  const { data: contacts, error: cErr } = await supabase
    .from("contacts")
    .select(
      "id, primary_email, secondary_email, ssn_encrypted, ein, first_name, last_name, full_name"
    )
  if (cErr) throw cErr
  console.log(`  ${contacts.length} contacts`)

  console.log("Loading organizations...")
  const { data: orgs, error: oErr } = await supabase
    .from("organizations")
    .select("id, primary_email, tax_number, ein, name, legal_name, trading_name")
  if (oErr) throw oErr
  console.log(`  ${orgs.length} organizations`)

  // Build lookup maps
  const contactsByEmail = new Map()
  const contactsByTaxId = new Map()
  for (const c of contacts) {
    for (const e of [c.primary_email, c.secondary_email]) {
      const k = norm(e)
      if (k) {
        if (!contactsByEmail.has(k)) contactsByEmail.set(k, [])
        contactsByEmail.get(k).push(c)
      }
    }
    for (const t of [c.ssn_encrypted, c.ein]) {
      const k = normTaxId(t)
      if (k && k.length >= 9) {
        if (!contactsByTaxId.has(k)) contactsByTaxId.set(k, [])
        contactsByTaxId.get(k).push(c)
      }
    }
  }

  const orgsByEmail = new Map()
  const orgsByTaxId = new Map()
  for (const o of orgs) {
    const k = norm(o.primary_email)
    if (k) {
      if (!orgsByEmail.has(k)) orgsByEmail.set(k, [])
      orgsByEmail.get(k).push(o)
    }
    for (const t of [o.tax_number, o.ein]) {
      const k = normTaxId(t)
      if (k && k.length >= 9) {
        if (!orgsByTaxId.has(k)) orgsByTaxId.set(k, [])
        orgsByTaxId.get(k).push(o)
      }
    }
  }

  // Match each unlinked PC client
  const buckets = {
    contactEmail: [],
    contactTaxId: [],
    orgEmail: [],
    orgTaxId: [],
    multipleAmbiguous: [],
    noMatch: [],
  }

  for (const pc of unlinked) {
    const email = norm(pc.email)
    const taxId = normTaxId(pc.tax_id)

    const contactByEmail = email ? contactsByEmail.get(email) || [] : []
    const contactByTaxId = taxId ? contactsByTaxId.get(taxId) || [] : []
    const orgByEmail = email ? orgsByEmail.get(email) || [] : []
    const orgByTaxId = taxId ? orgsByTaxId.get(taxId) || [] : []

    const totalMatches =
      contactByEmail.length +
      contactByTaxId.length +
      orgByEmail.length +
      orgByTaxId.length

    if (totalMatches === 0) {
      buckets.noMatch.push(pc)
      continue
    }

    // Prefer the most specific single match
    if (contactByEmail.length === 1) {
      buckets.contactEmail.push({ pc, match: contactByEmail[0], via: "email" })
    } else if (contactByTaxId.length === 1) {
      buckets.contactTaxId.push({ pc, match: contactByTaxId[0], via: "tax_id" })
    } else if (orgByEmail.length === 1) {
      buckets.orgEmail.push({ pc, match: orgByEmail[0], via: "email" })
    } else if (orgByTaxId.length === 1) {
      buckets.orgTaxId.push({ pc, match: orgByTaxId[0], via: "tax_id" })
    } else {
      buckets.multipleAmbiguous.push({
        pc,
        candidates: {
          contactByEmail,
          contactByTaxId,
          orgByEmail,
          orgByTaxId,
        },
      })
    }
  }

  console.log("\n=== AUDIT RESULTS ===")
  console.log(`Already linked:               ${alreadyLinked}`)
  console.log(`Unlinked:                     ${unlinked.length}`)
  console.log(`  -> match contact by email:  ${buckets.contactEmail.length}`)
  console.log(`  -> match contact by tax_id: ${buckets.contactTaxId.length}`)
  console.log(`  -> match org by email:      ${buckets.orgEmail.length}`)
  console.log(`  -> match org by tax_id:     ${buckets.orgTaxId.length}`)
  console.log(`  -> ambiguous (multiple):    ${buckets.multipleAmbiguous.length}`)
  console.log(`  -> no match found:          ${buckets.noMatch.length}`)

  // Show a sample of each
  function sampleLine(label, items, render) {
    console.log(`\n--- ${label} (showing up to 5) ---`)
    for (const item of items.slice(0, 5)) console.log("  " + render(item))
  }
  const renderName = (pc) =>
    pc.business_name ||
    `${pc.first_name || ""} ${pc.last_name || ""}`.trim() ||
    "(no name)"

  sampleLine("Contact by email", buckets.contactEmail, ({ pc, match }) =>
    `[${pc.client_type || "?"}] ${renderName(pc)} <${pc.email}>  ->  ${match.full_name} (${match.id})`
  )
  sampleLine("Contact by tax_id", buckets.contactTaxId, ({ pc, match }) =>
    `[${pc.client_type || "?"}] ${renderName(pc)} tax=${pc.tax_id}  ->  ${match.full_name} (${match.id})`
  )
  sampleLine("Org by email", buckets.orgEmail, ({ pc, match }) =>
    `[${pc.client_type || "?"}] ${renderName(pc)} <${pc.email}>  ->  ${match.name} (${match.id})`
  )
  sampleLine("Org by tax_id", buckets.orgTaxId, ({ pc, match }) =>
    `[${pc.client_type || "?"}] ${renderName(pc)} tax=${pc.tax_id}  ->  ${match.name} (${match.id})`
  )
  sampleLine("Ambiguous", buckets.multipleAmbiguous, ({ pc, candidates }) => {
    const counts = [
      `${candidates.contactByEmail.length}c-email`,
      `${candidates.contactByTaxId.length}c-tax`,
      `${candidates.orgByEmail.length}o-email`,
      `${candidates.orgByTaxId.length}o-tax`,
    ].join("/")
    return `[${pc.client_type || "?"}] ${renderName(pc)} <${pc.email || "-"}>  candidates=${counts}`
  })
  sampleLine("No match", buckets.noMatch, (pc) =>
    `[${pc.client_type || "?"}] ${renderName(pc)} <${pc.email || "-"}> tax=${pc.tax_id || "-"}`
  )

  // How many no-match have neither email nor tax_id at all?
  const noMatchNoData = buckets.noMatch.filter(
    (pc) => !norm(pc.email) && !normTaxId(pc.tax_id)
  ).length
  console.log(
    `\nOf no-match: ${noMatchNoData} have NO email AND NO tax_id (cannot match by data)`
  )
})()
