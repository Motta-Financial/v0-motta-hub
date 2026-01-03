import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()

  // Get distinct categories with counts
  const { data: services, error } = await supabase
    .from("services")
    .select("category, subcategory")
    .eq("state", "active")

  if (error) {
    console.error("Error fetching categories:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Aggregate categories
  const categoryMap = new Map<string, { count: number; subcategories: Set<string> }>()

  services?.forEach((service) => {
    if (service.category) {
      if (!categoryMap.has(service.category)) {
        categoryMap.set(service.category, { count: 0, subcategories: new Set() })
      }
      const cat = categoryMap.get(service.category)!
      cat.count++
      if (service.subcategory) {
        cat.subcategories.add(service.subcategory)
      }
    }
  })

  const categories = Array.from(categoryMap.entries())
    .map(([name, data]) => ({
      name,
      count: data.count,
      subcategories: Array.from(data.subcategories).sort(),
    }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ categories })
}
