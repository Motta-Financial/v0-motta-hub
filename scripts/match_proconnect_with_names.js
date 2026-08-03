/**
 * Extended audit: ProConnect -> Hub matching including NAME match
 *
 * For every ProConnect client, attempt to find a Hub record using:
 *   1. Tax ID (contact ssn_encrypted/ein, organization tax_number/ein)
 *   2. Email (contact primary/secondary, organization primary)
 *   3. NAME (normalized: lowercase, strip punctuation, strip suffixes
 *      like "LLC, Inc, Corp, LP" before comparing)
 *
 * Confidence ranking when a client has multiple match types:
 *   tax_id > email > name_exact > name_fuzzy_score
 *
 * Outputs the dry-run plan only. No DB writes.
 */
const { createClient } = require("@supabase/supabase-js")

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

const COMMON_SUFFIXES = [
  "llc",
  "l.l.c.",
  "inc",
  "inc.",
  "incorporated",
  "corp",
  "corp.",
  "corporation",
  "co",
  "co.",
  "company",
  "lp",
  "l.p.",
  "llp",
  "l.l.p.",
  "ltd",
  "ltd.",
  "limited",
  "pllc",
  "p.l.l.c.",
  "pc",
  "p.c.",
  "pa",
  "p.a.",
  "the",
]

function normalizeName(name) {
  if (!name) return ""
  let n = String(name).toLowerCase().trim()
  // Strip punctuation
  n = n.replace(/[.,'`"&\/\\\-_()]+/g, " ")
  n = n.replace(/\s+/g, " ").trim()
  // Strip common suffixes/prefixes (only as whole words)
  const tokens = n.split(" ").filter((t) => !COMMON_SUFFIXES.includes(t))
  return tokens.join(" ").trim()
}

function buildPersonName(contact) {
  return normalizeName(
    `${contact.first_name || ""} ${contact.last_name || ""}`.trim()
  )
}

function pcDisplayName(c) {
  if (c.display_name) return c.display_name
  if (c.business_name) return c.business_name
  return `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(no name)"
}

;(async () => {
  console.log("Loading ProConnect clients...")
  const { data: pc, error: pcErr } = await supabase
    .from("proconnect_clients")
    .select(
      "proconnect_client_id, hub_contact_id, client_type, first_name, last_name, business_name, display_name, name_for_matching, email, tax_id"
    )
  if (pcErr) {
    console.error(pcErr)
    process.exit(1)
  }

  console.log(`  ${pc.length} ProConnect clients`)
  const linked = pc.filter((c) => c.hub_contact_id).length
  const unlinked = pc.filter((c) => !c.hub_contact_id)
  console.log(`  ${linked} already linked, ${unlinked.length} unlinked`)

  console.log("Loading contacts...")
  const { data: contacts } = await supabase
    .from("contacts")
    .select(
      "id, first_name, last_name, primary_email, secondary_email, ssn_encrypted, ein, status"
    )
  console.log(`  ${contacts.length} contacts`)

  console.log("Loading organizations...")
  const { data: orgs } = await supabase
    .from("organizations")
    .select(
      "id, name, legal_name, trading_name, primary_email, ein, tax_number, status"
    )
  console.log(`  ${orgs.length} organizations`)

  // Build lookup indexes
  const contactByEmail = new Map()
  const contactByTax = new Map()
  const contactByName = new Map() // normalized name -> [contacts]

  for (const c of contacts) {
    if (c.primary_email)
      contactByEmail.set(c.primary_email.toLowerCase().trim(), c)
    if (c.secondary_email)
      contactByEmail.set(c.secondary_email.toLowerCase().trim(), c)
    if (c.ssn_encrypted) contactByTax.set(c.ssn_encrypted.trim(), c)
    if (c.ein) contactByTax.set(c.ein.trim(), c)

    const n = buildPersonName(c)
    if (n) {
      if (!contactByName.has(n)) contactByName.set(n, [])
      contactByName.get(n).push(c)
    }
  }

  const orgByEmail = new Map()
  const orgByTax = new Map()
  const orgByName = new Map()

  for (const o of orgs) {
    if (o.primary_email)
      orgByEmail.set(o.primary_email.toLowerCase().trim(), o)
    if (o.ein) orgByTax.set(o.ein.trim(), o)
    if (o.tax_number) orgByTax.set(o.tax_number.trim(), o)

    for (const candidate of [o.name, o.legal_name, o.trading_name]) {
      const n = normalizeName(candidate)
      if (n) {
        if (!orgByName.has(n)) orgByName.set(n, [])
        // Avoid double-pushing same org under same key
        if (!orgByName.get(n).some((x) => x.id === o.id))
          orgByName.get(n).push(o)
      }
    }
  }

  const buckets = {
    matchedContactTax: [],
    matchedContactEmail: [],
    matchedContactName: [],
    matchedOrgTax: [],
    matchedOrgEmail: [],
    matchedOrgName: [],
    ambiguous: [],
    noMatch: [],
  }

  for (const c of unlinked) {
    const isOrg = c.client_type === "ORGANIZATION"
    const email = (c.email || "").toLowerCase().trim()
    const tax = (c.tax_id || "").trim()
    const display = pcDisplayName(c)
    const normalized = isOrg
      ? normalizeName(c.business_name || c.display_name)
      : normalizeName(`${c.first_name || ""} ${c.last_name || ""}`)

    let candidates = []

    // 1) tax id
    if (tax) {
      if (isOrg && orgByTax.has(tax))
        candidates.push({ kind: "org", reason: "tax_id", row: orgByTax.get(tax) })
      if (!isOrg && contactByTax.has(tax))
        candidates.push({
          kind: "contact",
          reason: "tax_id",
          row: contactByTax.get(tax),
        })
    }

    // 2) email
    if (email && candidates.length === 0) {
      if (isOrg && orgByEmail.has(email))
        candidates.push({
          kind: "org",
          reason: "email",
          row: orgByEmail.get(email),
        })
      if (!isOrg && contactByEmail.has(email))
        candidates.push({
          kind: "contact",
          reason: "email",
          row: contactByEmail.get(email),
        })
    }

    // 3) name
    if (normalized && candidates.length === 0) {
      if (isOrg && orgByName.has(normalized)) {
        for (const row of orgByName.get(normalized))
          candidates.push({ kind: "org", reason: "name", row })
      }
      if (!isOrg && contactByName.has(normalized)) {
        for (const row of contactByName.get(normalized))
          candidates.push({ kind: "contact", reason: "name", row })
      }
    }

    if (candidates.length === 0) {
      buckets.noMatch.push(c)
      continue
    }

    if (candidates.length > 1) {
      buckets.ambiguous.push({ pc: c, candidates })
      continue
    }

    const m = candidates[0]
    const bucketKey =
      `matched${m.kind === "org" ? "Org" : "Contact"}${m.reason === "tax_id" ? "Tax" : m.reason === "email" ? "Email" : "Name"}`
    buckets[bucketKey].push({ pc: c, match: m, display, normalized })
  }

  console.log("\n=== EXTENDED AUDIT ===")
  console.log("Already linked:                     ", linked)
  console.log("Unlinked:                           ", unlinked.length)
  console.log("  -> contact by tax_id:             ", buckets.matchedContactTax.length)
  console.log("  -> contact by email:              ", buckets.matchedContactEmail.length)
  console.log("  -> contact by name:               ", buckets.matchedContactName.length)
  console.log("  -> org by tax_id:                 ", buckets.matchedOrgTax.length)
  console.log("  -> org by email:                  ", buckets.matchedOrgEmail.length)
  console.log("  -> org by name:                   ", buckets.matchedOrgName.length)
  console.log("  -> ambiguous (manual review):     ", buckets.ambiguous.length)
  console.log("  -> no match found:                ", buckets.noMatch.length)

  const sample = (label, rows, fmt) => {
    console.log(`\n--- ${label} (${rows.length}) ---`)
    rows.slice(0, 30).forEach(fmt)
    if (rows.length > 30) console.log(`  ... and ${rows.length - 30} more`)
  }

  sample("Contact by tax_id", buckets.matchedContactTax, (x) => {
    const r = x.match.row
    console.log(`  ${x.display}  ->  ${r.first_name} ${r.last_name} (${r.id})`)
  })

  sample("Org by email", buckets.matchedOrgEmail, (x) => {
    const r = x.match.row
    console.log(`  ${x.display}  ->  ${r.name} (${r.id})`)
  })

  sample("Org by name (NEW - review carefully)", buckets.matchedOrgName, (x) => {
    const r = x.match.row
    console.log(
      `  "${x.display}"  ->  "${r.name}"  [normalized: "${x.normalized}"]  (${r.id})`
    )
  })

  sample("Contact by name (NEW - review carefully)", buckets.matchedContactName, (x) => {
    const r = x.match.row
    console.log(
      `  "${x.display}"  ->  "${r.first_name} ${r.last_name}"  [normalized: "${x.normalized}"]  (${r.id})`
    )
  })

  sample("Ambiguous", buckets.ambiguous, (x) => {
    console.log(
      `  ${pcDisplayName(x.pc)} (${x.pc.client_type}) - ${x.candidates.length} candidates:`
    )
    x.candidates.slice(0, 5).forEach((cd) => {
      const label = cd.kind === "org" ? cd.row.name : `${cd.row.first_name} ${cd.row.last_name}`
      console.log(`     [${cd.reason}] ${cd.kind} ${label} (${cd.row.id})`)
    })
  })

  sample("Still no match", buckets.noMatch, (c) => {
    console.log(
      `  [${c.client_type}] ${pcDisplayName(c)}  email=${c.email || "-"}  tax=${c.tax_id || "-"}`
    )
  })

  // Save the proposed link plan to a file for inspection / approval
  const fs = require("fs")
  const plan = []
  for (const key of [
    "matchedContactTax",
    "matchedContactEmail",
    "matchedContactName",
    "matchedOrgTax",
    "matchedOrgEmail",
    "matchedOrgName",
  ]) {
    for (const x of buckets[key]) {
      plan.push({
        proconnect_client_id: x.pc.proconnect_client_id,
        proconnect_display: pcDisplayName(x.pc),
        proconnect_type: x.pc.client_type,
        match_kind: x.match.kind, // 'contact' | 'org'
        match_reason: x.match.reason, // 'tax_id' | 'email' | 'name'
        match_id: x.match.row.id,
        match_display:
          x.match.kind === "org"
            ? x.match.row.name
            : `${x.match.row.first_name || ""} ${x.match.row.last_name || ""}`.trim(),
      })
    }
  }
  fs.writeFileSync(
    "scripts/proconnect_link_plan.json",
    JSON.stringify(plan, null, 2)
  )
  console.log(`\nWrote ${plan.length} confident matches to scripts/proconnect_link_plan.json`)
})()
