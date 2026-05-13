/**
 * One-shot backfill: populate `ignition_proposal_services` from the
 * `raw_payload.services` JSON we already have on every row in
 * `ignition_proposals`.
 *
 * Why: prior to today's sync.ts change, the proposals sync only wrote
 * the parent proposal row and threw away the `services[]` array on the
 * Ignition Reporting API response. Result: 891 active proposals had
 * 2,299 line items in their payloads but only 457 (across 198 props)
 * actually landed in the normalized table. The new sync writes them on
 * every run going forward — this script catches us up on the historical
 * 2,299 lines without paying for a full backfill against the rate-
 * limited Reporting API.
 *
 * Strategy: per proposal, DELETE existing rows then INSERT fresh ones
 * built from the payload. Idempotent — safe to re-run.
 *
 * Usage:
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     scripts/backfill-proposal-services-from-payload.mjs
 */

import pg from "pg"

const url = (process.env.POSTGRES_URL_NON_POOLING || "")
  .replace(/([?&])sslmode=[^&]+&?/g, "$1")
  .replace(/[?&]$/, "")
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

function pick(obj, ...keys) {
  if (!obj) return null
  for (const k of keys) {
    const v = k.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj)
    if (v !== null && v !== undefined) return v
  }
  return null
}
const pickStr = (o, ...k) => {
  const v = pick(o, ...k)
  return v == null ? null : String(v)
}
const pickNum = (o, ...k) => {
  const v = pick(o, ...k)
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const pickBool = (o, ...k) => {
  const v = pick(o, ...k)
  if (v == null) return null
  if (typeof v === "boolean") return v
  if (v === "true" || v === 1 || v === "1") return true
  if (v === "false" || v === 0 || v === "0") return false
  return null
}

function normalizeCadence(s) {
  if (!s) return null
  const v = String(s).toLowerCase()
  if (/month/.test(v)) return "monthly"
  if (/quarter/.test(v)) return "quarterly"
  if (/week/.test(v)) return "weekly"
  if (/year|annual/.test(v)) return "annually"
  if (/once|onetime|one-time|one_off/.test(v)) return "one-time"
  return v
}

function buildRow(proposalId, raw, ordinal, knownServiceIds) {
  if (!raw || typeof raw !== "object") return null
  const serviceSlug = pickStr(raw, "service_slug")
  const cadence = pickStr(raw, "billing.schedules.0.cadence")
  const recurrence = pickStr(raw, "billing.schedules.0.recurrence")
  const isRecurring = pickBool(raw, "billing.is_recurring") === true
  const billingFrequency = isRecurring
    ? normalizeCadence(cadence) ?? normalizeCadence(recurrence) ?? "monthly"
    : "one-time"
  const periodValue =
    pickNum(raw, "pricing.minimum_period_value.amount") ??
    pickNum(raw, "billing.schedules.0.minimum_period_value.amount")
  const contractValue =
    pickNum(raw, "pricing.minimum_contract_value.amount") ??
    pickNum(raw, "billing.schedules.0.minimum_contract_value.amount")
  const quantity = pickNum(raw, "pricing.quantity") ?? 1
  const currency =
    pickStr(raw, "pricing.currency") ??
    pickStr(raw, "billing.schedules.0.currency") ??
    pickStr(raw, "billing.schedules.0.minimum_period_value.currency") ??
    null
  return {
    proposal_id: proposalId,
    ignition_service_id:
      serviceSlug && knownServiceIds.has(serviceSlug) ? serviceSlug : null,
    service_name: pickStr(raw, "name") ?? "(unnamed service)",
    description: pickStr(raw, "description"),
    quantity,
    unit_price: periodValue,
    total_amount: contractValue,
    currency,
    billing_frequency: billingFrequency,
    billing_type: pickStr(raw, "billing.mode"),
    status:
      pickBool(raw, "is_selected_for_acceptance") === false ? "deselected" : "active",
    // Strict loop index — some proposals have duplicate `position`
    // values which would collide on the unique index.
    ordinal,
    raw_payload: raw,
  }
}

// Load the catalog of known service slugs so we can null any FK that
// would otherwise dangle.
const svcCatalog = await client.query(
  `SELECT ignition_service_id FROM ignition_services`,
)
const knownServiceIds = new Set(
  svcCatalog.rows.map((r) => r.ignition_service_id),
)
console.log(`[backfill] known ignition_services: ${knownServiceIds.size}`)

// Read proposals in batches. Filter to only those that have services in
// their payload — no point processing the 20 proposals without any.
const props = await client.query(`
  SELECT proposal_id, raw_payload
  FROM ignition_proposals
  WHERE raw_payload IS NOT NULL
    AND jsonb_typeof(raw_payload->'services') = 'array'
    AND (CASE WHEN jsonb_typeof(raw_payload->'services') = 'array'
              THEN jsonb_array_length(raw_payload->'services')
              ELSE 0 END) > 0
`)
console.log(`[backfill] proposals with payload services: ${props.rows.length}`)

let processed = 0
let totalInserted = 0
let totalDeleted = 0
let skipped = 0

for (const p of props.rows) {
  const services = Array.isArray(p.raw_payload?.services) ? p.raw_payload.services : []
  if (services.length === 0) {
    skipped += 1
    continue
  }
  const rows = services
    .map((svc, idx) => buildRow(p.proposal_id, svc, idx, knownServiceIds))
    .filter(Boolean)

  await client.query("BEGIN")
  try {
    const del = await client.query(
      `DELETE FROM ignition_proposal_services WHERE proposal_id = $1`,
      [p.proposal_id],
    )
    totalDeleted += del.rowCount
    if (rows.length > 0) {
      // Multi-row INSERT — postgres parameter list packing.
      const cols = [
        "proposal_id",
        "ignition_service_id",
        "service_name",
        "description",
        "quantity",
        "unit_price",
        "total_amount",
        "currency",
        "billing_frequency",
        "billing_type",
        "status",
        "ordinal",
        "raw_payload",
      ]
      const placeholders = []
      const values = []
      rows.forEach((r, i) => {
        const base = i * cols.length
        placeholders.push(
          "(" + cols.map((_, j) => `$${base + j + 1}`).join(",") + ")",
        )
        values.push(
          r.proposal_id,
          r.ignition_service_id,
          r.service_name,
          r.description,
          r.quantity,
          r.unit_price,
          r.total_amount,
          r.currency,
          r.billing_frequency,
          r.billing_type,
          r.status,
          r.ordinal,
          r.raw_payload,
        )
      })
      const sql = `INSERT INTO ignition_proposal_services (${cols.join(",")}) VALUES ${placeholders.join(",")}`
      const res = await client.query(sql, values)
      totalInserted += res.rowCount
    }
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK")
    console.warn(`[backfill] proposal ${p.proposal_id} failed:`, e.message)
  }
  processed += 1
  if (processed % 100 === 0) {
    console.log(
      `[backfill] processed ${processed}/${props.rows.length} (inserted ${totalInserted}, deleted ${totalDeleted})`,
    )
  }
}

console.log(
  `[backfill] DONE — processed ${processed}, skipped ${skipped}, deleted ${totalDeleted}, inserted ${totalInserted}`,
)

const after = await client.query(`
  SELECT
    COUNT(*) AS total_rows,
    COUNT(DISTINCT proposal_id) AS proposals_covered
  FROM ignition_proposal_services
`)
console.log(`[backfill] final state:`, after.rows[0])

await client.end()
