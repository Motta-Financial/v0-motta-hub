// Fuzzy matcher: ProConnect clients ↔ Hub contacts/organizations
// ----------------------------------------------------------------
// The legacy BEFORE INSERT/UPDATE trigger (scripts/151_proconnect_auto_link_hub.sql)
// only does exact LOWER() matches on email or name. That left 505 of 2030
// ProConnect clients unmapped — almost all organizations whose punctuation
// or entity-suffix differs slightly from organizations.name (e.g.
// "Superior State, LLC" in ProConnect vs "Superior State LLC" in the Hub).
//
// This module ranks Hub candidates for one ProConnect client using the
// signals below, in order of trust:
//
//   1. EIN / tax_id exact (BUSINESS only, weight 1.00)
//   2. SSN last-4 + last-name (PERSON only, weight 0.95)
//   3. Primary email exact (weight 0.90)
//   4. First+last exact (PERSON, weight 0.85)
//   5. Normalized business-name exact (BUSINESS, weight 0.80)
//        — strips punctuation/whitespace and "common" entity suffixes
//          (LLC, INC, CORP, CO, LP, LLP, LTD, PLLC, PC, PA)
//   6. Trigram similarity ≥ 0.75 (BUSINESS, scaled to 0.70–0.79)
//   7. State + last-name (PERSON, fallback only, capped at 0.65)
//
// Scoring follows the same threshold policy used elsewhere in the Hub:
//   ≥ 0.85 + clear top winner ⇒ auto_fuzzy (apply automatically)
//   0.50–0.85                 ⇒ pending   (operator review)
//   < 0.50                    ⇒ no_match
//
// Inactive / Deleted contacts and organizations are kept eligible —
// historical attribution matters for tax engagements that go back years.

import type { SupabaseClient } from "@supabase/supabase-js"

export const MATCHER_VERSION = "v1"

export type MatchSignal =
  | "ein"
  | "ssn_last4"
  | "email"
  | "name_exact"
  | "name_normalized"
  | "name_trigram"
  | "state_last_name"

export type ProconnectClientLite = {
  proconnect_client_id: string
  client_type: "PERSON" | "BUSINESS" | "ORGANIZATION" | string
  email: string | null
  first_name: string | null
  last_name: string | null
  business_name: string | null
  display_name: string | null
  tax_id: string | null
  state: string | null
}

export type ContactCandidate = {
  kind: "contact"
  id: string
  full_name: string | null
  primary_email: string | null
  state: string | null
  ssn_last_four: string | null
  status: string | null
  score: number
  signals: MatchSignal[]
}

export type OrganizationCandidate = {
  kind: "organization"
  id: string
  name: string | null
  ein: string | null
  primary_email: string | null
  state: string | null
  status: string | null
  score: number
  signals: MatchSignal[]
}

export type Candidate = ContactCandidate | OrganizationCandidate

const ENTITY_SUFFIX_RE =
  /\b(l\.?l\.?c|inc(orporated)?|corp(oration)?|co(mpany)?|l\.?p|l\.?l\.?p|ltd|p\.?l\.?l\.?c|p\.?c|p\.?a|trust|estate)\b\.?/gi

/**
 * Normalize a business name for fuzzy comparison.
 * - Lowercases, strips diacritics
 * - Removes punctuation/parens/quotes
 * - Strips common entity suffixes (LLC, Inc, Corp, etc.)
 * - Collapses whitespace
 *
 * Examples:
 *   "Superior State, LLC"        → "superior state"
 *   "Ola Loa Swim Academy, Inc." → "ola loa swim academy"
 *   "SHIN"                       → "shin"
 */
export function normalizeBusinessName(input: string | null | undefined): string {
  if (!input) return ""
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['"`.,()]/g, " ")
    .replace(ENTITY_SUFFIX_RE, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Strip everything except digits — used for EIN / SSN comparisons. */
export function digitsOnly(s: string | null | undefined): string {
  return (s || "").replace(/\D+/g, "")
}

function clean(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase()
}

/**
 * Rank Hub candidates for a single ProConnect client.
 *
 * `excludePairs` is the set of (proconnect_id|hub_id) pairs that have
 * already been rejected — the matcher must not re-propose them, otherwise
 * the review queue spams operators with the same bad guesses every run.
 */
export async function rankHubCandidates(
  sb: SupabaseClient,
  pc: ProconnectClientLite,
  options: {
    limit?: number
    excludePairs?: Set<string>
  } = {},
): Promise<Candidate[]> {
  const limit = options.limit ?? 5
  const excluded = options.excludePairs ?? new Set<string>()
  const isBusiness =
    pc.client_type === "BUSINESS" || pc.client_type === "ORGANIZATION"

  const candidates = new Map<string, Candidate>()

  // Helper: add a signal to a candidate (or create one), never lower the score
  function record(c: Candidate, signal: MatchSignal, score: number) {
    const key = `${c.kind}:${c.id}`
    if (excluded.has(`${pc.proconnect_client_id}|${c.id}`)) return
    const existing = candidates.get(key)
    if (existing) {
      if (!existing.signals.includes(signal)) existing.signals.push(signal)
      existing.score = Math.max(existing.score, score)
    } else {
      c.signals = c.signals.includes(signal) ? c.signals : [signal]
      c.score = score
      candidates.set(key, c)
    }
  }

  if (isBusiness) {
    // ── 1) EIN exact (digits only, ignores formatting) ──────────────
    const ein = digitsOnly(pc.tax_id)
    if (ein.length === 9) {
      const { data } = await sb
        .from("organizations")
        .select("id, name, ein, primary_email, state, status")
        .not("ein", "is", null)
      for (const row of data || []) {
        if (digitsOnly((row as { ein: string }).ein) === ein) {
          record(
            { kind: "organization", ...(row as Record<string, unknown>), score: 0, signals: [] } as unknown as OrganizationCandidate,
            "ein",
            1.0,
          )
        }
      }
    }

    // ── 2) Email exact ──────────────────────────────────────────────
    const email = clean(pc.email)
    if (email) {
      const { data } = await sb
        .from("organizations")
        .select("id, name, ein, primary_email, state, status")
        .ilike("primary_email", email)
      for (const row of data || []) {
        record(
          { kind: "organization", ...(row as Record<string, unknown>), score: 0, signals: [] } as unknown as OrganizationCandidate,
          "email",
          0.9,
        )
      }
    }

    // ── 3) Normalized name exact + trigram fuzzy ────────────────────
    const norm = normalizeBusinessName(pc.business_name || pc.display_name)
    if (norm) {
      // Pull a candidate set sized by trigram similarity (Postgres-side).
      // We over-fetch (limit 25) so the suffix-stripped exact step below
      // always has room to promote its winner above pure trigram matches.
      const { data, error } = await sb.rpc("organizations_trgm_search", {
        q: norm,
        match_limit: 25,
      })
      // Fallback if RPC missing: just fetch by ilike — slower but safe
      let rows = data as
        | Array<{
            id: string
            name: string | null
            ein: string | null
            primary_email: string | null
            state: string | null
            status: string | null
            similarity: number
          }>
        | null
      if (error || !rows) {
        const fb = await sb
          .from("organizations")
          .select("id, name, ein, primary_email, state, status")
          .ilike("name", `%${norm.split(" ")[0]}%`)
          .limit(50)
        rows = (fb.data || []).map((r) => ({
          ...(r as Record<string, unknown>),
          similarity: 0,
        })) as typeof rows
      }
      for (const row of rows || []) {
        const cand: OrganizationCandidate = {
          kind: "organization",
          id: row.id,
          name: row.name,
          ein: row.ein,
          primary_email: row.primary_email,
          state: row.state,
          status: row.status,
          score: 0,
          signals: [],
        }
        const candNorm = normalizeBusinessName(row.name)
        if (candNorm && candNorm === norm) {
          record(cand, "name_normalized", 0.8)
        } else if ((row.similarity ?? 0) >= 0.75) {
          // Scale 0.75 → 0.70 and 1.00 → 0.79 so trigram never beats
          // a normalized-name exact win (0.80) or email (0.90).
          const sim = Math.min(1, row.similarity ?? 0.75)
          const scaled = 0.7 + (sim - 0.75) * (0.09 / 0.25)
          record(cand, "name_trigram", Number(scaled.toFixed(3)))
        }
      }
    }
  } else {
    // ── PERSON ──────────────────────────────────────────────────────
    const ssn = digitsOnly(pc.tax_id)
    const last = clean(pc.last_name)
    const first = clean(pc.first_name)
    const email = clean(pc.email)

    if (ssn.length === 9 && last) {
      const { data } = await sb
        .from("contacts")
        .select(
          "id, full_name, primary_email, state, ssn_last_four, status, last_name",
        )
        .ilike("last_name", last)
      for (const row of data || []) {
        const r = row as { ssn_last_four: string | null }
        if (r.ssn_last_four && r.ssn_last_four === ssn.slice(-4)) {
          record(
            { kind: "contact", ...(row as Record<string, unknown>), score: 0, signals: [] } as unknown as ContactCandidate,
            "ssn_last4",
            0.95,
          )
        }
      }
    }

    if (email) {
      const { data } = await sb
        .from("contacts")
        .select("id, full_name, primary_email, state, ssn_last_four, status")
        .ilike("primary_email", email)
      for (const row of data || []) {
        record(
          { kind: "contact", ...(row as Record<string, unknown>), score: 0, signals: [] } as unknown as ContactCandidate,
          "email",
          0.9,
        )
      }
    }

    if (first && last) {
      const { data } = await sb
        .from("contacts")
        .select("id, full_name, primary_email, state, ssn_last_four, status")
        .ilike("first_name", first)
        .ilike("last_name", last)
      for (const row of data || []) {
        record(
          { kind: "contact", ...(row as Record<string, unknown>), score: 0, signals: [] } as unknown as ContactCandidate,
          "name_exact",
          0.85,
        )
      }
    }

    // State + last name fallback (only when no other signal yet)
    if (last && pc.state && candidates.size === 0) {
      const { data } = await sb
        .from("contacts")
        .select("id, full_name, primary_email, state, ssn_last_four, status")
        .ilike("last_name", last)
        .ilike("state", pc.state)
        .limit(20)
      for (const row of data || []) {
        record(
          { kind: "contact", ...(row as Record<string, unknown>), score: 0, signals: [] } as unknown as ContactCandidate,
          "state_last_name",
          0.65,
        )
      }
    }
  }

  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Decide whether the top candidate qualifies for auto-apply.
 * Mirrors the ALFRED policy: ≥ 0.85 AND a clear gap (≥ 0.10) to #2.
 * EIN/SSN matches always auto-apply because they are uniqueness-strong.
 */
export function pickAutoApply(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) return null
  const top = candidates[0]
  if (top.signals.includes("ein") || top.signals.includes("ssn_last4"))
    return top
  if (top.score < 0.85) return null
  if (candidates.length === 1) return top
  if (top.score - candidates[1].score >= 0.1) return top
  return null
}
