/**
 * Backfill ProConnect → Hub Contact/Organization links
 *
 * Strategy:
 * 1. PERSON clients: match by (first_name, last_name) on contacts table
 *    - Single match → auto-link
 *    - Multiple matches → tie-break by email, then by tax_id (ssn_last_four)
 *    - Zero matches → leave for human review (per memory rule §4)
 * 2. BUSINESS/ORGANIZATION clients: match by name on organizations
 *    - Fall back to contacts table if person-name match exists (mis-classified)
 *
 * Per the data-model memory rule, NEVER auto-create a Hub contact for an
 * unmatched ProConnect client — surface for human review only.
 *
 * Run: pnpm dlx tsx scripts/backfill-proconnect-hub-links.ts
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface PCClient {
  id: string
  proconnect_client_id: string
  client_type: string | null
  display_name: string | null
  first_name: string | null
  last_name: string | null
  business_name: string | null
  email: string | null
  phone: string | null
  state: string | null
  tax_id: string | null
}

interface MatchResult {
  pc: PCClient
  matchType: "contact" | "organization" | "none"
  matchedId: string | null
  matchedDisplayName: string | null
  matchScore: number // 0-100
  reason: string
}

function last4(s: string | null): string | null {
  if (!s) return null
  const digits = s.replace(/\D/g, "")
  return digits.length >= 4 ? digits.slice(-4) : null
}

async function findContactMatch(pc: PCClient): Promise<MatchResult> {
  // 1. Try first_name + last_name
  if (pc.first_name && pc.last_name) {
    const { data: byName } = await sb
      .from("contacts")
      .select("id, first_name, last_name, primary_email, ssn_last_four")
      .ilike("first_name", pc.first_name.trim())
      .ilike("last_name", pc.last_name.trim())

    if (byName && byName.length === 1) {
      return {
        pc,
        matchType: "contact",
        matchedId: byName[0].id,
        matchedDisplayName: `${byName[0].first_name} ${byName[0].last_name}`,
        matchScore: 90,
        reason: "exact name match",
      }
    }

    // Multiple name matches — tie-break by email or SSN last 4
    if (byName && byName.length > 1) {
      const pcLast4 = last4(pc.tax_id)
      const emailMatch = pc.email
        ? byName.find(
            (c) => c.primary_email?.toLowerCase() === pc.email!.toLowerCase()
          )
        : null
      if (emailMatch) {
        return {
          pc,
          matchType: "contact",
          matchedId: emailMatch.id,
          matchedDisplayName: `${emailMatch.first_name} ${emailMatch.last_name}`,
          matchScore: 95,
          reason: "name + email match",
        }
      }
      const ssnMatch = pcLast4
        ? byName.find((c) => c.ssn_last_four === pcLast4)
        : null
      if (ssnMatch) {
        return {
          pc,
          matchType: "contact",
          matchedId: ssnMatch.id,
          matchedDisplayName: `${ssnMatch.first_name} ${ssnMatch.last_name}`,
          matchScore: 100,
          reason: "name + SSN last 4 match",
        }
      }
      return {
        pc,
        matchType: "none",
        matchedId: null,
        matchedDisplayName: null,
        matchScore: 0,
        reason: `${byName.length} ambiguous name matches — needs review`,
      }
    }
  }

  // 2. Try email
  if (pc.email) {
    const { data: byEmail } = await sb
      .from("contacts")
      .select("id, first_name, last_name")
      .eq("primary_email", pc.email.trim())
      .limit(2)
    if (byEmail && byEmail.length === 1) {
      return {
        pc,
        matchType: "contact",
        matchedId: byEmail[0].id,
        matchedDisplayName: `${byEmail[0].first_name} ${byEmail[0].last_name}`,
        matchScore: 85,
        reason: "email match",
      }
    }
  }

  return {
    pc,
    matchType: "none",
    matchedId: null,
    matchedDisplayName: null,
    matchScore: 0,
    reason: "no matching contact found",
  }
}

async function findOrganizationMatch(pc: PCClient): Promise<MatchResult> {
  const name = pc.business_name || pc.display_name
  if (!name) {
    return {
      pc,
      matchType: "none",
      matchedId: null,
      matchedDisplayName: null,
      matchScore: 0,
      reason: "no business name to match",
    }
  }

  // 1. Exact org name match
  const { data: byName } = await sb
    .from("organizations")
    .select("id, name")
    .ilike("name", name.trim())
    .limit(2)
  if (byName && byName.length === 1) {
    return {
      pc,
      matchType: "organization",
      matchedId: byName[0].id,
      matchedDisplayName: byName[0].name,
      matchScore: 90,
      reason: "exact org name match",
    }
  }

  // 2. Fuzzy match - look for org with similar name
  const cleanedName = name
    .replace(/[,.]/g, "")
    .replace(/\b(LLC|Inc|Corp|CFP|CPA|PC|PLLC|Ltd)\b/gi, "")
    .trim()
  if (cleanedName.length > 3) {
    const { data: byFuzzy } = await sb
      .from("organizations")
      .select("id, name")
      .ilike("name", `%${cleanedName}%`)
      .limit(5)
    if (byFuzzy && byFuzzy.length === 1) {
      return {
        pc,
        matchType: "organization",
        matchedId: byFuzzy[0].id,
        matchedDisplayName: byFuzzy[0].name,
        matchScore: 75,
        reason: "fuzzy org name match",
      }
    }
  }

  // 3. Fall back: maybe it's a person mis-classified as ORG (e.g., "Joseph Montgomery, CFP")
  // Try to extract name and search contacts
  const personMatch = name.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)/)
  if (personMatch) {
    const [, firstName, lastName] = personMatch
    const { data: byPerson } = await sb
      .from("contacts")
      .select("id, first_name, last_name")
      .ilike("first_name", firstName)
      .ilike("last_name", lastName)
      .limit(2)
    if (byPerson && byPerson.length === 1) {
      return {
        pc,
        matchType: "contact",
        matchedId: byPerson[0].id,
        matchedDisplayName: `${byPerson[0].first_name} ${byPerson[0].last_name}`,
        matchScore: 70,
        reason: "ORG mis-classified — matched as PERSON contact",
      }
    }
  }

  return {
    pc,
    matchType: "none",
    matchedId: null,
    matchedDisplayName: null,
    matchScore: 0,
    reason: "no matching organization or contact found",
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  console.log(`Starting ProConnect → Hub link backfill ${dryRun ? "(DRY RUN)" : ""}\n`)

  // Get all unlinked PC clients
  const { data: unlinked, error } = await sb
    .from("proconnect_clients")
    .select(
      "id, proconnect_client_id, client_type, display_name, first_name, last_name, business_name, email, phone, state, tax_id"
    )
    .is("hub_contact_id", null)
    .is("hub_organization_id", null)

  if (error) {
    console.error("Failed to fetch unlinked clients:", error.message)
    process.exit(1)
  }

  console.log(`Found ${unlinked?.length || 0} unlinked ProConnect clients\n`)

  const results: MatchResult[] = []
  for (const pc of unlinked || []) {
    let result: MatchResult
    if (pc.client_type === "PERSON") {
      result = await findContactMatch(pc)
    } else {
      result = await findOrganizationMatch(pc)
    }
    results.push(result)
  }

  // Summary
  const linked = results.filter((r) => r.matchType !== "none")
  const unmatched = results.filter((r) => r.matchType === "none")

  console.log("=".repeat(70))
  console.log("MATCH SUMMARY")
  console.log("=".repeat(70))
  console.log(`Found matches: ${linked.length}`)
  console.log(`Needs human review: ${unmatched.length}`)
  console.log()

  console.log("--- MATCHES TO APPLY ---")
  for (const r of linked) {
    console.log(
      `  [${r.matchScore}%] ${r.pc.display_name} (${r.pc.client_type}) → ${r.matchedDisplayName} (${r.matchType}) [${r.reason}]`
    )
  }

  if (unmatched.length > 0) {
    console.log("\n--- NEEDS HUMAN REVIEW ---")
    for (const r of unmatched) {
      console.log(
        `  ${r.pc.display_name} (${r.pc.client_type}) [${r.pc.proconnect_client_id}] — ${r.reason}`
      )
    }
  }

  if (dryRun) {
    console.log("\nDRY RUN — no changes applied. Re-run without --dry-run to apply.")
    return
  }

  // Apply matches
  console.log("\n--- APPLYING MATCHES ---")
  let applied = 0
  let failed = 0
  for (const r of linked) {
    const update: Record<string, string> = {}
    if (r.matchType === "contact") update.hub_contact_id = r.matchedId!
    if (r.matchType === "organization") update.hub_organization_id = r.matchedId!

    const { error: updateError } = await sb
      .from("proconnect_clients")
      .update(update)
      .eq("id", r.pc.id)

    if (updateError) {
      console.log(`  FAILED: ${r.pc.display_name} — ${updateError.message}`)
      failed++
    } else {
      console.log(`  Linked: ${r.pc.display_name} → ${r.matchedDisplayName}`)
      applied++
    }
  }

  console.log("\n=".repeat(35))
  console.log(`Applied: ${applied} | Failed: ${failed} | Skipped: ${unmatched.length}`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
