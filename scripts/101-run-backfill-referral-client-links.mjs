/**
 * Backfill — auto-link `jotform_intake_submissions.referral_source` to
 * existing clients (contacts/organizations) where we can match unambiguously.
 *
 * Resolution rules (intentionally conservative — a wrong link is worse
 * than no link, because it implies a referral relationship that doesn't
 * exist):
 *
 *   1. Trim + lowercase the referral_source string.
 *   2. If it contains a comma we treat it as a list and try the first
 *      element only — "Andrew Castronovo, Emily Mooza" → "andrew castronovo".
 *      The triager can manually pick the second referrer in the UI.
 *   3. Match against contacts.full_name (case-insensitive equality).
 *      If exactly ONE row matches, write referral_contact_id.
 *   4. Otherwise match against organizations.name. Same single-match rule.
 *   5. Otherwise leave both columns null — the UI surfaces a "Link or create"
 *      affordance for the unresolved string.
 *
 * The script is idempotent: it skips rows that already have a manual link.
 *
 * Usage:
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     scripts/101-run-backfill-referral-client-links.mjs
 */
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

function normalize(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

async function main() {
  // Load every submission that has a referral_source but no resolved
  // FKs yet. Manual links (set by triagers) are preserved by checking
  // both FK columns are null.
  const { data: rows, error } = await supabase
    .from("jotform_intake_submissions")
    .select("id, referral_source")
    .not("referral_source", "is", null)
    .is("referral_contact_id", null)
    .is("referral_organization_id", null)

  if (error) throw error

  console.log(`[backfill] ${rows.length} submission(s) with unresolved referral_source`)

  let contactHits = 0
  let orgHits = 0
  let ambiguous = 0
  let unmatched = 0

  for (const r of rows) {
    const raw = (r.referral_source || "").split(/[,/&]+/)[0]
    const needle = normalize(raw)
    if (!needle || needle.length < 3) {
      unmatched++
      continue
    }

    // Try contacts first — referrals are far more often individuals
    // than firms. ilike with the bare needle (no wildcards) gives us
    // case-insensitive equality, which is what we want for a strict
    // backfill.
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, full_name")
      .ilike("full_name", needle)
      .limit(2)

    if (contacts && contacts.length === 1) {
      await supabase
        .from("jotform_intake_submissions")
        .update({ referral_contact_id: contacts[0].id })
        .eq("id", r.id)
      contactHits++
      continue
    }
    if (contacts && contacts.length > 1) {
      ambiguous++
      continue
    }

    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name")
      .ilike("name", needle)
      .limit(2)

    if (orgs && orgs.length === 1) {
      await supabase
        .from("jotform_intake_submissions")
        .update({ referral_organization_id: orgs[0].id })
        .eq("id", r.id)
      orgHits++
      continue
    }
    if (orgs && orgs.length > 1) {
      ambiguous++
      continue
    }

    unmatched++
  }

  console.log(
    `[backfill] done — contacts: ${contactHits}, orgs: ${orgHits}, ambiguous: ${ambiguous}, unmatched: ${unmatched}`,
  )
}

main().catch((err) => {
  console.error("[backfill] fatal:", err)
  process.exit(1)
})
