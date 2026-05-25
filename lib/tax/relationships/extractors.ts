/**
 * Tax Client Relationship — signal extractors.
 *
 * Each extractor is a pure function: (engagement, cells, peers) → list
 * of `RawSignal`. The scanner orchestrates them, the scorer rolls the
 * raw signals up into (relationship, signal[]) row pairs.
 *
 * IMPORTANT: extractors NEVER mutate; they only emit signals. The
 * scanner+scorer is responsible for upserting into the relationship
 * tables. This makes the extractors trivially testable and lets us
 * re-run them deterministically against historical snapshots.
 *
 * Phase 1 reality: as of writing, our scope for the ProConnect
 * tax-returns API is not yet allow-listed, so `proconnect_return_field_cells`
 * is mostly empty. All three of these extractors are still
 * worth running because:
 *   1. The hub-fallback extractor needs no Phase 1 data at all.
 *   2. Once the scope lands, the K-1 / Schedule-E / owner extractors
 *      will start finding signals automatically with no code change
 *      because they read from the same `proconnect_return_field_cells`
 *      view we already populate from snapshots.
 */

import type {
  RelationshipDirection,
  RelationshipType,
  SignalKind,
  SignalSource,
} from "./types"
import { digitsOnly, last4, nameSimilarity, normalizeName, tinExact } from "./identifiers"

/**
 * A raw, un-scored signal pointing at a candidate (individual,business)
 * pair. The scorer is responsible for collapsing many of these into
 * one (relationship_id, signal[]) row group.
 */
export type RawSignal = {
  individual_proconnect_client_id: string
  business_proconnect_client_id: string
  relationship_type: RelationshipType
  direction: RelationshipDirection
  signal_source: SignalSource
  signal_kind: SignalKind
  signal_value: string | null
  matched_value: string | null
  source_return_id: string | null
  source_engagement_id: string | null
  raw: Record<string, unknown> | null
}

/* -------------------------------------------------------------------- */
/* Cell shape                                                            */
/* -------------------------------------------------------------------- */

/**
 * Subset of `proconnect_return_field_cells` we read. Wide enough to
 * pattern-match without being coupled to every column.
 */
export type Cell = {
  return_id: string
  series_id: string | null
  prefix_id: string | null
  code_id: string | null
  suffix_id: string | null
  val: string | null
  description: string | null
  src: string | null
  tsj: string | null
}

/**
 * Subset of `proconnect_clients` we use to build the candidate index.
 * We materialize this once per scan and pass it in to every extractor.
 */
export type ClientPeer = {
  proconnect_client_id: string
  client_type: "PERSON" | "ORGANIZATION" | string | null
  display_name: string | null
  business_name: string | null
  first_name: string | null
  last_name: string | null
  tax_id: string | null
  state: string | null
  hub_contact_id: string | null
  hub_organization_id: string | null
}

/* -------------------------------------------------------------------- */
/* Cell predicates                                                       */
/* -------------------------------------------------------------------- */

const RX = {
  /** Schedule E rental/royalty / partnership / S-corp lines. */
  scheduleE: /(schedule\s*e|sch\s*e|rental.*real\s*estate|partnership|s[-\s]?corp|s\s*corporation|k-?1)/i,
  /** Schedule C self-employment activity. */
  scheduleC: /(schedule\s*c|sch\s*c|sole\s*prop|self[-\s]?employment|principal\s*business)/i,
  /** K-1 issuer EIN labels. */
  k1Ein: /(k-?1.*ein|partnership.*ein|s[-\s]?corp.*ein|issuer.*ein|payer.*ein|fein)/i,
  /** K-1 / Sch E payer name labels. */
  k1Name: /(k-?1.*name|partnership.*name|s[-\s]?corp.*name|payer.*name|issuer.*name|business\s*name)/i,
  /** Owner / shareholder / partner identifiers on a business return. */
  ownerSsn: /(partner.*ssn|shareholder.*ssn|member.*ssn|officer.*ssn|owner.*ssn|tin\b)/i,
  ownerName: /(partner.*name|shareholder.*name|member.*name|officer.*name|owner.*name)/i,
  einShape: /^\d{9}$|^\d{2}-\d{7}$/,
  ssnShape: /^\d{9}$|^\d{3}-\d{2}-\d{4}$/,
}

function looksLikeEin(val: string | null | undefined): boolean {
  if (!val) return false
  const d = digitsOnly(val)
  return !!d && d.length === 9
}

function looksLikeSsn(val: string | null | undefined): boolean {
  // Same digit count as EIN — we differentiate by *which field* it
  // came from (description-driven), not by the value's shape alone.
  if (!val) return false
  const d = digitsOnly(val)
  return !!d && d.length === 9
}

/* -------------------------------------------------------------------- */
/* Pair groupers                                                         */
/* -------------------------------------------------------------------- */

/**
 * Cells for the same logical "row" (e.g. one K-1 issuer) tend to
 * share a (series_id, prefix_id, suffix_id) tuple — code_id varies
 * (one for EIN, one for name, one for amount). Group them so we can
 * emit one signal per logical issuer instead of N.
 */
function groupCellsByRow(cells: Cell[]): Map<string, Cell[]> {
  const groups = new Map<string, Cell[]>()
  for (const c of cells) {
    const key = [c.return_id, c.series_id ?? "", c.prefix_id ?? "", c.suffix_id ?? ""].join("|")
    const arr = groups.get(key) ?? []
    arr.push(c)
    groups.set(key, arr)
  }
  return groups
}

/* -------------------------------------------------------------------- */
/* Candidate index                                                       */
/* -------------------------------------------------------------------- */

/**
 * Pre-computed lookup tables over the ProConnect roster. Built once
 * per scan and shared by every extractor — without this the inner
 * loops would be O(returns × peers).
 */
export type CandidateIndex = {
  byEin: Map<string, ClientPeer[]>
  bySsn: Map<string, ClientPeer[]>
  byNormName: Map<string, ClientPeer[]>
  /** Flat list of business peers for fuzzy fallback. */
  businesses: ClientPeer[]
  /** Flat list of individual peers for fuzzy fallback. */
  individuals: ClientPeer[]
}

export function buildCandidateIndex(peers: ClientPeer[]): CandidateIndex {
  const byEin = new Map<string, ClientPeer[]>()
  const bySsn = new Map<string, ClientPeer[]>()
  const byNormName = new Map<string, ClientPeer[]>()
  const businesses: ClientPeer[] = []
  const individuals: ClientPeer[] = []

  for (const p of peers) {
    const tin = digitsOnly(p.tax_id)
    if (tin && tin.length === 9) {
      // We don't know without the TIN type whether it's an EIN or SSN
      // for an individual with a TIN that happens to be an EIN-shaped
      // number — index it under both maps. The extractor disambiguates
      // by whether `p` is a business or an individual.
      if (p.client_type === "ORGANIZATION") {
        const arr = byEin.get(tin) ?? []
        arr.push(p)
        byEin.set(tin, arr)
      } else {
        const arr = bySsn.get(tin) ?? []
        arr.push(p)
        bySsn.set(tin, arr)
      }
    }
    const name = normalizeName(
      p.client_type === "ORGANIZATION"
        ? p.business_name ?? p.display_name
        : p.display_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`,
    )
    if (name) {
      const arr = byNormName.get(name) ?? []
      arr.push(p)
      byNormName.set(name, arr)
    }
    if (p.client_type === "ORGANIZATION") businesses.push(p)
    else if (p.client_type === "PERSON") individuals.push(p)
  }
  return { byEin, bySsn, byNormName, businesses, individuals }
}

/* -------------------------------------------------------------------- */
/* Extractor: K-1 / Schedule E issuers on an individual return            */
/* -------------------------------------------------------------------- */

/**
 * Walks an individual (1040) return's cells, finds K-1 issuer / Sch E
 * payer identifiers, and emits a `k1_issuer` signal pointing at the
 * matching ProConnect business client.
 *
 * Match priority: EIN exact → name exact → name fuzzy.
 */
export function extractFromIndividualReturn(
  individualClientId: string,
  engagementId: string | null,
  cells: Cell[],
  index: CandidateIndex,
): RawSignal[] {
  const out: RawSignal[] = []
  if (cells.length === 0) return out

  const groups = groupCellsByRow(cells)

  for (const group of groups.values()) {
    const isScheduleE = group.some((c) => RX.scheduleE.test(c.description ?? ""))
    const isScheduleC = group.some((c) => RX.scheduleC.test(c.description ?? ""))
    if (!isScheduleE && !isScheduleC) continue

    // Pull the best EIN candidate from this row.
    const einCell = group.find(
      (c) => RX.k1Ein.test(c.description ?? "") && looksLikeEin(c.val),
    )
    // ...and the best name candidate.
    const nameCell = group.find(
      (c) => RX.k1Name.test(c.description ?? "") && (c.val ?? "").trim().length > 0,
    )

    const returnId = group[0]?.return_id ?? null

    // EIN match — the strongest possible link.
    if (einCell?.val) {
      const ein = digitsOnly(einCell.val)
      if (ein && index.byEin.has(ein)) {
        for (const peer of index.byEin.get(ein)!) {
          if (peer.proconnect_client_id === individualClientId) continue
          out.push({
            individual_proconnect_client_id: individualClientId,
            business_proconnect_client_id: peer.proconnect_client_id,
            relationship_type: isScheduleE ? "k1_issuer" : "schedule_c_owner",
            direction: "individual_to_business",
            signal_source: isScheduleE ? "schedule_e" : "schedule_c",
            signal_kind: "ein_exact",
            signal_value: ein,
            matched_value: digitsOnly(peer.tax_id),
            source_return_id: returnId,
            source_engagement_id: engagementId,
            raw: {
              ein_cell_description: einCell.description,
              name_cell_description: nameCell?.description ?? null,
              name_cell_val: nameCell?.val ?? null,
            },
          })
        }
        continue // EIN was the strongest signal; don't double-count name.
      }
    }

    // Name fallback — exact normalized match first, then fuzzy.
    if (nameCell?.val) {
      const norm = normalizeName(nameCell.val)
      if (!norm) continue
      const exact = index.byNormName.get(norm) ?? []
      const exactBusinesses = exact.filter((p) => p.client_type === "ORGANIZATION")
      if (exactBusinesses.length > 0) {
        for (const peer of exactBusinesses) {
          out.push({
            individual_proconnect_client_id: individualClientId,
            business_proconnect_client_id: peer.proconnect_client_id,
            relationship_type: isScheduleE ? "k1_issuer" : "schedule_c_owner",
            direction: "individual_to_business",
            signal_source: isScheduleE ? "schedule_e" : "schedule_c",
            signal_kind: "name_exact",
            signal_value: nameCell.val,
            matched_value:
              peer.business_name ?? peer.display_name ?? null,
            source_return_id: returnId,
            source_engagement_id: engagementId,
            raw: { norm },
          })
        }
        continue
      }

      // Fuzzy — best Jaccard above 0.75.
      let bestPeer: ClientPeer | null = null
      let bestScore = 0
      for (const peer of index.businesses) {
        const peerName = normalizeName(peer.business_name ?? peer.display_name ?? null)
        const score = nameSimilarity(norm, peerName)
        if (score > bestScore) {
          bestScore = score
          bestPeer = peer
        }
      }
      if (bestPeer && bestScore >= 0.75) {
        out.push({
          individual_proconnect_client_id: individualClientId,
          business_proconnect_client_id: bestPeer.proconnect_client_id,
          relationship_type: isScheduleE ? "k1_issuer" : "schedule_c_owner",
          direction: "individual_to_business",
          signal_source: isScheduleE ? "schedule_e" : "schedule_c",
          signal_kind: "name_fuzzy",
          signal_value: nameCell.val,
          matched_value: bestPeer.business_name ?? bestPeer.display_name ?? null,
          source_return_id: returnId,
          source_engagement_id: engagementId,
          raw: { norm, score: bestScore },
        })
      }
    }
  }

  return out
}

/* -------------------------------------------------------------------- */
/* Extractor: owners / partners / shareholders on a business return       */
/* -------------------------------------------------------------------- */

export function extractFromBusinessReturn(
  businessClientId: string,
  engagementId: string | null,
  cells: Cell[],
  index: CandidateIndex,
): RawSignal[] {
  const out: RawSignal[] = []
  if (cells.length === 0) return out

  const groups = groupCellsByRow(cells)

  for (const group of groups.values()) {
    const ssnCell = group.find(
      (c) => RX.ownerSsn.test(c.description ?? "") && looksLikeSsn(c.val),
    )
    const nameCell = group.find(
      (c) => RX.ownerName.test(c.description ?? "") && (c.val ?? "").trim().length > 0,
    )
    if (!ssnCell && !nameCell) continue

    const returnId = group[0]?.return_id ?? null

    // SSN match.
    if (ssnCell?.val) {
      const ssn = digitsOnly(ssnCell.val)
      if (ssn && index.bySsn.has(ssn)) {
        for (const peer of index.bySsn.get(ssn)!) {
          if (peer.proconnect_client_id === businessClientId) continue
          out.push({
            individual_proconnect_client_id: peer.proconnect_client_id,
            business_proconnect_client_id: businessClientId,
            relationship_type: "owner",
            direction: "business_to_individual",
            signal_source: "business_owners",
            signal_kind: "ssn_exact",
            signal_value: ssn,
            matched_value: digitsOnly(peer.tax_id),
            source_return_id: returnId,
            source_engagement_id: engagementId,
            raw: { ssn_cell_description: ssnCell.description },
          })
        }
        continue
      }
      // SSN last-4 fallback if a peer's stored TIN matches just the last 4.
      const tail = last4(ssnCell.val)
      if (tail) {
        const matches = index.individuals.filter(
          (p) => last4(p.tax_id) === tail,
        )
        if (matches.length === 1) {
          // Only emit when unambiguous to avoid pairing every John Smith.
          const peer = matches[0]
          out.push({
            individual_proconnect_client_id: peer.proconnect_client_id,
            business_proconnect_client_id: businessClientId,
            relationship_type: "owner",
            direction: "business_to_individual",
            signal_source: "business_owners",
            signal_kind: "tin_last4",
            signal_value: tail,
            matched_value: last4(peer.tax_id),
            source_return_id: returnId,
            source_engagement_id: engagementId,
            raw: { ssn_cell_description: ssnCell.description },
          })
        }
      }
    }

    // Name match — exact then fuzzy among individuals only.
    if (nameCell?.val) {
      const norm = normalizeName(nameCell.val)
      if (!norm) continue
      const exact = (index.byNormName.get(norm) ?? []).filter(
        (p) => p.client_type === "PERSON",
      )
      if (exact.length > 0) {
        for (const peer of exact) {
          out.push({
            individual_proconnect_client_id: peer.proconnect_client_id,
            business_proconnect_client_id: businessClientId,
            relationship_type: "owner",
            direction: "business_to_individual",
            signal_source: "business_owners",
            signal_kind: "name_exact",
            signal_value: nameCell.val,
            matched_value: peer.display_name ?? null,
            source_return_id: returnId,
            source_engagement_id: engagementId,
            raw: { norm },
          })
        }
        continue
      }

      let best: ClientPeer | null = null
      let bestScore = 0
      for (const peer of index.individuals) {
        const peerName = normalizeName(peer.display_name)
        const score = nameSimilarity(norm, peerName)
        if (score > bestScore) {
          bestScore = score
          best = peer
        }
      }
      if (best && bestScore >= 0.8) {
        out.push({
          individual_proconnect_client_id: best.proconnect_client_id,
          business_proconnect_client_id: businessClientId,
          relationship_type: "owner",
          direction: "business_to_individual",
          signal_source: "business_owners",
          signal_kind: "name_fuzzy",
          signal_value: nameCell.val,
          matched_value: best.display_name ?? null,
          source_return_id: returnId,
          source_engagement_id: engagementId,
          raw: { norm, score: bestScore },
        })
      }
    }
  }

  return out
}

/* -------------------------------------------------------------------- */
/* Extractor: hub fallback (contact_organizations + officers/shareholders)*/
/* -------------------------------------------------------------------- */

export type HubLink = {
  contact_id: string
  organization_id: string
  role_or_title: string | null
}

export type HubOrgPerson = {
  organization_id: string
  /** "officers" / "shareholders" — used to set relationship_type. */
  role_kind: "officer" | "shareholder" | "director"
  full_name: string | null
  ssn: string | null
}

/**
 * Walks the hub's contact_organizations rows and the officers/
 * shareholders/directors json arrays on `organizations`, mapping each
 * to a (proconnect_individual, proconnect_business) pair via the
 * `hub_contact_id` / `hub_organization_id` columns on
 * `proconnect_clients`. This is the only extractor that can run when
 * Phase 1 cells are empty.
 */
export function extractFromHubFallback(
  contactOrgLinks: HubLink[],
  hubOrgPersons: HubOrgPerson[],
  index: CandidateIndex,
): RawSignal[] {
  const out: RawSignal[] = []
  // Index hub_*_id back to proconnect_client_id.
  const indByHubContact = new Map<string, ClientPeer>()
  const orgByHubOrg = new Map<string, ClientPeer>()
  for (const p of [...index.individuals, ...index.businesses]) {
    if (p.hub_contact_id) indByHubContact.set(p.hub_contact_id, p)
    if (p.hub_organization_id) orgByHubOrg.set(p.hub_organization_id, p)
  }

  // 1) contact_organizations rows.
  for (const link of contactOrgLinks) {
    const ind = indByHubContact.get(link.contact_id)
    const biz = orgByHubOrg.get(link.organization_id)
    if (!ind || !biz) continue
    const role = (link.role_or_title ?? "").toLowerCase()
    const relType: RelationshipType = role.includes("officer")
      ? "officer"
      : role.includes("owner") || role.includes("shareholder") || role.includes("partner")
        ? "owner"
        : "related"
    out.push({
      individual_proconnect_client_id: ind.proconnect_client_id,
      business_proconnect_client_id: biz.proconnect_client_id,
      relationship_type: relType,
      direction: "individual_to_business",
      signal_source: "hub_contact_organizations",
      signal_kind: "hub_link",
      signal_value: link.role_or_title,
      matched_value: null,
      source_return_id: null,
      source_engagement_id: null,
      raw: { hub_contact_id: link.contact_id, hub_organization_id: link.organization_id },
    })
  }

  // 2) officers/shareholders/directors json arrays. Match by SSN if
  //    present, then by exact normalized name.
  for (const person of hubOrgPersons) {
    const biz = orgByHubOrg.get(person.organization_id)
    if (!biz) continue

    let matched: ClientPeer | null = null
    let kind: "ssn_exact" | "name_exact" | null = null

    if (person.ssn) {
      const ssn = digitsOnly(person.ssn)
      if (ssn && index.bySsn.has(ssn)) {
        const peers = index.bySsn.get(ssn)!.filter((p) => p.client_type === "PERSON")
        if (peers.length === 1) {
          matched = peers[0]
          kind = "ssn_exact"
        }
      }
    }
    if (!matched && person.full_name) {
      const norm = normalizeName(person.full_name)
      if (norm) {
        const peers = (index.byNormName.get(norm) ?? []).filter(
          (p) => p.client_type === "PERSON",
        )
        if (peers.length === 1) {
          matched = peers[0]
          kind = "name_exact"
        }
      }
    }
    if (!matched || !kind) continue

    const relType: RelationshipType =
      person.role_kind === "officer"
        ? "officer"
        : person.role_kind === "shareholder"
          ? "owner"
          : "officer"
    out.push({
      individual_proconnect_client_id: matched.proconnect_client_id,
      business_proconnect_client_id: biz.proconnect_client_id,
      relationship_type: relType,
      direction: "business_to_individual",
      signal_source:
        person.role_kind === "officer" || person.role_kind === "director"
          ? "hub_organization_officers"
          : "hub_organization_shareholders",
      signal_kind: kind,
      signal_value: person.full_name ?? person.ssn,
      matched_value:
        kind === "ssn_exact" ? digitsOnly(matched.tax_id) : matched.display_name,
      source_return_id: null,
      source_engagement_id: null,
      raw: {
        hub_organization_id: person.organization_id,
        role_kind: person.role_kind,
      },
    })
  }

  // Suppress duplicate sins via tinExact short-circuit. (Defensive,
  // since a single role may appear in both contact_organizations and
  // organizations.officers — we leave dedup to the scorer.)
  void tinExact // referenced for ts-noUnused; the helper is exported for tests

  return out
}
