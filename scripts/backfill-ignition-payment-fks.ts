/**
 * Backfill ignition_payments.contact_id and .organization_id from the
 * parent ignition_clients row.
 *
 * Why this exists
 * ───────────────
 * The webhook that ingests Ignition payments populates `contact_id`
 * and `organization_id` only when the linked `ignition_clients` row
 * was already matched at the moment the payment arrived. For payments
 * that arrived first and got matched later (or were imported from
 * HubSpot before matching ran), the FK columns are NULL.
 *
 * Right now 1,372 of 1,534 payment rows (89%) are unreachable from
 * contact/org queries even though the parent `ignition_clients` row
 * has the FK filled. This script copies the FK down so per-client
 * payment queries on the profile page work correctly. Run idempotently;
 * subsequent runs skip rows already filled.
 *
 * We only handle ignition_payments here. The sibling
 * ignition_payment_transactions table lacks an `ignition_client_id`
 * column (transactions link to clients via email/work_item_id), so
 * it needs its own — different — backfill path. With only 3 rows in
 * that table today it's not worth one yet.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-ignition-payment-fks.ts            # dry-run
 *   pnpm exec tsx scripts/backfill-ignition-payment-fks.ts --apply    # writes
 */
import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

async function backfillOne(client: Client, table: string) {
  // Count rows that would be filled. The CTE shape is the same for
  // both tables; only the table name varies.
  const { rows: preview } = await client.query<{
    candidates: number
    will_set_contact: number
    will_set_org: number
  }>(`
    with candidates as (
      select p.ignition_client_id, ic.contact_id, ic.organization_id
      from public.${table} p
      join public.ignition_clients ic
        on ic.ignition_client_id = p.ignition_client_id
      where (p.contact_id is null and ic.contact_id is not null)
         or (p.organization_id is null and ic.organization_id is not null)
    )
    select
      count(*)::int as candidates,
      count(*) filter (where contact_id is not null)::int as will_set_contact,
      count(*) filter (where organization_id is not null)::int as will_set_org
    from candidates
  `)
  const p = preview[0]
  console.log(
    `  ${table}: ${p.candidates} rows to update (contact=${p.will_set_contact}, org=${p.will_set_org})`,
  )
  if (!APPLY || p.candidates === 0) return 0

  // Issue the actual update. We deliberately copy contact_id and
  // organization_id INDEPENDENTLY because a payment's parent client
  // may only have one of the two filled — the COALESCE preserves
  // whichever FK is already set on the payment row.
  const res = await client.query(`
    update public.${table} p
    set
      contact_id      = coalesce(p.contact_id,      ic.contact_id),
      organization_id = coalesce(p.organization_id, ic.organization_id)
    from public.ignition_clients ic
    where ic.ignition_client_id = p.ignition_client_id
      and (
        (p.contact_id is null and ic.contact_id is not null)
        or (p.organization_id is null and ic.organization_id is not null)
      )
  `)
  return res.rowCount ?? 0
}

async function main() {
  const conn = process.env.POSTGRES_URL_NON_POOLING
  if (!conn) {
    console.error("POSTGRES_URL_NON_POOLING is not set")
    process.exit(1)
  }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    console.log(APPLY ? "Mode: APPLY (writes)" : "Mode: DRY-RUN (no writes)")
    console.log()
    console.log("Plan:")
    if (APPLY) {
      await client.query("BEGIN")
      try {
        const n = await backfillOne(client, "ignition_payments")
        await client.query("COMMIT")
        console.log()
        console.log(`Committed. Updated ${n} payment rows.`)
      } catch (err) {
        await client.query("ROLLBACK")
        console.error("Transaction rolled back:", err)
        process.exit(2)
      }
    } else {
      await backfillOne(client, "ignition_payments")
      console.log()
      console.log("Dry run complete. Re-run with --apply to write.")
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
