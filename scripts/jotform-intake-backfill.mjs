// Backfill all historical Jotform intake submissions into Supabase.
// Run with:
//   NODE_TLS_REJECT_UNAUTHORIZED=0 \
//     node --env-file-if-exists=/vercel/share/.env.project \
//          scripts/jotform-intake-backfill.mjs
//
// Optional env: JOTFORM_FORM_ID (defaults to the Motta intake form).
// Idempotent — safe to re-run; upserts on jotform_submission_id.

import { createClient } from "@supabase/supabase-js"

const FORM_ID = process.env.JOTFORM_FORM_ID || "242306172162144"
const API_KEY = process.env.JOTFORM_API_KEY
const SUPA_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

if (!API_KEY) {
  console.error("[v0] JOTFORM_API_KEY missing")
  process.exit(1)
}
if (!SUPA_URL || !SUPA_KEY) {
  console.error("[v0] Supabase URL/key missing")
  process.exit(1)
}

const supabase = createClient(SUPA_URL, SUPA_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── Helpers (compact ports of lib/jotform/parse.ts so this script
//    stands alone and runs without the Next.js bundler). ────────────

function findByName(answers, name) {
  for (const a of Object.values(answers || {})) if (a?.name === name) return a
  return undefined
}
function strA(a) {
  if (!a) return null
  const v = a.answer
  if (typeof v === "string") return v.trim() || null
  if (typeof v === "number") return String(v)
  return null
}
function arrA(a) {
  if (!a) return null
  const v = a.answer
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === "string" && v) return [v]
  return null
}
function objA(a) {
  if (!a) return null
  const v = a.answer
  return v && typeof v === "object" && !Array.isArray(v) ? v : null
}
function fullnameA(a) {
  const o = objA(a)
  if (!o) return { first: null, last: null, full: null }
  const first = (o.first || "").trim() || null
  const last = (o.last || "").trim() || null
  const middle = (o.middle || "").trim() || null
  const full = [first, middle, last].filter(Boolean).join(" ") || null
  return { first, last, full }
}
function phoneA(a) {
  const o = objA(a)
  if (o && typeof o.full === "string") return o.full.trim() || null
  return strA(a)
}
function addrA(a) {
  const o = objA(a)
  if (!o) return { full: null, city: null, state: null, zip: null }
  return {
    full: o,
    city: (o.city || "").trim() || null,
    state: (o.state || "").trim() || null,
    zip: (o.postal || "").trim() || null,
  }
}
function mixedContact(a) {
  const o = objA(a)
  if (!o) return { email: null, phone: null }
  return {
    email: (o.email || "").trim() || null,
    phone: (o.phone || "").trim() || null,
  }
}
function toIso(t) {
  if (!t) return null
  const s = String(t)
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function parseAnswers(answers) {
  const fn = fullnameA(findByName(answers, "whatIs1"))
  const pa = addrA(findByName(answers, "personalAddress"))

  const exBizName = strA(findByName(answers, "whatsThe"))
  const exBizAddr = addrA(findByName(answers, "whatIs"))
  const exContact = mixedContact(findByName(answers, "existingBusiness"))
  const exTaxClass = strA(findByName(answers, "whatIs75"))
  const exSummary = strA(findByName(answers, "pleaseProvide91"))
  const exAccounting = strA(findByName(answers, "doesYour"))
  const exEmployees = strA(findByName(answers, "howMany105"))
  const exRevenue = strA(findByName(answers, "whatIs118"))
  const exExtra = strA(findByName(answers, "isThere"))

  const newBizName = strA(findByName(answers, "whatIs31"))
  const newBizAddr = addrA(findByName(answers, "whatIs82"))
  const newBizPhone = phoneA(findByName(answers, "whatIs93"))
  const newBizState = addrA(findByName(answers, "whatIs33"))
  const newBizSummary = strA(findByName(answers, "pleaseProvide"))

  return {
    submitter_first_name: fn.first,
    submitter_last_name: fn.last,
    submitter_full_name: fn.full,
    submitter_email: strA(findByName(answers, "personalEmail")),
    submitter_phone: phoneA(findByName(answers, "personalPhone")),
    submitter_address: pa.full,
    submitter_city: pa.city,
    submitter_state: pa.state,
    submitter_zip: pa.zip,
    services_requested: arrA(findByName(answers, "whatServices")),
    service_focus: strA(findByName(answers, "whatBest")),
    entity_types: arrA(findByName(answers, "whatTypes")),
    business_situation: strA(findByName(answers, "whichBest")),
    business_name: exBizName ?? newBizName,
    business_email: exContact.email,
    business_phone: exContact.phone ?? newBizPhone,
    business_address: exBizAddr.full ?? newBizAddr.full,
    business_state: exBizAddr.state ?? newBizState.state,
    business_tax_classification: exTaxClass,
    business_summary: exSummary ?? newBizSummary,
    business_revenue_range: exRevenue,
    business_employee_count: exEmployees,
    business_uses_accounting_system: exAccounting,
    questions_or_concerns: strA(findByName(answers, "doYou")),
    additional_notes: exExtra,
  }
}

// ── Resolve form UUID once ─────────────────────────────────────────
const { data: formRow, error: formErr } = await supabase
  .from("jotform_forms")
  .select("id")
  .eq("jotform_form_id", FORM_ID)
  .maybeSingle()
if (formErr) {
  console.error("[v0] form lookup failed:", formErr.message)
  process.exit(1)
}
const formUuid = formRow?.id ?? null

// ── Walk every page ────────────────────────────────────────────────
let offset = 0
const PAGE = 100
let processed = 0
const failures = []

while (true) {
  const url = new URL(`https://api.jotform.com/form/${FORM_ID}/submissions`)
  url.searchParams.set("apiKey", API_KEY)
  url.searchParams.set("limit", String(PAGE))
  url.searchParams.set("offset", String(offset))
  url.searchParams.set("orderby", "created_at")

  const res = await fetch(url.toString(), { cache: "no-store" })
  const body = await res.json()
  if (!res.ok || body.responseCode !== 200) {
    console.error("[v0] Jotform list failed:", body.message)
    process.exit(1)
  }
  const subs = body.content || []
  if (subs.length === 0) break

  // Build rows
  const rows = subs.map((s) => ({
    jotform_submission_id: s.id,
    jotform_form_id: s.form_id,
    form_id: formUuid,
    status: s.status ?? null,
    flag: typeof s.flag === "string" ? Number.parseInt(s.flag, 10) : s.flag,
    is_new: String(s.new) === "1",
    ip_address: s.ip ?? null,
    jotform_created_at: toIso(s.created_at),
    jotform_updated_at: toIso(s.updated_at),
    raw_answers: s.answers ?? {},
    last_synced_at: new Date().toISOString(),
    ...parseAnswers(s.answers ?? {}),
  }))

  const { error: upErr } = await supabase
    .from("jotform_intake_submissions")
    .upsert(rows, { onConflict: "jotform_submission_id" })

  if (upErr) {
    console.error(`[v0] Batch upsert failed at offset ${offset}:`, upErr.message)
    failures.push({ offset, error: upErr.message })
  } else {
    processed += rows.length
    console.log(`[v0] Upserted page offset=${offset} (${rows.length}); total=${processed}`)
  }

  if (subs.length < PAGE) break
  offset += PAGE
}

console.log("[v0] Backfill complete:", { processed, failures: failures.length })

// Update the form row with the latest sync timestamp + counts.
await supabase
  .from("jotform_forms")
  .update({
    last_synced_at: new Date().toISOString(),
    submission_count: processed,
  })
  .eq("jotform_form_id", FORM_ID)

if (failures.length) {
  console.error("[v0] Failures:", failures)
  process.exitCode = 1
}
