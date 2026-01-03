/**
 * Sync Work Statuses from Karbon to Supabase
 * Run this script to fetch all work statuses from Karbon and populate the work_status table
 */

async function syncWorkStatuses() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  console.log("Fetching work statuses from Karbon and syncing to Supabase...")

  const response = await fetch(`${baseUrl}/api/karbon/work-statuses?sync=true`)
  const data = await response.json()

  if (data.error) {
    console.error("Error:", data.error)
    return
  }

  console.log(`Successfully synced ${data.count} work statuses`)
  console.log("\nStatuses:")
  data.statuses.forEach((status: any) => {
    console.log(`  - ${status.name} (${status.is_default_filter ? "✓ included" : "✗ excluded"} in active filter)`)
  })
}

syncWorkStatuses()
