import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    // Get work item counts grouped by client key
    const { data: workItems, error } = await supabase.from("work_items").select("karbon_client_key, status")

    if (error) {
      console.error("[v0] Error fetching work items:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

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
