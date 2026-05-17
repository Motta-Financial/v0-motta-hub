// Backfill `referral_source` and `preferred_team_member_id` on every
// existing row in `jotform_intake_submissions`. Idempotent: re-running
// only updates rows where the resolved value would actually change.
//
// Why both at once: they're both derived from data that was already in
// `raw_answers` / `preferred_team_member` since day one — only the
// destination columns are new (added in migration 100). Doing it in one
// pass means a single read of every row instead of two.
//
// Run with:
//   NODE_TLS_REJECT_UNAUTHORIZED=0 \
//   node --env-file-if-exists=/vercel/share/.env.project \
//     scripts/100-run-backfill-referral-and-team-fk.mjs
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

if (!url || !key) {
  console.error("[v0] Supabase service-role credentials not configured")
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// Pull active humans once. Same source-of-truth used by the live
// ingest path (`resolvePreferredTeamMember` in lib/jotform/assign.ts);
// keeping the matching logic identical means the backfill produces
// the exact same FKs the webhook would have written had the column
// existed at intake time.
const { data: members, error: memErr } = await supabase
  .from("team_members")
  .select("id, full_name, first_name, last_name")
  .eq("is_active", true)
  .eq("is_service_account", false)
if (memErr) {
  console.error("[v0] team_members fetch failed:", memErr.message)
  process.exit(1)
}

function normalize(s) {
  if (!s) return ""
  return String(s).toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim()
}
function splitFirstLast(n) {
  if (!n) return null
  const parts = n.split(" ").filter(Boolean)
  if (parts.length < 2) return null
  return { first: parts[0], last: parts[parts.length - 1] }
}
const annotated = (members ?? []).map((m) => ({
  id: m.id,
  full_name: m.full_name,
  full: normalize(m.full_name ?? `${m.first_name ?? ""} ${m.last_name ?? ""}`),
  composed: normalize(`${m.first_name ?? ""} ${m.last_name ?? ""}`),
  first: normalize(m.first_name ?? ""),
  last: normalize(m.last_name ?? ""),
}))

function resolveTeamMemberId(rawName) {
  const target = normalize(rawName)
  if (!target) return null
  const full = annotated.find((c) => c.full && c.full === target)
  if (full) return full.id
  const composed = annotated.find((c) => c.composed && c.composed === target)
  if (composed) return composed.id
  const parts = splitFirstLast(target)
  if (parts) {
    const fuzzy = annotated.find(
      (c) => c.first && c.last && c.first === parts.first && c.last === parts.last,
    )
    if (fuzzy) return fuzzy.id
  }
  const surname = annotated.filter((c) => c.last && c.last === target)
  if (surname.length === 1) return surname[0].id
  return null
}

// Walk the table page-by-page so we don't OOM on a large backfill.
const PAGE = 500
let from = 0
let totalRefUpdates = 0
let totalFkUpdates = 0
let totalRows = 0

while (true) {
  const { data, error } = await supabase
    .from("jotform_intake_submissions")
    .select(
      "id, jotform_submission_id, raw_answers, referral_source, preferred_team_member, preferred_team_member_id",
    )
    .order("jotform_created_at", { ascending: true })
    .range(from, from + PAGE - 1)
  if (error) {
    console.error("[v0] page read error:", error.message)
    process.exit(1)
  }
  if (!data || data.length === 0) break

  for (const row of data) {
    totalRows++
    const updates = {}

    // ── referral_source ────────────────────────────────────────────
    // Only set when (a) currently null and (b) raw_answers has a
    // `whoSent` answer. Don't blank out a manually-edited value.
    if (!row.referral_source && row.raw_answers && typeof row.raw_answers === "object") {
      for (const v of Object.values(row.raw_answers)) {
        if (v && typeof v === "object" && v.name === "whoSent") {
          const ans = typeof v.answer === "string" ? v.answer.trim() : ""
          if (ans) {
            updates.referral_source = ans
            break
          }
        }
      }
    }

    // ── preferred_team_member_id ───────────────────────────────────
    // Resolve from the existing free-text column. Skip when already set
    // (idempotent) or when no preferred name was captured.
    if (!row.preferred_team_member_id && row.preferred_team_member) {
      const tmId = resolveTeamMemberId(row.preferred_team_member)
      if (tmId) updates.preferred_team_member_id = tmId
    }

    if (Object.keys(updates).length === 0) continue

    const { error: updErr } = await supabase
      .from("jotform_intake_submissions")
      .update(updates)
      .eq("id", row.id)
    if (updErr) {
      console.error(`[v0] update failed for ${row.id}:`, updErr.message)
      continue
    }
    if (updates.referral_source) totalRefUpdates++
    if (updates.preferred_team_member_id) totalFkUpdates++
  }

  if (data.length < PAGE) break
  from += PAGE
}

console.log(
  `[v0] backfill complete — scanned ${totalRows} rows, set referral_source on ${totalRefUpdates}, preferred_team_member_id on ${totalFkUpdates}`,
)
