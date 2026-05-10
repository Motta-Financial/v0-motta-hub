import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// POST /api/accounting/bookkeeping-checklist/summary
//
// Body: { ids: string[] }
//
// Returns an aggregated per-work-item checklist summary so the
// Bookkeeping Dashboard can render one progress bar per engagement
// without firing N requests (one for each row's full progress).
//
// Why POST (not GET): a single dashboard month commonly contains 60+
// engagements; jamming that many UUIDs into a query string risks blowing
// past common URL limits (some upstream proxies cap at ~2KB). POST keeps
// the contract robust as the firm scales.
//
// Response shape:
//   {
//     summaries: Record<workItemId, {
//       completed: number      // 0..10
//       phase1Done: number     // 0..5  (steps 1-5)
//       phase2Done: number     // 0..5  (steps 6-10)
//       lastUpdatedAt: string | null
//     }>
//   }
//
// Missing rows in `bookkeeping_checklist_progress` are treated as
// "step not yet touched" — i.e. not_complete + null timestamps. We do
// not server-side join these to Karbon (the work-item rows themselves
// come from /api/supabase/work-items), this endpoint is purely the
// progress side of the union.
export async function POST(request: Request) {
  let body: { ids?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : []
  // Defensive: only keep non-empty strings so a bad client (e.g. an
  // unfinished mapping that pushed `null` or `undefined`) doesn't blow
  // up Postgres' `in()` filter with a NaN value.
  const ids = rawIds
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    // De-dupe so we don't return duplicate keys in the summary object.
    .filter((v, i, arr) => arr.indexOf(v) === i)

  if (ids.length === 0) {
    return NextResponse.json({ summaries: {} })
  }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("bookkeeping_checklist_progress")
      .select("work_item_id, step_number, is_complete, updated_at")
      .in("work_item_id", ids)

    if (error) {
      console.error("[v0] Bookkeeping summary error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    type Summary = {
      completed: number
      phase1Done: number
      phase2Done: number
      lastUpdatedAt: string | null
    }
    const summaries: Record<string, Summary> = {}
    // Pre-seed every requested id so the response always has an entry
    // for every engagement on the dashboard — even if the engagement
    // has zero completed steps (which is the common case for "this
    // month, just opened").
    for (const id of ids) {
      summaries[id] = {
        completed: 0,
        phase1Done: 0,
        phase2Done: 0,
        lastUpdatedAt: null,
      }
    }

    for (const row of data ?? []) {
      const s = summaries[row.work_item_id]
      if (!s) continue
      if (row.is_complete) {
        s.completed += 1
        if (row.step_number <= 5) s.phase1Done += 1
        else s.phase2Done += 1
      }
      const u = row.updated_at as string | null
      if (u && (!s.lastUpdatedAt || u > s.lastUpdatedAt)) {
        s.lastUpdatedAt = u
      }
    }

    return NextResponse.json({ summaries })
  } catch (err) {
    console.error("[v0] Bookkeeping summary unexpected error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load summary" },
      { status: 500 },
    )
  }
}
