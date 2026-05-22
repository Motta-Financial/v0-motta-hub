/**
 * ProConnect OAuth - Launch
 *
 * Where customers land when they click "Launch" / "Open" on the Intuit
 * App Marketplace listing for Motta Hub. We immediately bounce them
 * into the tax dashboard. If they don't yet have a connected token,
 * /tax will show the connect prompt.
 *
 * Configured in Intuit Developer:
 *   App URLs > Launch URL: https://motta.cpa/api/proconnect/oauth/launch
 */
import { NextRequest, NextResponse } from "next/server"

export async function GET(_request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://motta.cpa"
  return NextResponse.redirect(new URL("/tax", baseUrl))
}
