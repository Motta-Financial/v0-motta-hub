// Backfill legacy_motta_client_id on every contact + populate the
// referrals table from contacts.referred_by. Idempotent.
//
// Run AFTER applying scripts/102_legacy_motta_client_id_and_referrals.sql.
//
//   NODE_TLS_REJECT_UNAUTHORIZED=0 \
//   node --env-file-if-exists=/vercel/share/.env.project \
//     scripts/102-run-backfill-legacy-and-referrals.mjs
//
// Pipeline (single pass over contacts):
//   1. Derive legacy_motta_client_id from (state, phone, name) and
//      UPDATE contacts where the derived value differs from stored.
//   2. Build an in-memory legacy_id → contact lookup using the
//      newly-updated values.
//   3. For every contact, run the referral state machine against
//      contacts.referred_by and UPSERT into referrals.
//
// We deliberately import the TypeScript helpers via tsx-on-the-fly:
// this script is run via `node --env-file-if-exists=...` and we want
// derivation logic to stay co-located with the production code path
// (lib/legacy-client-id.ts, lib/referrals/resolve.ts). Because tsx
// isn't always available, we re-implement the tiny pure functions
// inline below — see the corresponding .ts files for the canonical
// version. KEEP THESE IN SYNC.

import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

if (!url || !key) {
  console.error("[v0] Supabase service-role credentials not configured")
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

// ───────────────────────── helpers (mirror lib/) ──────────────────

const NAME_SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V", "MD", "PHD", "ESQ", "CPA", "DDS", "DO"])
const US_STATES = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL",
  INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA",
  MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN",
  MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI",
  WYOMING: "WY", "PUERTO RICO": "PR",
}
const VALID_STATE_CODES = new Set(Object.values(US_STATES))
const LEGACY_ID_PATTERN = /^[A-Z]{2}_[A-Z0-9]+_[A-Z0-9]+_\d{4}$/

function normalizeState(input) {
  if (!input) return null
  const t = String(input).trim().toUpperCase()
  if (!t) return null
  if (VALID_STATE_CODES.has(t)) return t
  if (US_STATES[t]) return US_STATES[t]
  return null
}

function extractPhone4(input) {
  if (!input) return null
  let d = String(input).replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1)
  if (d.length < 4) return null
  return d.slice(-4)
}

function tokenizeName(input) {
  return String(input)
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/\./g, "").toUpperCase())
    .filter(Boolean)
    .filter((t) => !NAME_SUFFIXES.has(t))
    .filter((t) => !/^[A-Z]$/.test(t))
    .map((t) => t.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean)
}

function deriveLegacyId(c) {
  const state = normalizeState(c.state)
  const phone4 = extractPhone4(c.phone_primary || c.phone_mobile || c.phone_work)
  let first = c.first_name ? tokenizeName(c.first_name).join("") : ""
  let last = c.last_name ? tokenizeName(c.last_name).join("") : ""
  if (!(first && last) && c.full_name) {
    const toks = tokenizeName(c.full_name)
    if (toks.length >= 2) {
      first = toks[0]
      last = toks[toks.length - 1]
    }
  }
  if (!state || !phone4 || !first || !last) return null
  const id = `${state}_${last}_${first}_${phone4}`
  return LEGACY_ID_PATTERN.test(id) ? id : null
}

const EXTERNAL_KEYWORDS = [
  "google", "linkedin", "facebook", "instagram", "twitter", " x ", "tiktok",
  "yelp", "bbb", "better business bureau", "bing", "search engine", "website",
  "online", "seo", "advertis", "ad ", " ads", "referral partner", "partner firm",
  "npr", "radio", "podcast", "youtube", "newsletter",
]

function looksExternal(raw) {
  const lower = ` ${raw.toLowerCase()} `
  return EXTERNAL_KEYWORDS.some((kw) => lower.includes(kw))
}

function classify(raw, lookup) {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) {
    return { match_status: "no_referral", referred_by_raw: null, referred_by_legacy_id: null, referrer: null }
  }
  const normalized = trimmed.toUpperCase()
  if (LEGACY_ID_PATTERN.test(normalized)) {
    const hit = lookup.get(normalized) ?? null
    return {
      match_status: hit ? "matched" : "unmatched_not_in_hub",
      referred_by_raw: trimmed,
      referred_by_legacy_id: normalized,
      referrer: hit,
    }
  }
  if (looksExternal(trimmed)) {
    return { match_status: "external_referrer", referred_by_raw: trimmed, referred_by_legacy_id: null, referrer: null }
  }
  return { match_status: "unmatched_format", referred_by_raw: trimmed, referred_by_legacy_id: null, referrer: null }
}

// ───────────────────────── pipeline ───────────────────────────────

async function pageAll(table, columns) {
  const out = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

console.log("[v0] Loading contacts…")
const contacts = await pageAll(
  "contacts",
  "id, karbon_contact_key, full_name, first_name, last_name, phone_primary, phone_mobile, phone_work, state, legacy_motta_client_id, referred_by",
)
console.log(`[v0] Loaded ${contacts.length} contacts`)

// 1) Derive + write legacy IDs
let derived = 0
let updated = 0
let skipped = 0
const updates = []
for (const c of contacts) {
  const id = deriveLegacyId(c)
  if (id) derived++
  else skipped++
  if (id !== c.legacy_motta_client_id) {
    updates.push({ id: c.id, legacy_motta_client_id: id })
  }
}
console.log(`[v0] derived=${derived} skipped(missing data)=${skipped} changes=${updates.length}`)

const CHUNK = 200
for (let i = 0; i < updates.length; i += CHUNK) {
  const chunk = updates.slice(i, i + CHUNK)
  await Promise.all(
    chunk.map((u) =>
      supabase.from("contacts").update({ legacy_motta_client_id: u.legacy_motta_client_id }).eq("id", u.id),
    ),
  )
  updated += chunk.length
  process.stdout.write(`\r[v0] legacy_motta_client_id: ${updated}/${updates.length}`)
}
if (updates.length) process.stdout.write("\n")

// 2) Build lookup map from the post-update view
const lookup = new Map()
for (const c of contacts) {
  const id = deriveLegacyId(c) // recompute (no need for round-trip)
  if (id) lookup.set(id, { contact_id: c.id, karbon_contact_key: c.karbon_contact_key, full_name: c.full_name })
}
console.log(`[v0] Lookup built with ${lookup.size} legacy IDs`)

// 3) Resolve referrals — one row per referee, upsert by referee_contact_id
let counts = { matched: 0, unmatched_not_in_hub: 0, unmatched_format: 0, external_referrer: 0, no_referral: 0 }
const referralRows = []
for (const c of contacts) {
  const r = classify(c.referred_by, lookup)
  counts[r.match_status]++
  // We only INSERT rows where there's signal — empty referrals stay
  // out of the table to keep the work queue clean.
  if (r.match_status === "no_referral") continue
  referralRows.push({
    referee_contact_id: c.id,
    referee_karbon_key: c.karbon_contact_key,
    referee_name: c.full_name,
    referred_by_raw: r.referred_by_raw,
    referred_by_legacy_id: r.referred_by_legacy_id,
    referred_by_contact_id: r.referrer?.contact_id ?? null,
    referred_by_karbon_key: r.referrer?.karbon_contact_key ?? null,
    referred_by_name: r.referrer?.full_name ?? null,
    match_status: r.match_status,
    resolved_at: r.match_status === "matched" ? new Date().toISOString() : null,
  })
}
console.log("[v0] Classification:", counts, `→ writing ${referralRows.length} rows`)

// Upsert in chunks on the unique referee_contact_id constraint
let upserted = 0
for (let i = 0; i < referralRows.length; i += 200) {
  const chunk = referralRows.slice(i, i + 200)
  const { error } = await supabase.from("referrals").upsert(chunk, { onConflict: "referee_contact_id" })
  if (error) {
    console.error("[v0] Upsert error:", error.message)
    process.exit(1)
  }
  upserted += chunk.length
  process.stdout.write(`\r[v0] referrals upsert: ${upserted}/${referralRows.length}`)
}
if (referralRows.length) process.stdout.write("\n")

console.log("[v0] Done.")
