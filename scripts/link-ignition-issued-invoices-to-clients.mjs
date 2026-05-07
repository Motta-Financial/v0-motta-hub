/**
 * Map the 17 unmapped Ignition issued-invoice clients to organizations /
 * contacts. The `import-ignition-issued-invoices.mjs` first pass handled
 * everything resolvable with strict normalized-name lookup (568 of 660
 * invoices). The remaining 58 invoices belong to 17 distinct cli_*
 * IDs whose names need either:
 *
 *   1. A "Last, First" / "First & First Last" parse the importer didn't
 *      cover (handled here via curated alias rules), or
 *   2. A trigram-based fuzzy match against orgs/contacts that we manually
 *      reviewed and approved (e.g. "Matt Pickles" -> "Matthew Pickles",
 *      "Nicholas Adkins" -> "Nick Adkins").
 *
 * Every applied link is annotated with match_method='manual_review' on
 * `ignition_clients` so we can audit the decisions later. Any cli_* the
 * curated table doesn't cover is left as-is (`unmatched`) — it will
 * still show in the AR view, just without a CRM client column.
 *
 * Idempotent: re-running re-applies the same links and won't double-write
 * because we update by primary key on ignition_clients and by FK on
 * ignition_invoices.
 */

import pg from "pg"

// ── Curated mapping table ───────────────────────────────────────────────
// Each entry records WHY the link is correct so a future reviewer doesn't
// have to redo the analysis. `target` is one of:
//   { kind: "organization" | "contact", id: <uuid>, label: <human name> }
// `note` is stamped into ignition_clients.match_notes for audit.
//
// The 4 cli_* IDs we couldn't confidently map (Chris Sherwood, Ana
// Salgado, DJV Inc, Alliance Physical Therapy) are intentionally absent
// — we'd rather leave them visibly unmatched than guess.
const MAPPINGS = [
  // ── Exact-after-normalize matches (the previous import missed these
  // because the importer didn't run `nameVariants` against the stub
  // creation, only the invoice loop). The 6 below come from the
  // structured-name pass.
  {
    cli: "cli_m736k5o4bg2qanaanimq",
    csvName: "Meredith & Cole Chapin",
    target: { kind: "contact", id: "d9c69102-1c65-455d-a986-b33bd0859f10", label: "Cole Chapin" },
    note: "Couple invoice; primary filer is Cole Chapin.",
  },
  {
    cli: "cli_m5atqpn3tuhaapqati2q",
    csvName: "HiveCrux",
    target: { kind: "organization", id: "ed9a4910-7e2b-45ae-b9d5-f262d1c0e76b", label: "HiveCrux LLC" },
    note: "Suffix-only difference (LLC).",
  },
  {
    cli: "cli_m4n7emjyl4taabybt34q",
    csvName: "Earle, Rebecca(Becky)",
    target: { kind: "contact", id: "37b323f7-bc2f-44cd-8ad0-65f1ef750b7a", label: "Rebecca Earle" },
    note: '"Last, First (nickname)" CSV format; matches Rebecca Earle.',
  },
  {
    cli: "cli_m4n7engzahcqabyaypyq",
    csvName: "Matt Coleman Plumbing & Heating Inc",
    target: { kind: "organization", id: "7f8fbdc9-58c1-4e6a-8134-ebd7bc261261", label: "Matt Coleman Plumbing and Heating Inc." },
    note: "Ampersand-vs-and punctuation difference only.",
  },
  {
    cli: "cli_nef2qcfdnylaamibcj5q",
    csvName: "Apex Estimators",
    target: { kind: "organization", id: "c836be70-c014-45b2-8637-53f62dd8c4e3", label: "Apex Estimators, LLC" },
    note: "Suffix-only difference (LLC).",
  },
  {
    cli: "cli_m4n7enn3y4bqabyalnma",
    csvName: "AMMC MOB",
    target: { kind: "organization", id: "ecfe66b7-fe2b-49cf-9fce-16f3819388d8", label: "AMMC MOB LLC" },
    note: "Suffix-only difference (LLC).",
  },
  {
    cli: "cli_m63zzykz3gsaaaial7rq",
    csvName: "Jason Gavan & Vamsi Guntur",
    target: { kind: "contact", id: "db3ebcbc-8cfb-4d8b-af9d-2b1d3fd6e343", label: "Jason Gavan" },
    note: "Joint invoice for two individuals; assigning to first-listed (Jason Gavan). Co-filer Vamsi Guntur is contact e3d6210c-5e06-4b3b-9c20-a63b9a42732d.",
  },

  // ── Trigram-fuzzy matches confirmed by manual review (high similarity
  // + obvious typo / alias). The note explains the variation.
  {
    cli: "cli_ndsbdpvnc5bqajya4ryq",
    csvName: "Advance Therapy",
    target: { kind: "organization", id: "79527dae-c4bf-414e-a95e-be8bfa07e37f", label: "Advance Therapy (Synergy)" },
    note: 'Same business; CRM record carries the dba "(Synergy)" suffix. trgm sim=0.667.',
  },
  {
    cli: "cli_nbbqrk5w74yqaniatwva",
    csvName: "411 Claim Restoration Services, LLC",
    target: { kind: "organization", id: "7db8920b-a2cd-40fb-8693-ffd7f31d2478", label: "411 Claims Restoration Services, LLC" },
    note: 'Same business; "Claim" vs "Claims" plurality only. trgm sim=0.811.',
  },
  {
    cli: "cli_m4r4ftq2xbxaawaagd5a",
    csvName: "Woburn Community Educational Foundation",
    target: { kind: "organization", id: "851a1ef9-088a-45b2-82d5-cb62c4ae4001", label: "Woburn Community Educational Foundation (WCEF)" },
    note: "Same nonprofit; CRM record adds the (WCEF) acronym. trgm sim=0.902.",
  },
  {
    cli: "cli_neojmfkzzy2qasqba7za",
    csvName: "Matt Pickles",
    target: { kind: "contact", id: "89a9976f-1071-4525-8444-d950cdd9c828", label: "Matthew Pickles" },
    note: 'Nickname-vs-formal first name. trgm sim=0.706. No other "Pickles" in the CRM.',
  },
  {
    cli: "cli_ngkknutk6bhqaaibc67q",
    csvName: "Adkins, Nicholas",
    target: { kind: "contact", id: "1f8b6985-056b-40cc-aaec-0eb6ce834ca2", label: "Nick Adkins" },
    note: 'Nickname-vs-formal first name. trgm sim=0.556. Sole "Adkins" contact.',
  },
  {
    cli: "cli_m4n7enguxn3qabya7noa",
    csvName: "TLL Medical",
    target: { kind: "organization", id: "7af07c30-fb6d-4755-8906-b7020bdc6989", label: "TLL Medical Transport Inc." },
    note: 'CRM record carries the full legal name with "Transport Inc." trgm sim=0.480. Sole "TLL" org.',
  },
]

const conn = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!conn) throw new Error("POSTGRES_URL_NON_POOLING is required")

const c = new pg.Client({ connectionString: conn })
await c.connect()

console.log(`Applying ${MAPPINGS.length} curated mappings…\n`)

let clientsUpdated = 0
let invoicesUpdated = 0
const failures = []

await c.query("begin")
try {
  for (const m of MAPPINGS) {
    // 1. Verify the target row still exists. We don't want to silently
    //    write a dangling FK — better to fail loudly so the curator can
    //    re-pick a target.
    const tableForKind = m.target.kind === "organization" ? "organizations" : "contacts"
    const verify = await c.query(
      `select 1 from ${tableForKind} where id = $1`,
      [m.target.id],
    )
    if (verify.rowCount === 0) {
      failures.push({ cli: m.cli, reason: `target ${m.target.kind}/${m.target.id} no longer exists` })
      continue
    }

    // 2. Update the bridge row in `ignition_clients`. We use match_status
    //    'manual_matched' to make these visually distinct from the
    //    auto_matched rows the importer created.
    const upd = await c.query(
      `update ignition_clients
         set organization_id = $2,
             contact_id      = $3,
             match_status    = 'manual_matched',
             match_method    = 'manual_review',
             match_notes     = $4,
             updated_at      = now()
       where ignition_client_id = $1`,
      [
        m.cli,
        m.target.kind === "organization" ? m.target.id : null,
        m.target.kind === "contact" ? m.target.id : null,
        `${m.note} (manually linked to ${m.target.kind} "${m.target.label}")`,
      ],
    )
    if (upd.rowCount === 0) {
      failures.push({ cli: m.cli, reason: "ignition_clients row missing" })
      continue
    }
    clientsUpdated++

    // 3. Backfill all `ignition_invoices` rows that point to this cli_*.
    //    Only touch invoices where the link is currently empty so we
    //    don't overwrite anything an upstream importer already set.
    const invUpd = await c.query(
      `update ignition_invoices
         set organization_id = $2,
             contact_id      = $3,
             updated_at      = now()
       where ignition_client_id = $1
         and organization_id is null
         and contact_id      is null`,
      [
        m.cli,
        m.target.kind === "organization" ? m.target.id : null,
        m.target.kind === "contact" ? m.target.id : null,
      ],
    )
    invoicesUpdated += invUpd.rowCount

    console.log(
      `  ✓ cli=${m.cli} "${m.csvName}" -> ${m.target.kind}/${m.target.id} "${m.target.label}" (${invUpd.rowCount} invoices linked)`,
    )
  }

  await c.query("commit")
} catch (err) {
  await c.query("rollback")
  console.error("Rolled back due to:", err)
  process.exit(1)
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\nApplied ${clientsUpdated} client mappings, linked ${invoicesUpdated} invoices.`)
if (failures.length) {
  console.log("\nFailures (skipped):")
  for (const f of failures) console.log(`  - ${f.cli}: ${f.reason}`)
}

const remain = await c.query(`
  select
    ic.ignition_client_id,
    ic.name,
    count(*) as invoice_count,
    sum(ii.amount)::numeric(12,2) as outstanding_total
  from ignition_invoices ii
  join ignition_clients   ic on ic.ignition_client_id = ii.ignition_client_id
  where ii.ignition_invoice_id like 'ignition:%'
    and ii.organization_id is null
    and ii.contact_id      is null
  group by 1, 2
  order by invoice_count desc
`)
console.log(`\n${remain.rowCount} cli_* still unmapped after this pass:`)
for (const r of remain.rows) {
  console.log(`  cli=${r.ignition_client_id} "${r.name}" (${r.invoice_count} invoices, $${r.outstanding_total})`)
}

const overall = await c.query(`
  select
    case
      when organization_id is not null then 'organization'
      when contact_id      is not null then 'contact'
      else 'unmapped'
    end as link_state,
    count(*) as n,
    sum(amount)::numeric(12,2) as total
  from ignition_invoices where ignition_invoice_id like 'ignition:%'
  group by 1 order by n desc
`)
console.log(`\nFinal mapping state for ignition:% invoices:`)
for (const r of overall.rows) console.log(`  ${r.link_state}: n=${r.n} total=$${r.total}`)

await c.end()
