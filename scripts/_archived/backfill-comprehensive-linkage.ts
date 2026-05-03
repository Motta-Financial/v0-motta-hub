/**
 * Comprehensive linkage backfill — connects every loose thread between
 * contacts, organizations, work_items, and ignition_proposals.
 *
 * Three independent passes, all in one transaction:
 *
 *  1. ignition_clients   → contacts/organizations
 *     Re-runs matching on the 10 currently-unmatched rows using:
 *       - Email exact match (case-insensitive)
 *       - "Last, First" → "First Last" name-reversal
 *
 *  2. ignition_proposals → contacts/organizations
 *     Cascades from ignition_clients (if its ignition_client_id row was just
 *     matched, propagate the FK). Falls back to email + name match when the
 *     proposal has no ignition_client_id at all.
 *
 *  3. work_items         → contacts/organizations
 *     Three sub-strategies for the 65 unlinked rows:
 *       - "Motta*" / "Motta Financial" client_name  → Motta Financial org
 *       - exact contact full_name match (Dat Le, Mark Dwyer, etc.)
 *       - "First & First LastName" group format    → either contact
 *
 * Dry-run by default. Pass --apply to commit.
 */

import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

interface Hit {
  contactId: string | null
  organizationId: string | null
  method: string
}

const norm = (s: string | null | undefined) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const reverseLastFirst = (s: string | null | undefined) => {
  if (!s) return null
  const m = s.match(/^([^,]+),\s*(.+)$/)
  if (!m) return null
  return `${m[2].trim()} ${m[1].trim()}`.replace(/\s+/g, " ").trim()
}

async function main() {
  const url = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL!).replace(
    /sslmode=require/,
    "sslmode=no-verify",
  )
  const c = new Client({ connectionString: url })
  await c.connect()

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`)

  await c.query("BEGIN")

  try {
    // ── Build lookup indexes once ─────────────────────────────────────────
    const orgs = (
      await c.query(
        `SELECT id, name, primary_email FROM organizations WHERE status = 'active'`,
      )
    ).rows
    const contacts = (
      await c.query(
        `SELECT id, full_name, primary_email FROM contacts WHERE COALESCE(status, 'active') = 'active'`,
      )
    ).rows

    const orgsByName = new Map<string, string>()
    const orgsByEmail = new Map<string, string>()
    for (const o of orgs) {
      const n = norm(o.name)
      if (n && !orgsByName.has(n)) orgsByName.set(n, o.id)
      const e = (o.primary_email || "").trim().toLowerCase()
      if (e && !orgsByEmail.has(e)) orgsByEmail.set(e, o.id)
    }

    const contactsByName = new Map<string, string>()
    const contactsByEmail = new Map<string, string>()
    for (const ct of contacts) {
      const n = norm(ct.full_name)
      if (n && !contactsByName.has(n)) contactsByName.set(n, ct.id)
      const e = (ct.primary_email || "").trim().toLowerCase()
      if (e && !contactsByEmail.has(e)) contactsByEmail.set(e, ct.id)
    }

    /**
     * Resolve a name+email to a contact/org. Tries:
     *   1. email match (org first, then contact)
     *   2. exact name match (org first, then contact)
     *   3. reversed "Last, First" name match
     *   4. group-name pattern "First & First LastName" → first contact match
     */
    const resolve = (name: string | null, email: string | null): Hit | null => {
      const e = (email || "").trim().toLowerCase()
      if (e) {
        const o = orgsByEmail.get(e)
        if (o) return { organizationId: o, contactId: null, method: "email" }
        const ct = contactsByEmail.get(e)
        if (ct) return { contactId: ct, organizationId: null, method: "email" }
      }
      const n = norm(name)
      if (n) {
        const o = orgsByName.get(n)
        if (o) return { organizationId: o, contactId: null, method: "name" }
        const ct = contactsByName.get(n)
        if (ct) return { contactId: ct, organizationId: null, method: "name" }
      }
      const reversed = reverseLastFirst(name)
      if (reversed) {
        const rn = norm(reversed)
        const o = orgsByName.get(rn)
        if (o) return { organizationId: o, contactId: null, method: "name_reversed" }
        const ct = contactsByName.get(rn)
        if (ct) return { contactId: ct, organizationId: null, method: "name_reversed" }
      }
      // "First1 & First2 Last" → split off the first name before the ampersand
      if (name && name.includes(" & ")) {
        const parts = name.split(" & ")
        if (parts.length === 2) {
          // Try the second part as-is (often has the surname): "Mark & Kylee Dwyer"
          const p2 = norm(parts[1])
          if (p2) {
            const ct = contactsByName.get(p2)
            if (ct) return { contactId: ct, organizationId: null, method: "group_second" }
          }
          // Try splicing the first name with the last word of the second part
          const last = parts[1].trim().split(/\s+/).slice(-1)[0]
          const p1 = norm(`${parts[0].trim()} ${last}`)
          if (p1) {
            const ct = contactsByName.get(p1)
            if (ct) return { contactId: ct, organizationId: null, method: "group_first" }
          }
        }
      }
      return null
    }

    // ═══ PASS 1: ignition_clients ════════════════════════════════════════
    console.log("═══ PASS 1: ignition_clients ═══")
    const unmatchedClients = (
      await c.query(
        `SELECT ignition_client_id, name, email
           FROM ignition_clients
          WHERE match_status = 'unmatched'`,
      )
    ).rows
    console.log(`  ${unmatchedClients.length} unmatched ignition_clients`)

    let icMatched = 0
    const icUpdates: Array<[string, string, string | null, string | null, string]> = []
    for (const ic of unmatchedClients) {
      const hit = resolve(ic.name, ic.email)
      if (hit) {
        icMatched++
        icUpdates.push([
          ic.ignition_client_id,
          ic.name,
          hit.contactId,
          hit.organizationId,
          hit.method,
        ])
        console.log(
          `  match: [${ic.ignition_client_id}] ${ic.name} → ${
            hit.organizationId ? `org=${hit.organizationId}` : `contact=${hit.contactId}`
          } via ${hit.method}`,
        )
      }
    }

    if (APPLY) {
      for (const [id, , contactId, orgId, method] of icUpdates) {
        await c.query(
          `UPDATE ignition_clients
              SET contact_id = $2,
                  organization_id = $3,
                  match_status = 'auto_matched',
                  match_method = $4,
                  match_confidence = 0.85,
                  updated_at = NOW()
            WHERE ignition_client_id = $1`,
          [id, contactId, orgId, method],
        )
      }
    }
    console.log(`  → newly matched: ${icMatched}`)

    // ═══ PASS 2: ignition_proposals ═════════════════════════════════════
    console.log("\n═══ PASS 2: ignition_proposals ═══")

    // Build the client→FK map from the DB AND merge in PASS 1's pending
    // matches, so dry-run accurately predicts what apply mode will cascade.
    const icMap = new Map<string, { contactId: string | null; orgId: string | null }>()
    for (const r of (
      await c.query(
        `SELECT ignition_client_id, contact_id, organization_id
           FROM ignition_clients
          WHERE contact_id IS NOT NULL OR organization_id IS NOT NULL`,
      )
    ).rows) {
      icMap.set(r.ignition_client_id, {
        contactId: r.contact_id,
        orgId: r.organization_id,
      })
    }
    for (const [id, , contactId, orgId] of icUpdates) {
      icMap.set(id, { contactId, orgId })
    }

    const unlinkedProps = (
      await c.query(
        `SELECT proposal_id, proposal_number, client_name, client_email, ignition_client_id
           FROM ignition_proposals
          WHERE organization_id IS NULL AND contact_id IS NULL`,
      )
    ).rows
    console.log(`  ${unlinkedProps.length} unlinked ignition_proposals`)

    let propCascade = 0
    let propResolve = 0
    const propUpdates: Array<[string, string | null, string | null]> = []
    for (const p of unlinkedProps) {
      let contactId: string | null = null
      let orgId: string | null = null

      // Cascade from ignition_clients first
      if (p.ignition_client_id && icMap.has(p.ignition_client_id)) {
        const fk = icMap.get(p.ignition_client_id)!
        contactId = fk.contactId
        orgId = fk.orgId
        if (contactId || orgId) propCascade++
      }

      // Fall back to direct resolution
      if (!contactId && !orgId) {
        const hit = resolve(p.client_name, p.client_email)
        if (hit) {
          contactId = hit.contactId
          orgId = hit.organizationId
          propResolve++
        }
      }

      if (contactId || orgId) {
        propUpdates.push([p.proposal_id, contactId, orgId])
      }
    }

    if (APPLY && propUpdates.length > 0) {
      for (const [id, contactId, orgId] of propUpdates) {
        await c.query(
          `UPDATE ignition_proposals
              SET contact_id = $2, organization_id = $3, updated_at = NOW()
            WHERE proposal_id = $1`,
          [id, contactId, orgId],
        )
      }
    }
    console.log(
      `  → cascaded: ${propCascade}, directly resolved: ${propResolve}, total: ${propUpdates.length}`,
    )

    // ═══ PASS 3: work_items ═════════════════════════════════════════════
    console.log("\n═══ PASS 3: work_items ═══")

    // Find the Motta Financial org once for internal work items
    const mottaRow = (
      await c.query(
        `SELECT id, name FROM organizations
          WHERE LOWER(name) IN ('motta financial', 'motta financial inc', 'motta financial llc')
             OR LOWER(name) = 'motta'
          ORDER BY (CASE WHEN LOWER(name) = 'motta financial' THEN 0 ELSE 1 END), name
          LIMIT 1`,
      )
    ).rows[0]
    const mottaOrgId: string | null = mottaRow?.id || null
    if (mottaOrgId) {
      console.log(`  Motta Financial org → ${mottaRow.name} (${mottaOrgId})`)
    } else {
      console.log("  WARNING: no Motta Financial org found")
    }

    const unlinkedWi = (
      await c.query(
        `SELECT karbon_work_item_key, client_name, user_defined_identifier, title
           FROM work_items
          WHERE deleted_in_karbon_at IS NULL
            AND organization_id IS NULL
            AND contact_id IS NULL`,
      )
    ).rows
    console.log(`  ${unlinkedWi.length} unlinked work_items`)

    let wiMotta = 0
    let wiResolve = 0
    let wiUdi = 0
    const wiUpdates: Array<[string, string | null, string | null, string]> = []
    const stillUnlinked: typeof unlinkedWi = []

    for (const wi of unlinkedWi) {
      const cn = (wi.client_name || "").trim()
      const cnLower = cn.toLowerCase()

      // Strategy A: firm-internal "Motta" rows
      if (
        mottaOrgId &&
        (cnLower === "motta" ||
          cnLower === "motta financial" ||
          cnLower.startsWith("motta |") ||
          cnLower.startsWith("motta india"))
      ) {
        wiUpdates.push([wi.karbon_work_item_key, null, mottaOrgId, "motta_internal"])
        wiMotta++
        continue
      }

      // Strategy B: UDI-based match (if any)
      if (wi.user_defined_identifier) {
        const udi = wi.user_defined_identifier
        const udiOrg = (
          await c.query(
            `SELECT id FROM organizations WHERE user_defined_identifier = $1 AND status = 'active' LIMIT 1`,
            [udi],
          )
        ).rows[0]
        const udiContact = (
          await c.query(
            `SELECT id FROM contacts WHERE user_defined_identifier = $1 AND COALESCE(status,'active') = 'active' LIMIT 1`,
            [udi],
          )
        ).rows[0]
        if (udiOrg || udiContact) {
          wiUpdates.push([
            wi.karbon_work_item_key,
            udiContact?.id || null,
            udiOrg?.id || null,
            "udi",
          ])
          wiUdi++
          continue
        }
      }

      // Strategy C: name-based resolution
      const hit = resolve(cn, null)
      if (hit) {
        wiUpdates.push([
          wi.karbon_work_item_key,
          hit.contactId,
          hit.organizationId,
          hit.method,
        ])
        wiResolve++
        continue
      }

      stillUnlinked.push(wi)
    }

    if (APPLY && wiUpdates.length > 0) {
      for (const [key, contactId, orgId] of wiUpdates) {
        await c.query(
          `UPDATE work_items
              SET contact_id = COALESCE(contact_id, $2),
                  organization_id = COALESCE(organization_id, $3),
                  updated_at = NOW()
            WHERE karbon_work_item_key = $1`,
          [key, contactId, orgId],
        )
      }
    }
    console.log(
      `  → motta: ${wiMotta}, udi: ${wiUdi}, name/email: ${wiResolve}, total: ${wiUpdates.length}`,
    )
    console.log(`  → still unlinked: ${stillUnlinked.length}`)
    if (stillUnlinked.length > 0) {
      console.log("\n  Still unlinked (expected — no matching entity exists):")
      for (const r of stillUnlinked) {
        console.log(
          `    ${r.karbon_work_item_key} | client="${r.client_name}" | UDI=${
            r.user_defined_identifier || "(none)"
          }`,
        )
      }
    }

    // ═══ COMMIT ═════════════════════════════════════════════════════════
    if (APPLY) {
      await c.query("COMMIT")
      console.log("\n✓ Committed.")
    } else {
      await c.query("ROLLBACK")
      console.log("\n(dry-run — rolled back. Re-run with --apply to commit.)")
    }
  } catch (e) {
    await c.query("ROLLBACK")
    console.error("FAIL — rolled back:", e)
    process.exit(1)
  } finally {
    await c.end()
  }
}

main()
