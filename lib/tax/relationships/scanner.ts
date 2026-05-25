/**
 * Tax Client Relationship — scorer + scanner.
 *
 * The scorer rolls a flat list of `RawSignal` (from extractors) into
 * deduped `(relationship, signal[])` pairs and decides each
 * relationship's confidence + status using the policy defined in
 * `types.ts`. The scanner orchestrates: it pulls peers/cells/hub
 * fallback rows from Supabase, runs all three extractors, scores, and
 * upserts.
 *
 * Idempotency: every (individual, business, relationship_type) tuple
 * is unique (DB constraint). Re-running the scanner replaces the
 * latest scoring on an existing relationship without losing history —
 * old `tax_client_relationship_signals` rows are kept (they're an
 * append-only audit log).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { RelationshipDirection, RelationshipType, SignalKind } from "./types"
import {
  AUTO_CONFIRM_THRESHOLD,
  REVIEW_THRESHOLD,
  SIGNAL_WEIGHTS,
} from "./types"
import {
  buildCandidateIndex,
  extractFromBusinessReturn,
  extractFromHubFallback,
  extractFromIndividualReturn,
  type Cell,
  type ClientPeer,
  type HubLink,
  type HubOrgPerson,
  type RawSignal,
} from "./extractors"

/* -------------------------------------------------------------------- */
/* Scorer                                                                */
/* -------------------------------------------------------------------- */

type ScoredGroup = {
  individual_proconnect_client_id: string
  business_proconnect_client_id: string
  relationship_type: RelationshipType
  direction: RelationshipDirection
  source_engagement_id: string | null
  confidence: number
  status: "needs_review" | "confirmed"
  signals: RawSignal[]
}

/**
 * Group signals by `(individual, business, relationship_type)` and
 * compute a final confidence using a max-of-signals policy with a
 * small bonus for corroborating evidence.
 *
 * Why max-of and not sum: a sum would let two name-only signals at
 * 0.6 each push past the auto-confirm threshold (0.85 cap), which is
 * exactly the false-positive class we promised to gate. Max-of with a
 * small +0.05 per additional independent signal source preserves
 * conservatism while rewarding multi-source corroboration.
 */
export function scoreSignals(signals: RawSignal[]): ScoredGroup[] {
  const groups = new Map<string, RawSignal[]>()
  for (const s of signals) {
    const key = [
      s.individual_proconnect_client_id,
      s.business_proconnect_client_id,
      s.relationship_type,
    ].join("|")
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }

  const out: ScoredGroup[] = []
  for (const [, arr] of groups) {
    const baseScores = arr.map((s) => SIGNAL_WEIGHTS[s.signal_kind] ?? 0.5)
    const max = Math.max(...baseScores, 0)
    const distinctSources = new Set(arr.map((s) => s.signal_source)).size
    const bonus = Math.min(0.1, Math.max(0, distinctSources - 1) * 0.05)
    const confidence = Math.min(1, Number((max + bonus).toFixed(3)))
    const head = arr[0]
    // Pick the "best" engagement for source: prefer one tied to the
    // strongest signal so the audit trail points reviewers at the
    // right return.
    const bestIdx = baseScores.indexOf(max)
    const sourceEng = arr[bestIdx]?.source_engagement_id ?? head.source_engagement_id

    const status: "needs_review" | "confirmed" =
      confidence >= AUTO_CONFIRM_THRESHOLD ? "confirmed" : "needs_review"
    if (confidence < REVIEW_THRESHOLD) continue // drop weak noise

    out.push({
      individual_proconnect_client_id: head.individual_proconnect_client_id,
      business_proconnect_client_id: head.business_proconnect_client_id,
      relationship_type: head.relationship_type,
      direction: head.direction,
      source_engagement_id: sourceEng,
      confidence,
      status,
      signals: arr,
    })
  }
  return out
}

/* -------------------------------------------------------------------- */
/* Persistence                                                           */
/* -------------------------------------------------------------------- */

/**
 * Upsert one scored group: insert/update the relationship row, then
 * append all of its signals. Signals are append-only — we never
 * overwrite history because the review queue needs the full audit.
 *
 * If a human has already `confirmed` or `rejected` the relationship,
 * we leave the status alone but still append new signals (so the
 * audit trail still reflects fresh evidence).
 */
async function upsertScoredGroup(
  admin: SupabaseClient,
  group: ScoredGroup,
): Promise<{ relationship_id: string; was_new: boolean } | null> {
  const { data: existing, error: existingErr } = await admin
    .from("tax_client_relationships")
    .select("id, status, confidence")
    .eq("individual_proconnect_client_id", group.individual_proconnect_client_id)
    .eq("business_proconnect_client_id", group.business_proconnect_client_id)
    .eq("relationship_type", group.relationship_type)
    .maybeSingle()

  if (existingErr) {
    console.error("[v0] relationships: existing lookup failed", existingErr)
    return null
  }

  let relationshipId: string
  let wasNew = false
  if (!existing) {
    const { data: inserted, error: insertErr } = await admin
      .from("tax_client_relationships")
      .insert({
        individual_proconnect_client_id: group.individual_proconnect_client_id,
        business_proconnect_client_id: group.business_proconnect_client_id,
        relationship_type: group.relationship_type,
        status: group.status,
        confidence: group.confidence,
        direction: group.direction,
        source_engagement_id: group.source_engagement_id,
      })
      .select("id")
      .single()
    if (insertErr || !inserted) {
      console.error("[v0] relationships: insert failed", insertErr)
      return null
    }
    relationshipId = inserted.id as string
    wasNew = true
  } else {
    relationshipId = existing.id as string
    const humanLocked = existing.status === "confirmed" || existing.status === "rejected"
    const update: Record<string, unknown> = {
      confidence: Math.max(existing.confidence ?? 0, group.confidence),
      source_engagement_id: group.source_engagement_id,
    }
    // Only auto-promote to "confirmed" when nothing has been reviewed
    // yet AND the new score crosses the threshold. Never demote.
    if (!humanLocked) {
      update.status = group.status
    }
    const { error: updateErr } = await admin
      .from("tax_client_relationships")
      .update(update)
      .eq("id", relationshipId)
    if (updateErr) {
      console.error("[v0] relationships: update failed", updateErr)
    }
  }

  // Append signal rows.
  const signalRows = group.signals.map((s) => ({
    relationship_id: relationshipId,
    signal_source: s.signal_source,
    signal_kind: s.signal_kind,
    signal_value: s.signal_value,
    matched_value: s.matched_value,
    confidence: SIGNAL_WEIGHTS[s.signal_kind] ?? 0.5,
    source_return_id: s.source_return_id,
    source_engagement_id: s.source_engagement_id,
    raw: s.raw ?? {},
  }))
  if (signalRows.length > 0) {
    const { error: signalErr } = await admin
      .from("tax_client_relationship_signals")
      .insert(signalRows)
    if (signalErr) {
      console.error("[v0] relationships: signal insert failed", signalErr)
    }
  }
  return { relationship_id: relationshipId, was_new: wasNew }
}

/* -------------------------------------------------------------------- */
/* Scanner orchestration                                                 */
/* -------------------------------------------------------------------- */

export type ScanScope =
  | { kind: "engagement"; engagementId: string }
  | { kind: "client"; proconnectClientId: string }
  | { kind: "all" }

export type ScanReport = {
  signals_emitted: number
  groups_scored: number
  relationships_inserted: number
  relationships_updated: number
  auto_confirmed: number
  needs_review: number
  scope: ScanScope
  empty_phase1: boolean
}

/**
 * The single entry point used by both the API route (manual trigger)
 * and the webhook (per-engagement scan after a fresh snapshot import).
 *
 * The scope determines which engagements feed the cell extractors:
 *   - `engagement` — narrow re-run after a single Phase 1 snapshot.
 *   - `client` — re-run all engagements for one ProConnect client
 *     (e.g. when a hub link changes).
 *   - `all` — full sweep (cron / admin maintenance).
 *
 * The hub-fallback extractor always runs against the full hub graph
 * regardless of scope, because hub links are not engagement-scoped.
 */
export async function scanRelationships(
  admin: SupabaseClient,
  scope: ScanScope,
): Promise<ScanReport> {
  // 1. Materialize the candidate index.
  const { data: peers, error: peerErr } = await admin
    .from("proconnect_clients")
    .select(
      "proconnect_client_id, client_type, display_name, business_name, first_name, last_name, tax_id, state, hub_contact_id, hub_organization_id",
    )
  if (peerErr || !peers) {
    throw new Error(`peers fetch failed: ${peerErr?.message ?? "unknown"}`)
  }
  const index = buildCandidateIndex(peers as ClientPeer[])

  // 2. Pick the engagements in scope.
  let engQuery = admin
    .from("proconnect_engagements")
    .select("engagement_id, proconnect_client_id, return_type")
  if (scope.kind === "engagement") {
    engQuery = engQuery.eq("engagement_id", scope.engagementId)
  } else if (scope.kind === "client") {
    engQuery = engQuery.eq("proconnect_client_id", scope.proconnectClientId)
  }
  const { data: engagements, error: engErr } = await engQuery
  if (engErr || !engagements) {
    throw new Error(`engagements fetch failed: ${engErr?.message ?? "unknown"}`)
  }

  // 3. Fetch cells for these engagements (return_id IS engagement_id).
  const returnIds = engagements
    .map((e) => e.engagement_id as string | null)
    .filter((v): v is string => Boolean(v))
  let cells: Cell[] = []
  if (returnIds.length > 0) {
    const { data: cellRows, error: cellErr } = await admin
      .from("proconnect_return_field_cells")
      .select("return_id, series_id, prefix_id, code_id, suffix_id, val, description, src, tsj")
      .in("return_id", returnIds)
    if (cellErr) {
      console.error("[v0] relationships: cells fetch failed", cellErr)
    }
    cells = (cellRows ?? []) as Cell[]
  }
  const emptyPhase1 = cells.length === 0

  // 4. Run cell-based extractors per engagement.
  const allSignals: RawSignal[] = []
  const cellsByReturn = new Map<string, Cell[]>()
  for (const c of cells) {
    const arr = cellsByReturn.get(c.return_id) ?? []
    arr.push(c)
    cellsByReturn.set(c.return_id, arr)
  }
  for (const eng of engagements) {
    const engId = eng.engagement_id as string
    const clientId = eng.proconnect_client_id as string
    const returnType = (eng.return_type ?? "").toUpperCase()
    const myCells = cellsByReturn.get(engId) ?? []
    if (myCells.length === 0) continue

    if (returnType === "IND" || returnType === "1040") {
      allSignals.push(...extractFromIndividualReturn(clientId, engId, myCells, index))
    } else if (
      returnType === "PAR" ||
      returnType === "SCO" ||
      returnType === "COR" ||
      returnType === "1065" ||
      returnType === "1120" ||
      returnType === "1120S"
    ) {
      allSignals.push(...extractFromBusinessReturn(clientId, engId, myCells, index))
    }
  }

  // 5. Hub fallback — runs every scan, ignores scope.
  const { data: contactOrgRows, error: cOrgErr } = await admin
    .from("contact_organizations")
    .select("contact_id, organization_id, role_or_title")
  if (cOrgErr) {
    console.error("[v0] relationships: contact_organizations fetch failed", cOrgErr)
  }

  const { data: orgRows, error: orgErr } = await admin
    .from("organizations")
    .select("id, officers, shareholders, directors")
  if (orgErr) {
    console.error("[v0] relationships: organizations fetch failed", orgErr)
  }
  const hubPersons: HubOrgPerson[] = []
  for (const o of orgRows ?? []) {
    const orgId = (o as { id: string }).id
    for (const [field, kind] of [
      ["officers", "officer"],
      ["shareholders", "shareholder"],
      ["directors", "director"],
    ] as const) {
      const arr = (o as Record<string, unknown>)[field]
      if (!Array.isArray(arr)) continue
      for (const item of arr) {
        if (!item || typeof item !== "object") continue
        const itemObj = item as Record<string, unknown>
        const name =
          typeof itemObj.full_name === "string"
            ? itemObj.full_name
            : typeof itemObj.name === "string"
              ? itemObj.name
              : null
        const ssn =
          typeof itemObj.ssn === "string"
            ? itemObj.ssn
            : typeof itemObj.tin === "string"
              ? itemObj.tin
              : null
        if (!name && !ssn) continue
        hubPersons.push({ organization_id: orgId, role_kind: kind, full_name: name, ssn })
      }
    }
  }
  allSignals.push(
    ...extractFromHubFallback(
      ((contactOrgRows ?? []) as HubLink[]),
      hubPersons,
      index,
    ),
  )

  // 6. Score & persist.
  const scored = scoreSignals(allSignals)
  let inserted = 0
  let updated = 0
  let autoConfirmed = 0
  let needsReview = 0
  for (const g of scored) {
    const result = await upsertScoredGroup(admin, g)
    if (!result) continue
    if (result.was_new) inserted += 1
    else updated += 1
    if (g.status === "confirmed") autoConfirmed += 1
    else needsReview += 1
  }

  return {
    signals_emitted: allSignals.length,
    groups_scored: scored.length,
    relationships_inserted: inserted,
    relationships_updated: updated,
    auto_confirmed: autoConfirmed,
    needs_review: needsReview,
    scope,
    empty_phase1: emptyPhase1,
  }
}

/* -------------------------------------------------------------------- */
/* Re-exports                                                            */
/* -------------------------------------------------------------------- */

export type { SignalKind }
