/**
 * 103-run-backfill-referrals-from-sources.mjs
 *
 * Backfill the `referrals` table from the two real sources of referrer
 * info we found in production:
 *
 *   1. contacts.custom_fields.referral_client_id  (already in legacy
 *      STATE_LASTNAME_FIRSTNAME_PHONE4 format — Karbon's "Referral
 *      Client ID" custom field)
 *   2. jotform_intake_submissions.referral_source (free-text name typed
 *      by the prospect — must be fuzzy-matched against contacts)
 *
 * The state machine matches §4 of the Motta Hub data model spec:
 *   - matched_existing       — referrer resolved to a contacts.id
 *   - unmatched_not_in_hub   — typed name has no match (HUMAN REVIEW)
 *   - unmatched_ambiguous    — multiple plausible matches
 *   - unmatched_external     — explicitly external (Google, Yelp, etc.)
 *
 * Idempotent: ON CONFLICT against the source-aware partial unique
 * indexes from migration 103.
 */
import { Client } from "pg"

const EXTERNAL_PATTERNS = [
  /\bgoogle\b/i,
  /\byelp\b/i,
  /\bfacebook\b/i,
  /\binstagram\b/i,
  /\blinkedin\b/i,
  /\btiktok\b/i,
  /\byoutube\b/i,
  /\b(?:online )?search\b/i,
  /\binternet\b/i,
  /\bweb(?:site)?\b/i,
  /\bad(?:vert)?\b/i,
  /\bradio\b/i,
  /\bmagazine\b/i,
  /\bbillboard\b/i,
  /\bevent\b/i,
  /\bseminar\b/i,
  /\bworkshop\b/i,
  /\bnone\b/i,
  /\bn\/a\b/i,
  /\bunknown\b/i,
]

function classifyExternal(text) {
  if (!text) return null
  const t = text.trim()
  if (!t) return null
  for (const re of EXTERNAL_PATTERNS) {
    if (re.test(t)) return t
  }
  return null
}

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
}

/**
 * Fuzzy-match a free-text referral_source against the contacts table.
 * Returns:
 *   { kind: "matched_existing", contact_id, confidence }
 *   { kind: "unmatched_ambiguous", candidates: [...] }
 *   { kind: "unmatched_not_in_hub" }
 */
function matchByName(text, contacts) {
  const tokens = tokenize(text)
  if (tokens.length === 0) return { kind: "unmatched_not_in_hub" }

  const scored = []
  for (const c of contacts) {
    const haystack = [
      c.first_name,
      c.last_name,
      c.full_name,
      c.email,
      c.business_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    if (!haystack) continue

    let hits = 0
    for (const tok of tokens) {
      if (haystack.includes(tok)) hits++
    }
    if (hits === 0) continue
    const score = hits / tokens.length
    if (score >= 0.5) scored.push({ contact_id: c.id, score, name: c.full_name })
  }
  scored.sort((a, b) => b.score - a.score)
  if (scored.length === 0) return { kind: "unmatched_not_in_hub" }
  // Strong winner: top score is meaningfully higher than runner-up
  if (scored.length === 1 || scored[0].score - (scored[1]?.score ?? 0) >= 0.25) {
    return {
      kind: "matched_existing",
      contact_id: scored[0].contact_id,
      confidence: scored[0].score,
    }
  }
  return {
    kind: "unmatched_ambiguous",
    candidates: scored.slice(0, 5).map((s) => ({ id: s.contact_id, name: s.name, score: s.score })),
  }
}

async function main() {
  const c = new Client({
    connectionString: process.env.POSTGRES_URL_NON_POOLING,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  console.log("[v0] connected")

  // ─── Step 1: load all contacts (lookup tables) ───────────────────
  const contactsRes = await c.query(`
    select id, first_name, last_name,
           coalesce(nullif(trim(concat_ws(' ', first_name, last_name)),''), email) as full_name,
           email, business_name, legacy_motta_client_id
      from contacts
  `)
  const contacts = contactsRes.rows
  const byLegacy = new Map()
  for (const r of contacts) {
    if (r.legacy_motta_client_id) byLegacy.set(r.legacy_motta_client_id.toUpperCase(), r.id)
  }
  console.log(`[v0] loaded ${contacts.length} contacts; ${byLegacy.size} have legacy ids`)

  // ─── Step 2: ingest referrals from contacts.custom_fields ───────
  const cfRows = await c.query(`
    select id, custom_fields
      from contacts
     where custom_fields ? 'referral_client_id'
       and nullif(trim(custom_fields->>'referral_client_id'),'') is not null
  `)
  console.log(`[v0] ${cfRows.rows.length} contacts have a custom referral_client_id`)

  let cfMatched = 0
  let cfUnmatched = 0
  for (const row of cfRows.rows) {
    const refLegacy = String(row.custom_fields.referral_client_id || "").trim().toUpperCase()
    if (!refLegacy) continue
    const refContactId = byLegacy.get(refLegacy)

    if (refContactId && refContactId === row.id) continue // self-reference, skip

    if (refContactId) {
      await c.query(
        `insert into referrals (
            source, referee_contact_id, referrer_contact_id,
            raw_referrer_text, match_status, match_confidence
         ) values ('karbon_custom_field', $1, $2, $3, 'matched_existing', 1.0)
         on conflict do nothing`,
        [row.id, refContactId, refLegacy],
      )
      cfMatched++
    } else {
      await c.query(
        `insert into referrals (
            source, referee_contact_id,
            raw_referrer_text, match_status
         ) values ('karbon_custom_field', $1, $2, 'unmatched_not_in_hub')
         on conflict do nothing`,
        [row.id, refLegacy],
      )
      cfUnmatched++
    }
  }
  console.log(`[v0] contact referrals: ${cfMatched} matched, ${cfUnmatched} unmatched`)

  // ─── Step 3: ingest referrals from jotform intake submissions ───
  const jfRows = await c.query(`
    select id, contact_id, referral_source
      from jotform_intake_submissions
     where nullif(trim(referral_source),'') is not null
  `)
  console.log(`[v0] ${jfRows.rows.length} jotform submissions have a referral_source`)

  const counts = {
    matched_existing: 0,
    unmatched_not_in_hub: 0,
    unmatched_ambiguous: 0,
    unmatched_external: 0,
  }

  for (const row of jfRows.rows) {
    const text = String(row.referral_source || "").trim()
    if (!text) continue

    let status
    let referrerContactId = null
    let confidence = null
    let candidates = null

    const ext = classifyExternal(text)
    if (ext) {
      status = "unmatched_external"
    } else {
      const match = matchByName(text, contacts)
      status = match.kind
      if (match.kind === "matched_existing") {
        referrerContactId = match.contact_id
        confidence = match.confidence
      } else if (match.kind === "unmatched_ambiguous") {
        candidates = match.candidates
      }
    }
    counts[status] = (counts[status] || 0) + 1

    // The CHECK constraint requires exactly ONE referee identity per
    // row, so we point at the submission only. The contacts side will
    // get its own row when the submission is converted to a contact
    // and the conversion code calls upsertReferralForContact().
    await c.query(
      `insert into referrals (
          source, referee_jotform_submission_id,
          referrer_contact_id, raw_referrer_text,
          match_status, match_confidence, candidate_contact_ids
       ) values ('jotform_intake', $1, $2, $3, $4, $5, $6)
       on conflict do nothing`,
      [
        row.id,
        referrerContactId,
        text,
        status,
        confidence,
        candidates ? JSON.stringify(candidates) : null,
      ],
    )
  }
  console.log(`[v0] jotform referrals:`, counts)

  // ─── Step 4: summary ────────────────────────────────────────────
  const total = await c.query(`select match_status, count(*) from referrals group by 1 order by 2 desc`)
  console.log("[v0] referrals table now contains:")
  for (const r of total.rows) console.log(`   ${r.match_status}: ${r.count}`)

  await c.end()
  console.log("[v0] done")
}

main().catch((e) => {
  console.error("backfill failed:", e)
  process.exit(1)
})
