/**
 * Tax Client Relationship Graph — types
 *
 * Types shared between extractors, scorer, and API routes. Mirrors the
 * `tax_client_relationships` + `tax_client_relationship_signals` schema
 * in `scripts/170_tax_client_relationships.sql` so the row shapes line
 * up 1:1 with the columns we read/write.
 */

export type RelationshipType =
  // Schedule E / K-1 issuer of business income on individual return.
  | "k1_issuer"
  // Schedule C activity owned by an individual (sole prop).
  | "schedule_c_owner"
  // Owner / shareholder / member of a business.
  | "owner"
  // Officer of a business (signing officer, treasurer, etc.).
  | "officer"
  // Generic — couldn't disambiguate but the hub records a link.
  | "related"
  | "unknown"

export type RelationshipStatus = "needs_review" | "confirmed" | "rejected"

export type RelationshipDirection = "individual_to_business" | "business_to_individual"

export type SignalSource =
  | "schedule_e"
  | "schedule_c"
  | "k1"
  | "business_owners"
  | "hub_contact_organizations"
  | "hub_organization_officers"
  | "hub_organization_shareholders"
  | "legacy_id"
  | "manual"

export type SignalKind =
  | "ein_exact"
  | "ssn_exact"
  | "tin_last4"
  | "name_exact"
  | "name_fuzzy"
  | "address_match"
  | "hub_link"

/**
 * Confidence policy — kept identical to ALFRED's calendly/zoom triage
 * thresholds (auto ≥0.85, review 0.5–<0.85, reject <0.5) so reviewers
 * see consistent behavior across the platform.
 */
export const AUTO_CONFIRM_THRESHOLD = 0.85
export const REVIEW_THRESHOLD = 0.5

/**
 * Per-signal weights. The scorer takes the MAX (not sum) of signals
 * for a given (individual,business) pair — multiple signals add a
 * small bonus, but we never let a single name match silently push a
 * pair to auto-confirm.
 */
export const SIGNAL_WEIGHTS: Record<SignalKind, number> = {
  ein_exact: 0.95,
  ssn_exact: 0.95,
  tin_last4: 0.7,
  name_exact: 0.78,
  // Capped at 0.75 per the plan — name-only without state agreement is
  // not enough to auto-confirm, period.
  name_fuzzy: 0.6,
  address_match: 0.55,
  hub_link: 0.8,
}

export type RelationshipRow = {
  id: string
  individual_proconnect_client_id: string
  business_proconnect_client_id: string
  relationship_type: RelationshipType
  status: RelationshipStatus
  confidence: number
  direction: RelationshipDirection
  source_engagement_id: string | null
  notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export type SignalRow = {
  id: string
  relationship_id: string
  signal_source: SignalSource
  signal_kind: SignalKind
  signal_value: string | null
  matched_value: string | null
  confidence: number
  source_return_id: string | null
  source_engagement_id: string | null
  raw: Record<string, unknown> | null
  created_at: string
}
