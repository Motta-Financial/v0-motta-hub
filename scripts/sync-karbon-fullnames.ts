// Run this script to sync FullName from Karbon to Supabase
// Execute via: POST /api/karbon/sync-fullnames

async function syncFullNames() {
  const response = await fetch("/api/karbon/sync-fullnames", {
    method: "POST",
  })

  const result = await response.json()
  console.log("Sync Result:", JSON.stringify(result, null, 2))
  return result
}

// This script is meant to be called via the API endpoint
// Navigate to your app and call: POST /api/karbon/sync-fullnames
export { syncFullNames }
