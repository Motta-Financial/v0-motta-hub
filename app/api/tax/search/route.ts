import { NextRequest, NextResponse } from "next/server"
import { searchTaxClients } from "@/lib/tax/profile"

/**
 * GET /api/tax/search
 * 
 * Search for tax clients across all identifiers.
 * Optimized for ALFRED and Hub functions to quickly identify clients.
 * 
 * Query params:
 * - q: Search query (name, email, phone last 4, SSN last 4, legacy ID)
 * - limit: Max results (default 10)
 * - active: Only active clients (default true)
 * 
 * Examples:
 * - /api/tax/search?q=John Smith
 * - /api/tax/search?q=1234 (phone or SSN last 4)
 * - /api/tax/search?q=john@example.com
 * - /api/tax/search?q=CO_SMITH_JOHN_1234 (legacy ID)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const query = url.searchParams.get("q") || ""
  const limit = parseInt(url.searchParams.get("limit") || "10", 10)
  const activeOnly = url.searchParams.get("active") !== "false"
  
  if (!query.trim()) {
    return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 })
  }
  
  try {
    const results = await searchTaxClients(query, { limit, activeOnly })
    
    return NextResponse.json({
      query,
      count: results.length,
      results,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
