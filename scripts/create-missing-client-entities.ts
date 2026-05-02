/**
 * Auto-creates contacts/organizations for the small set of real clients that
 * appear in work_items and ignition_proposals/ignition_clients but have no
 * matching entity yet. Re-runs the linkage backfill afterward to attach the
 * dependent records.
 *
 * Two categories of new entities:
 *
 *   A. Work-item client groups (5)
 *      Pennington Family, Colorado Tires, WCEF Board of Directors,
 *      The Rokeaches, SEED | Students. Created as organizations because they
 *      represent client groupings rather than individuals. UDI carried over.
 *
 *   B. Ignition proposal clients (3)
 *      Andrew D Castronovo (contact, has email)
 *      Dalton and the Sheriffs (organization, business with email)
 *      Melon Marketing (organization, business with email)
 *
 * Demo seed proposals (~24) without email or ignition_client_id are left
 * untouched — they should be archived manually if not real.
 *
 * Dry-run by default. Pass --apply to commit.
 */

import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

interface Plan {
  table: "organizations" | "contacts"
  identityKey: string
  insertSql: string
  insertParams: any[]
  description: string
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
    /**
     * One row per missing entity. We track the work_item / proposal IDs we
     * intend to link in a second step so we can report and execute the link
     * even when running in dry-run mode (we just won't actually have an `id`
     * to link to).
     */
    const newOrgs: Array<{
      name: string
      udi: string | null
      email: string | null
      contactType: string
      entityType: string | null
      linkWorkItems?: string[]
      linkProposals?: string[]
    }> = [
      {
        name: "Pennington Family",
        udi: "CO_PENNINGTONFAMILY",
        email: null,
        contactType: "Client Household",
        entityType: "Household",
        linkWorkItems: ["wxZFq7WCQFh"],
      },
      {
        name: "Colorado Tires",
        udi: "GROUP_COLORADO_TIRES",
        email: null,
        contactType: "Client",
        entityType: null,
        linkWorkItems: ["2MZ5mk8NSGY9"],
      },
      {
        name: "WCEF Board of Directors",
        udi: "GROUP_WCEF",
        email: null,
        contactType: "Client",
        entityType: "Non-Profit",
        linkWorkItems: ["2RT79MyTTDyp"],
      },
      {
        name: "The Rokeaches",
        udi: "NV_ROKEACH_FAMILY",
        email: null,
        contactType: "Client Household",
        entityType: "Household",
        linkWorkItems: ["3w8DsLMjXJXf"],
      },
      {
        name: "SEED | Students",
        udi: null,
        email: null,
        contactType: "Client",
        entityType: null,
        linkWorkItems: ["4xhDWQV8dkw2"],
      },
      {
        name: "Dalton and the Sheriffs",
        udi: null,
        email: "booking@daltonandthesheriffs.com",
        contactType: "Client",
        entityType: null,
        linkProposals: ["PROP-2728", "PROP-1903", "PROP-2390"],
      },
      {
        name: "Melon Marketing",
        udi: null,
        email: "amira@melonmktg.com",
        contactType: "Client",
        entityType: null,
        // 5 proposals across both "Melon Marketing" and "Melon Marketing (MM)" variants
        linkProposals: ["PROP-1480", "PROP-0704", "PROP-0619", "PROP-1124", "PROP-1122"],
      },
    ]

    const newContacts: Array<{
      fullName: string
      email: string | null
      contactType: string
      linkProposals?: string[]
      ignitionClientId?: string
    }> = [
      {
        fullName: "Andrew D Castronovo",
        email: "andrew.castronovo@zoom.us",
        contactType: "Client",
        linkProposals: ["PROP-1992", "PROP-0406"],
        ignitionClientId: "8135255",
      },
    ]

    // ── Pre-flight: check none of these names already exist ──────────────
    console.log("═══ Pre-flight collision check ═══")
    let collisions = 0
    for (const o of newOrgs) {
      const r = await c.query(
        `SELECT id, name FROM organizations WHERE LOWER(name) = LOWER($1) AND status = 'active' LIMIT 1`,
        [o.name],
      )
      if (r.rows.length > 0) {
        console.log(`  COLLISION: org "${o.name}" already exists (${r.rows[0].id})`)
        collisions++
      }
    }
    for (const ct of newContacts) {
      const r = await c.query(
        `SELECT id, full_name FROM contacts WHERE LOWER(full_name) = LOWER($1) AND COALESCE(status,'active') = 'active' LIMIT 1`,
        [ct.fullName],
      )
      if (r.rows.length > 0) {
        console.log(
          `  COLLISION: contact "${ct.fullName}" already exists (${r.rows[0].id})`,
        )
        collisions++
      }
    }
    if (collisions > 0) {
      throw new Error(`${collisions} entity collision(s) — aborting to avoid duplicates`)
    }
    console.log("  none — safe to create")

    // ── Insert organizations ──────────────────────────────────────────────
    console.log("\n═══ Creating organizations ═══")
    const orgIds = new Map<string, string>()
    for (const o of newOrgs) {
      let orgId = "<dry-run-uuid>"
      if (APPLY) {
        const r = await c.query(
          `INSERT INTO organizations (name, contact_type, entity_type, primary_email, user_defined_identifier, status)
                VALUES ($1, $2, $3, $4, $5, 'active')
                RETURNING id`,
          [o.name, o.contactType, o.entityType, o.email, o.udi],
        )
        orgId = r.rows[0].id
      }
      orgIds.set(o.name, orgId)
      console.log(`  ✓ ${o.name} → ${orgId}`)
    }

    // ── Insert contacts ───────────────────────────────────────────────────
    console.log("\n═══ Creating contacts ═══")
    const contactIds = new Map<string, string>()
    for (const ct of newContacts) {
      let cid = "<dry-run-uuid>"
      if (APPLY) {
        const r = await c.query(
          `INSERT INTO contacts (full_name, primary_email, contact_type, status)
                VALUES ($1, $2, $3, 'active')
                RETURNING id`,
          [ct.fullName, ct.email, ct.contactType],
        )
        cid = r.rows[0].id
      }
      contactIds.set(ct.fullName, cid)
      console.log(`  ✓ ${ct.fullName} → ${cid}`)
    }

    // ── Link work_items ───────────────────────────────────────────────────
    console.log("\n═══ Linking work_items ═══")
    let wiLinks = 0
    for (const o of newOrgs) {
      if (!o.linkWorkItems || o.linkWorkItems.length === 0) continue
      const orgId = orgIds.get(o.name)
      if (!orgId) continue
      for (const key of o.linkWorkItems) {
        if (APPLY) {
          await c.query(
            `UPDATE work_items SET organization_id = $1, updated_at = NOW() WHERE karbon_work_item_key = $2 AND organization_id IS NULL AND contact_id IS NULL`,
            [orgId, key],
          )
        }
        console.log(`  ✓ work_item ${key} → ${o.name}`)
        wiLinks++
      }
    }

    // ── Link ignition_proposals ───────────────────────────────────────────
    console.log("\n═══ Linking ignition_proposals ═══")
    let propLinks = 0
    for (const o of newOrgs) {
      if (!o.linkProposals || o.linkProposals.length === 0) continue
      const orgId = orgIds.get(o.name)
      if (!orgId) continue
      for (const num of o.linkProposals) {
        if (APPLY) {
          await c.query(
            `UPDATE ignition_proposals SET organization_id = $1, updated_at = NOW() WHERE proposal_number = $2 AND organization_id IS NULL AND contact_id IS NULL`,
            [orgId, num],
          )
        }
        console.log(`  ✓ proposal ${num} → ${o.name}`)
        propLinks++
      }
    }
    for (const ct of newContacts) {
      if (!ct.linkProposals || ct.linkProposals.length === 0) continue
      const cid = contactIds.get(ct.fullName)
      if (!cid) continue
      for (const num of ct.linkProposals) {
        if (APPLY) {
          await c.query(
            `UPDATE ignition_proposals SET contact_id = $1, updated_at = NOW() WHERE proposal_number = $2 AND organization_id IS NULL AND contact_id IS NULL`,
            [cid, num],
          )
        }
        console.log(`  ✓ proposal ${num} → ${ct.fullName}`)
        propLinks++
      }
    }

    // ── Link ignition_clients ─────────────────────────────────────────────
    console.log("\n═══ Linking ignition_clients ═══")
    let icLinks = 0
    for (const ct of newContacts) {
      if (!ct.ignitionClientId) continue
      const cid = contactIds.get(ct.fullName)
      if (!cid) continue
      if (APPLY) {
        await c.query(
          `UPDATE ignition_clients
              SET contact_id = $1,
                  match_status = 'auto_matched',
                  match_method = 'manual_entity_creation',
                  match_confidence = 1.0,
                  updated_at = NOW()
            WHERE ignition_client_id = $2`,
          [cid, ct.ignitionClientId],
        )
      }
      console.log(`  ✓ ignition_client ${ct.ignitionClientId} → ${ct.fullName}`)
      icLinks++
    }
    // Also link the org-side ignition_clients (Dalton, Melon)
    const orgEmailToIc: Array<{ name: string; email: string; ic: string }> = [
      { name: "Dalton and the Sheriffs", email: "booking@daltonandthesheriffs.com", ic: "9249110" },
      { name: "Melon Marketing", email: "amira@melonmktg.com", ic: "8489535" },
    ]
    for (const o of orgEmailToIc) {
      const orgId = orgIds.get(o.name)
      if (!orgId) continue
      if (APPLY) {
        await c.query(
          `UPDATE ignition_clients
              SET organization_id = $1,
                  match_status = 'auto_matched',
                  match_method = 'manual_entity_creation',
                  match_confidence = 1.0,
                  updated_at = NOW()
            WHERE ignition_client_id = $2`,
          [orgId, o.ic],
        )
      }
      console.log(`  ✓ ignition_client ${o.ic} → ${o.name}`)
      icLinks++
    }

    console.log(
      `\n═══ Summary: ${newOrgs.length} orgs + ${newContacts.length} contacts created, ${wiLinks} work_items + ${propLinks} proposals + ${icLinks} ignition_clients linked ═══`,
    )

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
