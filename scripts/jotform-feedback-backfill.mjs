// Backfill all historical Jotform Feedback + Referral submissions
// (form 240915444941155) into Supabase. Idempotent — safe to re-run.
//
// Run with:
//   NODE_TLS_REJECT_UNAUTHORIZED=0 \
//     node --env-file-if-exists=/vercel/share/.env.project \
//          scripts/jotform-feedback-backfill.mjs
//
// Optional env: JOTFORM_FEEDBACK_FORM_ID (defaults to the Motta
// Feedback + Referral form). Mirrors the intake backfill so the two
// scripts can be operated identically.

import { createClient } from "@supabase/supabase-js"

const FORM_ID = process.env.JOTFORM_FEEDBACK_FORM_ID || "240915444941155"
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

// ─── Compact helper ports of lib/jotform/parse-feedback.ts so this
//     script runs standalone (no Next.js bundler in cron contexts). ───

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
function ratingA(a) {
  if (!a) return null
  const raw = a.answer
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(n) || n < 1 || n > 5) return null
  return n
}
function clientStatus(a) {
  const v = strA(a)
  if (!v) return null
  const lc = v.toLowerCase()
  if (lc.includes("first")) return "first_time"
  if (lc.includes("exist")) return "existing"
  return null
}
function yesNo(a) {
  const v = strA(a)
  if (!v) return null
  const lc = v.toLowerCase()
  if (lc.startsWith("y")) return true
  if (lc.startsWith("n")) return false
  return null
}
function toIso(t) {
  if (!t) return null
  const s = String(t)
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const REFERRAL_SLUGS = [
  { name: "referralName", email: "referralEmail", notes: "doYou81" },
  { name: "name40", email: "referral2", notes: "doYou86" },
  { name: "name45", email: "email46", notes: "doYou87" },
  { name: "referral4", email: "referral489", notes: "doYou90" },
  { name: "referral5", email: "referral594", notes: "doYou95" },
]

function parseAnswers(answers) {
  const fn = fullnameA(findByName(answers, "pleaseEnter"))

  const referrals = []
  for (const slugs of REFERRAL_SLUGS) {
    const name = fullnameA(findByName(answers, slugs.name))
    const email = strA(findByName(answers, slugs.email))
    const notes = strA(findByName(answers, slugs.notes))
    if (!name.full && !email && !notes) continue
    referrals.push({
      name: name.full,
      first_name: name.first,
      last_name: name.last,
      email,
      notes,
    })
  }

  // Karbon prefill (URL params come through alongside answers).
  const karbon = {
    karbon_work_item_id:
      strA(findByName(answers, "workItemId")) ?? strA(findByName(answers, "karbonWorkItemId")),
    karbon_work_item_title:
      strA(findByName(answers, "workItemTitle")) ?? strA(findByName(answers, "karbonWorkItemTitle")),
    karbon_work_item_url:
      strA(findByName(answers, "workItemUrl")) ?? strA(findByName(answers, "karbonWorkItemUrl")),
  }

  // Anything not part of the canonical question slug list lands in
  // prefill_metadata as a backstop for future column additions.
  const KNOWN_SLUGS = new Set([
    "clickTo", "pleaseEnter", "pleaseEnter79", "areYou",
    "serviceQuality", "communication", "responsiveness", "friendliness",
    "rateYour", "describeYour", "doWe", "doYou",
    "referral", "referralName", "referralEmail", "doYou81", "wouldYou",
    "divider", "referral298", "name40", "referral2", "doYou86", "wouldYou83",
    "divider47", "referral3", "name45", "email46", "doYou87", "wouldYou84",
    "divider62", "referral4100", "referral4", "referral489", "doYou90", "wouldYou91",
    "divider92", "referral5101", "referral5", "referral594", "doYou95",
    "clickTo102", "typeA", "submit",
  ])
  const prefill = {}
  for (const a of Object.values(answers || {})) {
    if (!a?.name) continue
    if (KNOWN_SLUGS.has(a.name)) continue
    prefill[a.name] = a.answer ?? null
  }

  return {
    submitter_first_name: fn.first,
    submitter_last_name: fn.last,
    submitter_full_name: fn.full,
    submitter_email: strA(findByName(answers, "pleaseEnter79")),
    client_status: clientStatus(findByName(answers, "areYou")),

    rating_overall: ratingA(findByName(answers, "rateYour")),
    rating_service_quality: ratingA(findByName(answers, "serviceQuality")),
    rating_communication: ratingA(findByName(answers, "communication")),
    rating_responsiveness: ratingA(findByName(answers, "responsiveness")),
    rating_friendliness: ratingA(findByName(answers, "friendliness")),

    feedback_comments: strA(findByName(answers, "describeYour")),
    permission_to_share: yesNo(findByName(answers, "doWe")),

    has_referral_interest: yesNo(findByName(answers, "doYou")),
    referral_count: referrals.length,
    referrals,

    ...karbon,
    prefill_metadata: prefill,
  }
}

// ─── Resolve form UUID once ───────────────────────────────────────
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

// ─── Walk every page ──────────────────────────────────────────────
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
    .from("jotform_feedback_submissions")
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

console.log("[v0] Feedback backfill complete:", { processed, failures: failures.length })

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
