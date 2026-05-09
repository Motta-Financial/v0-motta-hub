// Bulk auto-matcher for the intake↔client mapping.
//
// Walks every row in jotform_intake_submissions whose link_method
// is NULL or starts with 'auto_', runs the matching heuristics from
// lib/jotform/match-client.ts, and writes back the resolved
// contact_id / organization_id when there's an unambiguous hit.
//
// Idempotent — safe to re-run after the form schema changes, after
// new contacts are imported from Karbon, or after a fresh
// deployment. Manually-linked rows (link_method = 'manual') are
// always skipped.
//
// Usage:
//   pnpm node --env-file-if-exists=/vercel/share/.env.project \
//     scripts/jotform-intake-link-clients.mjs

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[v0] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// ─── Inline copy of the matcher logic ────────────────────────────
// Kept in sync with lib/jotform/match-client.ts. We inline rather
// than import because the script runs as plain Node ESM, and
// importing a .ts file would require the full Next build pipeline.
// Any change to the heuristics needs to be applied in BOTH places.
function normalizeBusinessName(raw) {
  if (!raw) return ""
  return raw
    .toLowerCase()
    .replace(
      /\b(llc|l\.l\.c\.|inc|inc\.|incorporated|corp|corp\.|corporation|co\.|company|llp|l\.l\.p\.|pllc|p\.l\.l\.c\.|pc|p\.c\.|ltd|ltd\.|limited|gmbh|sa|sas|pty|holdings|enterprises)\b/g,
      "",
    )
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
function normalizeEmail(raw) {
  return raw ? String(raw).trim().toLowerCase() : ""
}

async function match(submission) {
  const email = normalizeEmail(submission.submitter_email)
  const bizName = normalizeBusinessName(submission.business_name)

  if (email) {
    const { data: c1 } = await supabase.from("contacts").select("id").ilike("primary_email", email).limit(2)
    if (c1?.length === 1) {
      return { contact_id: c1[0].id, organization_id: null, link_method: "auto_email", reason: `contact.primary_email = ${email}` }
    }
    if (c1 && c1.length > 1) {
      return { contact_id: null, organization_id: null, link_method: null, reason: `ambiguous: ${c1.length} contacts share ${email}` }
    }
    const { data: c2 } = await supabase.from("contacts").select("id").ilike("secondary_email", email).limit(2)
    if (c2?.length === 1) {
      return { contact_id: c2[0].id, organization_id: null, link_method: "auto_email", reason: `contact.secondary_email = ${email}` }
    }
    const { data: o1 } = await supabase.from("organizations").select("id").ilike("primary_email", email).limit(2)
    if (o1?.length === 1) {
      return { contact_id: null, organization_id: o1[0].id, link_method: "auto_email", reason: `org.primary_email = ${email}` }
    }
  }

  if (bizName && bizName.length >= 3) {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, full_name")
      .or(`name.ilike.%${bizName}%,full_name.ilike.%${bizName}%`)
      .limit(20)
    const exact = (orgs ?? []).filter((o) => {
      return normalizeBusinessName(o.name) === bizName || normalizeBusinessName(o.full_name) === bizName
    })
    if (exact.length === 1) {
      return { contact_id: null, organization_id: exact[0].id, link_method: "auto_business_name", reason: `org.name (normalized) = ${bizName}` }
    }
    if (exact.length > 1) {
      return { contact_id: null, organization_id: null, link_method: null, reason: `ambiguous: ${exact.length} orgs match ${bizName}` }
    }
  }

  return { contact_id: null, organization_id: null, link_method: null, reason: null }
}

// ─── Main ────────────────────────────────────────────────────────
console.log("[v0] Loading auto-managed intake submissions…")
const { data: rows, error } = await supabase
  .from("jotform_intake_submissions")
  .select("id, submitter_email, submitter_full_name, business_name, contact_id, organization_id, link_method")
  .or("link_method.is.null,link_method.like.auto_%")

if (error) {
  console.error("[v0] Error loading rows:", error.message)
  process.exit(1)
}
console.log(`[v0] ${rows.length} candidates to evaluate (manual links are excluded)`)

const stats = {
  matched_email: 0,
  matched_biz: 0,
  ambiguous: 0,
  no_match: 0,
  unchanged: 0,
  errors: 0,
}

for (const row of rows) {
  const result = await match(row)
  // Decide whether to update.
  const hasNewLink = !!result.link_method
  const wasLinked = !!(row.contact_id || row.organization_id)
  const linkChanged =
    hasNewLink &&
    (result.contact_id !== row.contact_id || result.organization_id !== row.organization_id)

  if (!hasNewLink && !wasLinked) {
    stats.no_match++
    continue
  }
  if (!hasNewLink && wasLinked) {
    // Was auto-linked previously, no longer matches. Clear.
    const { error: e } = await supabase
      .from("jotform_intake_submissions")
      .update({ contact_id: null, organization_id: null, link_method: null, linked_at: null })
      .eq("id", row.id)
      .or("link_method.is.null,link_method.like.auto_%")
    if (e) stats.errors++
    else console.log(`  cleared stale link  id=${row.id}  reason=${result.reason || "no match"}`)
    continue
  }
  if (!linkChanged) {
    stats.unchanged++
    continue
  }

  const { error: e } = await supabase
    .from("jotform_intake_submissions")
    .update({
      contact_id: result.contact_id,
      organization_id: result.organization_id,
      link_method: result.link_method,
      linked_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .or("link_method.is.null,link_method.like.auto_%")

  if (e) {
    stats.errors++
    console.log(`  ERROR  id=${row.id}  ${e.message}`)
    continue
  }
  if (result.link_method === "auto_email") stats.matched_email++
  else if (result.link_method === "auto_business_name") stats.matched_biz++
  console.log(`  linked  id=${row.id.slice(0, 8)}  via=${result.link_method}  ${result.reason}`)
}

const ambiguous = rows.filter(async (r) => {
  const m = await match(r)
  return m.reason?.startsWith("ambiguous")
})
stats.ambiguous = ambiguous.length

console.log()
console.log("[v0] Summary:")
console.log("  matched by email:        ", stats.matched_email)
console.log("  matched by business name:", stats.matched_biz)
console.log("  unchanged (already linked):", stats.unchanged)
console.log("  no match:                ", stats.no_match)
console.log("  errors:                  ", stats.errors)

const { count: linkedCount } = await supabase
  .from("jotform_intake_submissions")
  .select("*", { count: "exact", head: true })
  .or("contact_id.not.is.null,organization_id.not.is.null")
const { count: total } = await supabase
  .from("jotform_intake_submissions")
  .select("*", { count: "exact", head: true })
console.log(`\n[v0] Final state: ${linkedCount}/${total} intake submissions linked to a client`)
