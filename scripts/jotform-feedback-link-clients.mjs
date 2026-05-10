// scripts/jotform-feedback-link-clients.mjs
//
// Bulk-runs the auto-matcher across every jotform_feedback_submissions
// row whose link_method is null or auto_*, leaving manual links
// untouched. Idempotent — safe to re-run after Karbon syncs new
// contacts.
//
// Mirrors scripts/jotform-intake-link-clients.mjs in shape; the only
// difference is the table name and the matcher entry point (no
// business_name heuristic for feedback).
//
// Run:
//   node --env-file-if-exists=/vercel/share/.env.project \
//        scripts/jotform-feedback-link-clients.mjs

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[v0] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// Inline the matcher logic so this script doesn't depend on
// TypeScript transpilation. Stays in sync with lib/jotform/match-client.ts.
const normalizeEmail = (e) => (e ?? "").trim().toLowerCase()
const normalizeName = (n) => (n ?? "").trim().toLowerCase()

async function matchFeedback(submission) {
  const empty = { contact_id: null, organization_id: null, link_method: null, reason: null }
  const email = normalizeEmail(submission.submitter_email)
  const fullName = normalizeName(submission.submitter_full_name)

  if (email) {
    const { data: c1 } = await sb.from("contacts").select("id").ilike("primary_email", email).limit(2)
    if (c1?.length === 1) return { ...empty, contact_id: c1[0].id, link_method: "auto_email", reason: `primary_email = ${email}` }
    if (c1 && c1.length > 1) return { ...empty, reason: `Ambiguous: ${c1.length} contacts share primary_email ${email}` }

    const { data: c2 } = await sb.from("contacts").select("id").ilike("secondary_email", email).limit(2)
    if (c2?.length === 1) return { ...empty, contact_id: c2[0].id, link_method: "auto_email", reason: `secondary_email = ${email}` }

    const { data: o1 } = await sb.from("organizations").select("id").ilike("primary_email", email).limit(2)
    if (o1?.length === 1) return { ...empty, organization_id: o1[0].id, link_method: "auto_email", reason: `org primary_email = ${email}` }
  }

  if (fullName && fullName.length >= 5) {
    const { data: nm } = await sb.from("contacts").select("id, full_name").ilike("full_name", fullName).limit(2)
    if (nm?.length === 1) return { ...empty, contact_id: nm[0].id, link_method: "auto_name", reason: `full_name = "${fullName}"` }
    if (nm && nm.length > 1) return { ...empty, reason: `Ambiguous: ${nm.length} contacts share name "${fullName}"` }
  }

  return empty
}

console.log("[v0] Loading feedback submissions to match…")
// Pull all rows that aren't manually pinned. Process in memory —
// 44 rows today, won't scale past ~10k but that's fine for a
// monthly-feedback form.
const { data: rows, error } = await sb
  .from("jotform_feedback_submissions")
  .select("id, submitter_email, submitter_full_name, contact_id, organization_id, link_method")
  .or("link_method.is.null,link_method.like.auto_%")

if (error) {
  console.error("[v0] Query failed:", error.message)
  process.exit(1)
}

console.log(`[v0] ${rows.length} candidate rows`)

let linkedEmail = 0
let linkedName = 0
let unchanged = 0
let cleared = 0
let ambiguous = 0

for (const row of rows) {
  const result = await matchFeedback(row)

  // Skip when result matches the row's existing state (no-op).
  const sameState =
    result.contact_id === row.contact_id &&
    result.organization_id === row.organization_id &&
    result.link_method === row.link_method
  if (sameState) {
    unchanged++
    continue
  }

  // Track ambiguous results separately for visibility.
  if (!result.link_method && result.reason?.startsWith("Ambiguous")) {
    ambiguous++
    continue
  }

  await sb
    .from("jotform_feedback_submissions")
    .update({
      contact_id: result.contact_id,
      organization_id: result.organization_id,
      link_method: result.link_method,
      linked_at: result.link_method ? new Date().toISOString() : null,
    })
    .eq("id", row.id)

  if (result.link_method === "auto_email") linkedEmail++
  else if (result.link_method === "auto_name") linkedName++
  else if (!result.link_method && (row.contact_id || row.organization_id)) cleared++
}

console.log()
console.log(`[v0] Backfill complete:`)
console.log(`  linked by email:        ${linkedEmail}`)
console.log(`  linked by name:         ${linkedName}`)
console.log(`  cleared (no longer matching): ${cleared}`)
console.log(`  unchanged (already correct):  ${unchanged}`)
console.log(`  ambiguous (multiple matches): ${ambiguous}`)

const { count: linkedTotal } = await sb
  .from("jotform_feedback_submissions")
  .select("*", { count: "exact", head: true })
  .or("contact_id.not.is.null,organization_id.not.is.null")
const { count: total } = await sb
  .from("jotform_feedback_submissions")
  .select("*", { count: "exact", head: true })
console.log()
console.log(`  ${linkedTotal} / ${total} feedback rows now linked to a client`)
