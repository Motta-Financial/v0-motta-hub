import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Categories list — drives both the sidebar filter chips and the Add
 * Loom dialog's category dropdown. Read-only for now: categories are
 * pre-seeded (Onboarding, SOPs, Tax, Accounting, Sales, Software &
 * Tools, Culture) and managed centrally rather than by every teammate
 * to keep the taxonomy from sprawling.
 *
 * Also returns a per-category video count so the sidebar can show how
 * many videos live under each chip without a second round trip.
 */
export async function GET() {
  const supabase = await createClient()

  // Two reads in parallel: categories themselves, and a count per
  // category for the sidebar chip badges. We could do this in a single
  // SQL view but the join overhead is negligible at our scale and two
  // tiny queries are easier to evolve later.
  const [{ data: categories, error: catErr }, { data: counts, error: countErr }] =
    await Promise.all([
      supabase
        .from("training_categories")
        .select("id, name, description, color, sort_order")
        .order("sort_order", { ascending: true }),
      supabase
        .from("training_videos")
        .select("category_id"),
    ])

  if (catErr) {
    console.error("[training:cats] supabase error", catErr)
    return NextResponse.json({ error: catErr.message }, { status: 500 })
  }
  if (countErr) {
    console.error("[training:cats] count error", countErr)
    return NextResponse.json({ error: countErr.message }, { status: 500 })
  }

  // Bucket the video rows into a {category_id: count} map. Uncategorized
  // videos (category_id null) accumulate under the synthetic "__none__"
  // key, which the sidebar surfaces as a separate "Uncategorized" chip.
  const countsByCat = (counts ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      const key = row.category_id ?? "__none__"
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    },
    {},
  )

  const enriched = (categories ?? []).map((c) => ({
    ...c,
    video_count: countsByCat[c.id] ?? 0,
  }))

  return NextResponse.json({
    categories: enriched,
    uncategorized_count: countsByCat.__none__ ?? 0,
    // Also surface the total so the "All" chip can show its own count
    // without the client having to re-sum.
    total_count: (counts ?? []).length,
  })
}
