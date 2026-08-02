import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchAllPaged } from "@/lib/supabase/fetch-all"

export async function GET() {
  try {
    const supabase = await createClient()

    // Get work item counts grouped by client key. Paged, because PostgREST
    // caps any single response at 1,000 rows and work_items is well past
    // that — an un-ranged select would silently truncate the counts.
    const workItems = await fetchAllPaged<{ karbon_client_key: string | null; status: string | null }>(
      () => supabase.from("work_items").select("karbon_client_key, status"),
    )

    // Aggregate counts by client key
    const countsMap = new Map<string, { total: number; active: number }>()
    ;(workItems || []).forEach((item) => {
      if (!item.karbon_client_key) return

      const existing = countsMap.get(item.karbon_client_key) || { total: 0, active: 0 }
      existing.total++

      // Count as active if not completed
      const activeStatuses = [
        "In Progress",
        "Ready To Start",
        "Waiting",
        "Planned",
        "in_progress",
        "ready",
        "waiting",
        "planned",
      ]
      if (activeStatuses.some((s) => item.status?.toLowerCase().includes(s.toLowerCase()))) {
        existing.active++
      }

      countsMap.set(item.karbon_client_key, existing)
    })

    // Convert to array
    const counts = Array.from(countsMap.entries()).map(([clientKey, counts]) => ({
      clientKey,
      total: counts.total,
      active: counts.active,
    }))

    return NextResponse.json({ counts })
  } catch (error: any) {
    console.error("[v0] Error in work-items counts route:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
