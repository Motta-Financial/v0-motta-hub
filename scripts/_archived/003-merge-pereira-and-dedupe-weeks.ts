/**
 * One-time migration:
 * 1. Merge "Matthew Pereira" ballots into "Matt Pereira" (canonical team_members entry)
 * 2. Deduplicate Tommy Award weeks (timezone bug created Saturday-dated duplicates of Friday weeks)
 *
 * Run with:
 *   node --env-file-if-exists=/vercel/share/.env.project --import tsx scripts/003-merge-pereira-and-dedupe-weeks.ts
 */

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const CANONICAL_PEREIRA_ID = "910afa82-3f61-4f6f-a9a6-ceec31f0c691"
const CANONICAL_PEREIRA_NAME = "Matt Pereira"
const VARIANT_NAMES = ["Matthew Pereira"]

async function mergePereira() {
  console.log("\n=== Merging Matthew Pereira → Matt Pereira ===")

  const fields = [
    { id: "voter_id", name: "voter_name" },
    { id: "first_place_id", name: "first_place_name" },
    { id: "second_place_id", name: "second_place_name" },
    { id: "third_place_id", name: "third_place_name" },
    { id: "honorable_mention_id", name: "honorable_mention_name" },
    { id: "partner_vote_id", name: "partner_vote_name" },
  ]

  let totalUpdated = 0

  for (const f of fields) {
    const { data: matches, error } = await supabase
      .from("tommy_award_ballots")
      .select(`id, ${f.name}, ${f.id}`)
      .in(f.name, VARIANT_NAMES)

    if (error) {
      console.error(`Error querying ${f.name}:`, error.message)
      continue
    }

    if (!matches || matches.length === 0) {
      console.log(`  ${f.name}: 0 ballots to update`)
      continue
    }

    const ids = matches.map((m: any) => m.id)
    const { error: updateError } = await supabase
      .from("tommy_award_ballots")
      .update({
        [f.name]: CANONICAL_PEREIRA_NAME,
        [f.id]: CANONICAL_PEREIRA_ID,
      })
      .in("id", ids)

    if (updateError) {
      console.error(`  ${f.name}: update failed:`, updateError.message)
    } else {
      console.log(`  ${f.name}: updated ${matches.length} ballots`)
      totalUpdated += matches.length
    }
  }

  // Also update audit history table
  console.log("\n--- Updating ballot history audit trail ---")
  for (const f of fields) {
    if (f.name === "voter_name") continue // history table doesn't have voter_name
    
    try {
      const { data: matches } = await supabase
        .from("tommy_award_ballot_history")
        .select(`id`)
        .in(f.name, VARIANT_NAMES)

      if (matches && matches.length > 0) {
        const ids = matches.map((m: any) => m.id)
        const { error } = await supabase
          .from("tommy_award_ballot_history")
          .update({
            [f.name]: CANONICAL_PEREIRA_NAME,
            [f.id]: CANONICAL_PEREIRA_ID,
          })
          .in("id", ids)
        if (!error) console.log(`  history ${f.name}: updated ${matches.length} rows`)
      }
    } catch {
      // table may not exist yet
    }
  }

  console.log(`\nTotal ballot fields updated: ${totalUpdated}`)
}

async function dedupeWeeks() {
  console.log("\n=== Deduplicating Tommy Award Weeks ===")

  const { data: weeks, error } = await supabase
    .from("tommy_award_weeks")
    .select("id, week_date, week_name, is_active")
    .order("week_date", { ascending: false })

  if (error) {
    console.error("Failed to fetch weeks:", error.message)
    return
  }

  // Group by week_name to find duplicates
  const groups: Record<string, typeof weeks> = {}
  for (const w of weeks || []) {
    if (!groups[w.week_name]) groups[w.week_name] = []
    groups[w.week_name]!.push(w)
  }

  for (const [weekName, items] of Object.entries(groups)) {
    if (items.length <= 1) continue

    console.log(`\nDuplicate: ${weekName} (${items.length} entries)`)
    for (const it of items) {
      console.log(`  - ${it.id} | ${it.week_date} | active: ${it.is_active}`)
    }

    // Choose canonical: the one whose week_date is a Friday (day 5 in UTC)
    // For pre-existing data, Friday-dated weeks are correct
    const fridays = items.filter((it) => {
      const d = new Date(it.week_date + "T12:00:00Z")
      return d.getUTCDay() === 5
    })
    const canonical = fridays.length > 0 ? fridays[0] : items[0]
    const duplicates = items.filter((it) => it.id !== canonical.id)

    console.log(`  → keeping canonical: ${canonical.id} (${canonical.week_date})`)

    // Migrate ballots from duplicates to canonical
    for (const dup of duplicates) {
      const { data: dupBallots, error: ballotsErr } = await supabase
        .from("tommy_award_ballots")
        .select("id, voter_id")
        .eq("week_id", dup.id)

      if (ballotsErr) {
        console.error(`    error reading ballots for ${dup.id}:`, ballotsErr.message)
        continue
      }

      if (dupBallots && dupBallots.length > 0) {
        // Check for ballots that already exist in canonical for the same voter
        const { data: canonicalBallots } = await supabase
          .from("tommy_award_ballots")
          .select("id, voter_id")
          .eq("week_id", canonical.id)

        const canonicalVoterIds = new Set((canonicalBallots || []).map((b) => b.voter_id))

        const movableBallots = dupBallots.filter((b) => !canonicalVoterIds.has(b.voter_id))
        const conflictingBallots = dupBallots.filter((b) => canonicalVoterIds.has(b.voter_id))

        if (movableBallots.length > 0) {
          const { error: moveErr } = await supabase
            .from("tommy_award_ballots")
            .update({ week_id: canonical.id, week_date: canonical.week_date })
            .in("id", movableBallots.map((b) => b.id))
          if (moveErr) {
            console.error(`    error moving ballots:`, moveErr.message)
            continue
          }
          console.log(`    moved ${movableBallots.length} ballots to canonical`)
        }

        if (conflictingBallots.length > 0) {
          // Voter already has ballot in canonical; delete the duplicate
          const { error: delErr } = await supabase
            .from("tommy_award_ballots")
            .delete()
            .in("id", conflictingBallots.map((b) => b.id))
          if (delErr) {
            console.error(`    error deleting conflicting ballots:`, delErr.message)
            continue
          }
          console.log(`    deleted ${conflictingBallots.length} duplicate ballots (voter had both)`)
        }
      }

      // Delete the duplicate week
      const { error: delErr } = await supabase
        .from("tommy_award_weeks")
        .delete()
        .eq("id", dup.id)
      if (delErr) {
        console.error(`    error deleting week ${dup.id}:`, delErr.message)
      } else {
        console.log(`    deleted duplicate week ${dup.id} (${dup.week_date})`)
      }
    }

    // Ensure canonical is active if any duplicate was active
    if (!canonical.is_active && items.some((it) => it.is_active)) {
      await supabase.from("tommy_award_weeks").update({ is_active: true }).eq("id", canonical.id)
      console.log(`    activated canonical week`)
    }
  }
}

async function main() {
  await mergePereira()
  await dedupeWeeks()
  console.log("\nMigration complete.")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
