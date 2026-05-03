/**
 * Backfill `ignition_proposals.contact_id` and `organization_id`.
 *
 * The Ignition proposals webhook stores `client_name` (and sometimes
 * `client_email`) but historically did NOT resolve those values to a
 * Supabase contact / organization row. As a result, every proposal in the
 * database has `contact_id IS NULL AND organization_id IS NULL`, which
 * means the client profile page can't show "all related proposals".
 *
 * This script resolves those proposals to the right Supabase entity by:
 *
 *   1. Exact match on client_email (when present) against:
 *        - contacts.primary_email / secondary_email
 *        - organizations.primary_email
 *
 *   2. Exact match on client_name against:
 *        - organizations.name / full_name / legal_name / trading_name
 *        - contacts.full_name / preferred_name
 *
 *   3. "First name + last name" pair match for contacts when the proposal
 *      lists a single individual (e.g. "Mike Clark" -> first="Mike",
 *      last="Clark"). Multi-person names ("X & Y") are matched against
 *      whichever party comes first.
 *
 *   4. Heuristic: if client_name ends in " LLC", " Inc", " Inc.", " LLP",
 *      ", LLC", " Corp", etc. -> only match against organizations.
 *
 * The script is dry-run by default. Pass `--apply` to write the FK columns.
 *
 *   pnpm tsx scripts/backfill-ignition-proposal-clients.ts
 *   pnpm tsx scripts/backfill-ignition-proposal-clients.ts --apply
 *
 * Re-running is safe — already-linked proposals are skipped.
 */
import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

const BUSINESS_SUFFIX_RE =
  /\b(LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|Limited|LLP|LP|PLLC|PA|PC|Partners|Group|Holdings|Trust|Foundation|Associates|Solutions|Studios|Consulting|Capital|Tap(room|house))\b\.?$/i

function looksLikeBusiness(name: string): boolean {
  return BUSINESS_SUFFIX_RE.test(name.trim())
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

interface ContactRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  primary_email: string | null
  secondary_email: string | null
}

interface OrgRow {
  id: string
  name: string | null
  full_name: string | null
  legal_name: string | null
  trading_name: string | null
  primary_email: string | null
}

interface ProposalRow {
  proposal_id: string
  title: string | null
  client_name: string | null
  client_email: string | null
  contact_id: string | null
  organization_id: string | null
}

interface MatchResult {
  matchKind: "email" | "exact-name" | "first-last" | "ambiguous-skip" | "none"
  contactId: string | null
  orgId: string | null
  reason: string
}

function buildIndexes(contacts: ContactRow[], orgs: OrgRow[]) {
  const emailToContact = new Map<string, string>() // email -> contact.id
  const emailToOrg = new Map<string, string>() // email -> org.id
  const nameToContacts = new Map<string, string[]>() // normalized full name -> [contact.id]
  const nameToOrgs = new Map<string, string[]>() // normalized name -> [org.id]
  const firstLastToContacts = new Map<string, string[]>() // "first|last" -> [contact.id]

  const pushName = (map: Map<string, string[]>, key: string, id: string) => {
    if (!key) return
    const existing = map.get(key)
    if (existing) {
      if (!existing.includes(id)) existing.push(id)
    } else {
      map.set(key, [id])
    }
  }

  for (const c of contacts) {
    if (c.primary_email) emailToContact.set(c.primary_email.toLowerCase(), c.id)
    if (c.secondary_email) emailToContact.set(c.secondary_email.toLowerCase(), c.id)

    const fullCandidates = [
      c.full_name,
      c.preferred_name,
      [c.first_name, c.last_name].filter(Boolean).join(" "),
    ].filter(Boolean) as string[]
    for (const n of fullCandidates) pushName(nameToContacts, normalize(n), c.id)

    if (c.first_name && c.last_name) {
      const key = `${normalize(c.first_name)}|${normalize(c.last_name)}`
      pushName(firstLastToContacts, key, c.id)
    }
  }

  for (const o of orgs) {
    if (o.primary_email) emailToOrg.set(o.primary_email.toLowerCase(), o.id)
    const candidates = [o.name, o.full_name, o.legal_name, o.trading_name].filter(
      Boolean,
    ) as string[]
    for (const n of candidates) pushName(nameToOrgs, normalize(n), o.id)
  }

  return { emailToContact, emailToOrg, nameToContacts, nameToOrgs, firstLastToContacts }
}

function resolveProposal(
  proposal: ProposalRow,
  idx: ReturnType<typeof buildIndexes>,
): MatchResult {
  const name = (proposal.client_name || "").trim()
  const email = (proposal.client_email || "").trim().toLowerCase()
  const isBusinessName = name && looksLikeBusiness(name)

  // 1. Email match wins, regardless of family
  if (email) {
    const orgId = idx.emailToOrg.get(email)
    const contactId = idx.emailToContact.get(email)
    if (orgId) return { matchKind: "email", contactId: null, orgId, reason: `email→org` }
    if (contactId) return { matchKind: "email", contactId, orgId: null, reason: `email→contact` }
  }

  if (!name) return { matchKind: "none", contactId: null, orgId: null, reason: "no name or email" }

  const norm = normalize(name)

  // 2. Direct organization name match (only family for clearly-business names)
  const orgIds = idx.nameToOrgs.get(norm)
  if (orgIds && orgIds.length === 1) {
    return { matchKind: "exact-name", contactId: null, orgId: orgIds[0], reason: "exact org name" }
  }
  if (orgIds && orgIds.length > 1) {
    return {
      matchKind: "ambiguous-skip",
      contactId: null,
      orgId: null,
      reason: `${orgIds.length} orgs share name`,
    }
  }

  if (isBusinessName) {
    return { matchKind: "none", contactId: null, orgId: null, reason: "business-suffix, no org match" }
  }

  // 3. Direct contact full-name match
  const contactIds = idx.nameToContacts.get(norm)
  if (contactIds && contactIds.length === 1) {
    return {
      matchKind: "exact-name",
      contactId: contactIds[0],
      orgId: null,
      reason: "exact contact name",
    }
  }
  if (contactIds && contactIds.length > 1) {
    return {
      matchKind: "ambiguous-skip",
      contactId: null,
      orgId: null,
      reason: `${contactIds.length} contacts share name`,
    }
  }

  // 4. First+last match for individuals (handles "First Middle Last" client_name
  //    against contacts.first_name/last_name)
  // Strip suffixes like "Mark & Kylee", "X and Y" — match on the first half.
  const splitOnAmp = name.split(/\s+(?:&|and)\s+/i)[0]?.trim() ?? name
  const tokens = splitOnAmp.split(/\s+/).filter(Boolean)
  if (tokens.length >= 2) {
    const first = normalize(tokens[0])
    const last = normalize(tokens[tokens.length - 1])
    const key = `${first}|${last}`
    const ids = idx.firstLastToContacts.get(key)
    if (ids && ids.length === 1) {
      return {
        matchKind: "first-last",
        contactId: ids[0],
        orgId: null,
        reason: "first+last contact match",
      }
    }
    if (ids && ids.length > 1) {
      return {
        matchKind: "ambiguous-skip",
        contactId: null,
        orgId: null,
        reason: `${ids.length} contacts share first+last`,
      }
    }
  }

  return { matchKind: "none", contactId: null, orgId: null, reason: "no match" }
}

async function main() {
  const url = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || "").replace(
    /sslmode=require/,
    "sslmode=no-verify",
  )
  if (!url) throw new Error("POSTGRES_URL not set")

  const c = new Client({ connectionString: url })
  await c.connect()
  console.log(`Connected. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`)

  // Fetch
  const [proposalsRes, contactsRes, orgsRes] = await Promise.all([
    c.query<ProposalRow>(`
      SELECT proposal_id, title, client_name, client_email, contact_id, organization_id
      FROM ignition_proposals
      WHERE contact_id IS NULL AND organization_id IS NULL
      ORDER BY created_at DESC NULLS LAST
    `),
    c.query<ContactRow>(`
      SELECT id, full_name, first_name, last_name, preferred_name, primary_email, secondary_email
      FROM contacts
    `),
    c.query<OrgRow>(`
      SELECT id, name, full_name, legal_name, trading_name, primary_email
      FROM organizations
    `),
  ])

  const proposals = proposalsRes.rows
  const contacts = contactsRes.rows
  const orgs = orgsRes.rows
  const idx = buildIndexes(contacts, orgs)

  console.log(`Unlinked proposals: ${proposals.length}`)
  console.log(`Contacts indexed:   ${contacts.length}`)
  console.log(`Orgs indexed:       ${orgs.length}\n`)

  const updates: Array<{ proposal_id: string; contact_id: string | null; org_id: string | null }> = []
  const summary: Record<string, number> = {}
  const unmatched: ProposalRow[] = []

  for (const p of proposals) {
    const result = resolveProposal(p, idx)
    summary[result.matchKind] = (summary[result.matchKind] || 0) + 1

    if (result.contactId || result.orgId) {
      updates.push({ proposal_id: p.proposal_id, contact_id: result.contactId, org_id: result.orgId })
    } else {
      unmatched.push(p)
    }
    console.log(
      `  ${p.proposal_id}  ${(p.client_name || "").padEnd(40).slice(0, 40)}  →  ${result.matchKind.padEnd(15)} ${result.reason}`,
    )
  }

  console.log("\nMatch summary:")
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`)

  if (unmatched.length) {
    console.log(`\nNeed manual review (${unmatched.length}):`)
    for (const u of unmatched.slice(0, 20)) {
      console.log(`  ${u.proposal_id}  ${u.client_name}  (${u.client_email || "no email"})`)
    }
  }

  if (!APPLY) {
    console.log("\n(dry run — no writes; pass --apply to commit)")
    await c.end()
    return
  }

  if (updates.length === 0) {
    console.log("\nNothing to apply.")
    await c.end()
    return
  }

  console.log(`\nApplying ${updates.length} updates in a single transaction...`)
  await c.query("BEGIN")
  try {
    for (const u of updates) {
      await c.query(
        `UPDATE ignition_proposals SET contact_id = $1, organization_id = $2, updated_at = NOW() WHERE proposal_id = $3`,
        [u.contact_id, u.org_id, u.proposal_id],
      )
    }
    await c.query("COMMIT")
    console.log("Committed.")
  } catch (err) {
    await c.query("ROLLBACK")
    throw err
  }
  await c.end()
}

main().catch((err) => {
  console.error("FAILED:", err.message)
  process.exit(1)
})
