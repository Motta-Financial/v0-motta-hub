/**
 * Audit: Recurring Revenue Dashboard vs new ignition_proposal_services import
 * ──────────────────────────────────────────────────────────────────────────
 * The dashboard at /sales/recurring-revenue currently bypasses the
 * normalized `ignition_proposal_services` table because the historical
 * sync dropped rows for ~460 active proposals. It re-parses
 * `ignition_proposals.payload.services` JSON on every request.
 *
 * The team says the import is now complete. This script verifies that
 * claim by computing parity metrics between:
 *   • Source A: payload.services JSON (what the dashboard reads today)
 *   • Source B: ignition_proposal_services table (the new import target)
 *
 * Output sections:
 *   1. Coverage   — how many active proposals are missing from the table
 *   2. Line count — payload service count vs normalized row count
 *   3. MRR parity — current MRR using A vs B, per department
 *   4. Field readiness — does Source B carry everything the dashboard needs
 *      (specifically billing_events for the discounted-rate calculation)
 *   5. Top discrepancies — the worst offenders for manual review
 *
 * Read-only. Safe to re-run. No code changes here.
 */

import { createClient } from "@supabase/supabase-js"
import {
  classifyService,
  effectiveBillingFrequency,
  extractPayloadServices,
  normalizeBillingFrequency,
} from "../lib/sales/ignition-recurring.ts"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

const ACCEPTED_STATUSES = ["accepted", "completed"]

function fmt(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)
}

function pct(n, d) {
  if (!d) return "—"
  return `${((n / d) * 100).toFixed(1)}%`
}

// ── 1. Pull every active proposal with its payload ─────────────────────────
async function fetchActiveProposals() {
  const rows = []
  const PAGE = 500
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("ignition_proposals")
      .select(
        "proposal_id, proposal_number, client_name, status, accepted_at, payload",
      )
      .is("archived_at", null)
      .is("revoked_at", null)
      .is("lost_at", null)
      .not("accepted_at", "is", null)
      .in("status", ACCEPTED_STATUSES)
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < PAGE) break
    if (offset > 20000) break
  }
  return rows
}

// ── 2. Pull all normalized services for those proposals ────────────────────
async function fetchNormalizedServices(proposalIds) {
  const rows = []
  const PAGE = 500
  // Supabase .in() handles arbitrarily-long arrays but we keep batches
  // small so individual responses stay under the 1k row cap.
  for (let i = 0; i < proposalIds.length; i += 200) {
    const slice = proposalIds.slice(i, i + 200)
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("ignition_proposal_services")
        .select(
          "proposal_id, service_name, billing_frequency, billing_type, quantity, unit_price, total_amount, raw_payload",
        )
        .in("proposal_id", slice)
        .range(offset, offset + PAGE - 1)
      if (error) throw error
      const chunk = data ?? []
      rows.push(...chunk)
      if (chunk.length < PAGE) break
    }
  }
  return rows
}

// ── 3. Compute MRR contributions ───────────────────────────────────────────
//
// Replicates the dashboard's logic so the comparison is apples-to-apples.
function monthlyFromPeriodRate(freq, rate) {
  if (rate <= 0) return 0
  if (freq === "monthly") return rate
  if (freq === "quarterly") return rate / 3
  return 0
}

function periodRateFromNormalized(svc) {
  // Mirror servicePeriodRate but for a normalized row. The table's
  // raw_payload may carry billing_events (preferred) — if not, fall back
  // to unit_price × quantity. Same precedence the dashboard uses today.
  const total = Number(svc.total_amount) || 0
  const events = Number(svc.raw_payload?.billing_events)
  if (total > 0 && events > 0) return total / events
  const unit = Number(svc.unit_price) || 0
  const qty = Number(svc.quantity) || 1
  return unit * qty
}

function periodRateFromPayloadService(svc) {
  // PayloadService already carries period_rate (minimum_period_value ×
  // quantity), computed during extractPayloadServices.
  return svc.period_rate
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("Fetching active proposals…")
  const proposals = await fetchActiveProposals()
  console.log(`  ${proposals.length} active proposals`)

  const proposalIds = proposals.map((p) => p.proposal_id)
  console.log("Fetching normalized services…")
  const normalized = await fetchNormalizedServices(proposalIds)
  console.log(`  ${normalized.length} normalized service rows`)

  // Index normalized rows by proposal_id
  const normByProposal = new Map()
  for (const s of normalized) {
    const arr = normByProposal.get(s.proposal_id) ?? []
    arr.push(s)
    normByProposal.set(s.proposal_id, arr)
  }

  // ── 1. Coverage ──────────────────────────────────────────────────────────
  let propsWithPayloadServices = 0
  let propsWithNormalizedServices = 0
  let propsMissingFromNormalized = 0
  let propsExtraInNormalized = 0
  const missingExamples = []

  for (const p of proposals) {
    const payloadSvcs = extractPayloadServices(p.payload)
    const normSvcs = normByProposal.get(p.proposal_id) ?? []
    const hasPayload = payloadSvcs.length > 0
    const hasNorm = normSvcs.length > 0
    if (hasPayload) propsWithPayloadServices += 1
    if (hasNorm) propsWithNormalizedServices += 1
    if (hasPayload && !hasNorm) {
      propsMissingFromNormalized += 1
      if (missingExamples.length < 10) {
        missingExamples.push({
          proposal_number: p.proposal_number,
          proposal_id: p.proposal_id,
          client_name: p.client_name,
          payload_service_count: payloadSvcs.length,
        })
      }
    }
    if (!hasPayload && hasNorm) propsExtraInNormalized += 1
  }

  console.log("\n=== 1. COVERAGE ===")
  console.log(`Active proposals total:           ${proposals.length}`)
  console.log(
    `  with services in payload.services: ${propsWithPayloadServices} (${pct(propsWithPayloadServices, proposals.length)})`,
  )
  console.log(
    `  with rows in ignition_proposal_services: ${propsWithNormalizedServices} (${pct(propsWithNormalizedServices, proposals.length)})`,
  )
  console.log(
    `  MISSING from normalized (payload has, table has none): ${propsMissingFromNormalized}`,
  )
  console.log(
    `  EXTRA in normalized (table has, payload has none):     ${propsExtraInNormalized}`,
  )
  if (missingExamples.length) {
    console.log("\n  Sample of proposals still missing from normalized table:")
    for (const m of missingExamples) {
      console.log(
        `    - ${m.proposal_number ?? "(no #)"}  ${m.client_name ?? "(no client)"}  proposal_id=${m.proposal_id}  payload_services=${m.payload_service_count}`,
      )
    }
  }

  // ── 2. Line counts ───────────────────────────────────────────────────────
  let totalPayloadLines = 0
  let totalNormLines = 0
  let countMismatchCount = 0
  const countMismatches = []
  for (const p of proposals) {
    const payloadSvcs = extractPayloadServices(p.payload)
    const normSvcs = normByProposal.get(p.proposal_id) ?? []
    totalPayloadLines += payloadSvcs.length
    totalNormLines += normSvcs.length
    if (payloadSvcs.length > 0 && payloadSvcs.length !== normSvcs.length) {
      countMismatchCount += 1
      if (countMismatches.length < 10) {
        countMismatches.push({
          proposal_number: p.proposal_number,
          client_name: p.client_name,
          payload_count: payloadSvcs.length,
          norm_count: normSvcs.length,
        })
      }
    }
  }
  console.log("\n=== 2. LINE COUNTS ===")
  console.log(`Service lines in payload.services:        ${totalPayloadLines}`)
  console.log(`Rows in ignition_proposal_services:       ${totalNormLines}`)
  console.log(`Proposals with mismatched line counts:    ${countMismatchCount}`)
  if (countMismatches.length) {
    console.log("\n  Sample of line-count mismatches:")
    for (const m of countMismatches) {
      console.log(
        `    - ${m.proposal_number ?? "(no #)"}  ${m.client_name ?? "(no client)"}  payload=${m.payload_count} vs normalized=${m.norm_count}`,
      )
    }
  }

  // ── 3. MRR parity, per department ────────────────────────────────────────
  const mrrPayload = { Accounting: 0, Tax: 0 }
  const mrrNorm = { Accounting: 0, Tax: 0 }
  const oneTimePayload = { Accounting: 0, Tax: 0 }
  const oneTimeNorm = { Accounting: 0, Tax: 0 }

  for (const p of proposals) {
    // A — payload
    for (const svc of extractPayloadServices(p.payload)) {
      const cls = classifyService(svc.name)
      const freq = effectiveBillingFrequency(svc.raw_cadence, cls.department)
      const m = monthlyFromPeriodRate(freq, periodRateFromPayloadService(svc))
      mrrPayload[cls.department] += m
      if (freq === "one-time") {
        oneTimePayload[cls.department] +=
          svc.contract_amount > 0 ? svc.contract_amount : svc.period_rate
      }
    }
    // B — normalized
    for (const svc of normByProposal.get(p.proposal_id) ?? []) {
      const cls = classifyService(svc.service_name)
      const freq = effectiveBillingFrequency(
        // Normalized table stores billing_frequency directly. Run it
        // through the same normalizer so e.g. "Every month" matches.
        normalizeBillingFrequency(svc.billing_frequency),
        cls.department,
      )
      const m = monthlyFromPeriodRate(freq, periodRateFromNormalized(svc))
      mrrNorm[cls.department] += m
      if (freq === "one-time") {
        const periodRate = periodRateFromNormalized(svc)
        const total = Number(svc.total_amount) || 0
        oneTimeNorm[cls.department] += total > 0 ? total : periodRate
      }
    }
  }

  console.log("\n=== 3. MRR / ONE-TIME PARITY ===")
  for (const dept of ["Accounting", "Tax"]) {
    const a = mrrPayload[dept]
    const b = mrrNorm[dept]
    const delta = b - a
    console.log(
      `${dept.padEnd(10)} MRR  payload=${fmt(a).padStart(10)}  normalized=${fmt(b).padStart(10)}  Δ=${(delta >= 0 ? "+" : "") + fmt(delta)} (${pct(Math.abs(delta), a)})`,
    )
  }
  for (const dept of ["Accounting", "Tax"]) {
    const a = oneTimePayload[dept]
    const b = oneTimeNorm[dept]
    const delta = b - a
    console.log(
      `${dept.padEnd(10)} OT   payload=${fmt(a).padStart(10)}  normalized=${fmt(b).padStart(10)}  Δ=${(delta >= 0 ? "+" : "") + fmt(delta)}`,
    )
  }

  // ── 4. Field readiness ───────────────────────────────────────────────────
  // Critical: the dashboard relies on total_amount / billing_events to
  // recover the true discounted per-period rate. Without billing_events
  // (or unit_price reflecting the discount), normalized MRR will overstate
  // discounted engagements.
  let withBillingEvents = 0
  let withoutBillingEventsButRecurring = 0
  const eventMissingExamples = []
  for (const s of normalized) {
    const freq = normalizeBillingFrequency(s.billing_frequency)
    const events = Number(s.raw_payload?.billing_events)
    if (events > 0) withBillingEvents += 1
    else if (freq === "monthly" || freq === "quarterly") {
      withoutBillingEventsButRecurring += 1
      if (eventMissingExamples.length < 8) {
        eventMissingExamples.push({
          proposal_id: s.proposal_id,
          service_name: s.service_name,
          freq,
          unit_price: s.unit_price,
          total_amount: s.total_amount,
        })
      }
    }
  }
  console.log("\n=== 4. FIELD READINESS ===")
  console.log(
    `Normalized rows with billing_events in raw_payload:        ${withBillingEvents} / ${normalized.length}`,
  )
  console.log(
    `Recurring rows MISSING billing_events (rate falls back to unit_price): ${withoutBillingEventsButRecurring}`,
  )
  if (eventMissingExamples.length) {
    console.log(
      "\n  Recurring rows that would fall back to unit_price (may over-state MRR if discounts exist):",
    )
    for (const e of eventMissingExamples) {
      console.log(
        `    - ${e.service_name}  freq=${e.freq}  unit=${e.unit_price}  total=${e.total_amount}  proposal=${e.proposal_id}`,
      )
    }
  }

  // ── 5. Top per-proposal MRR discrepancies ────────────────────────────────
  const perProposal = []
  for (const p of proposals) {
    let a = 0
    let b = 0
    for (const svc of extractPayloadServices(p.payload)) {
      const cls = classifyService(svc.name)
      const freq = effectiveBillingFrequency(svc.raw_cadence, cls.department)
      a += monthlyFromPeriodRate(freq, periodRateFromPayloadService(svc))
    }
    for (const svc of normByProposal.get(p.proposal_id) ?? []) {
      const cls = classifyService(svc.service_name)
      const freq = effectiveBillingFrequency(
        normalizeBillingFrequency(svc.billing_frequency),
        cls.department,
      )
      b += monthlyFromPeriodRate(freq, periodRateFromNormalized(svc))
    }
    const delta = b - a
    if (Math.abs(delta) >= 50) {
      perProposal.push({
        proposal_number: p.proposal_number,
        client_name: p.client_name,
        payload_mrr: a,
        norm_mrr: b,
        delta,
      })
    }
  }
  perProposal.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  console.log("\n=== 5. TOP PER-PROPOSAL MRR DISCREPANCIES (|Δ| ≥ $50) ===")
  console.log(
    `Proposals with material MRR delta between sources: ${perProposal.length}`,
  )
  for (const row of perProposal.slice(0, 20)) {
    console.log(
      `  ${row.proposal_number ?? "(no #)".padEnd(10)}  ${(row.client_name ?? "(no client)").padEnd(40).slice(0, 40)}  payload=${fmt(row.payload_mrr).padStart(9)}  norm=${fmt(row.norm_mrr).padStart(9)}  Δ=${(row.delta >= 0 ? "+" : "") + fmt(row.delta)}`,
    )
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  console.log("\n=== VERDICT ===")
  const coverageOk = propsMissingFromNormalized === 0
  const countOk = countMismatchCount === 0
  const mrrDelta =
    Math.abs(mrrPayload.Accounting + mrrPayload.Tax - mrrNorm.Accounting - mrrNorm.Tax) /
    Math.max(1, mrrPayload.Accounting + mrrPayload.Tax)
  const mrrOk = mrrDelta < 0.005 // within 0.5%
  console.log(`Coverage: ${coverageOk ? "OK" : "MISSING " + propsMissingFromNormalized + " proposals"}`)
  console.log(`Line counts: ${countOk ? "OK" : countMismatchCount + " proposals mismatch"}`)
  console.log(`Total MRR delta: ${(mrrDelta * 100).toFixed(2)}% ${mrrOk ? "(within tolerance)" : "(out of tolerance)"}`)
  console.log(
    `Field readiness: ${withoutBillingEventsButRecurring === 0 ? "OK" : withoutBillingEventsButRecurring + " recurring rows missing billing_events"}`,
  )
  if (coverageOk && countOk && mrrOk && withoutBillingEventsButRecurring === 0) {
    console.log(
      "\n✓ Safe to switch /api/sales/recurring-revenue to read from ignition_proposal_services.",
    )
  } else {
    console.log(
      "\n✗ Not yet safe to switch. See discrepancies above before refactoring.",
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
