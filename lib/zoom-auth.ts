// Centralized Zoom authentication helper
// This gets a Server-to-Server OAuth token directly without HTTP calls

export async function getZoomAccessToken(): Promise<string> {
  const clientId = process.env.ZOOM_CLIENT_ID
  const clientSecret = process.env.ZOOM_CLIENT_SECRET
  const accountId = process.env.ZOOM_ACCOUNT_ID

  if (!clientId || !clientSecret || !accountId) {
    console.error(
      "[v0] Missing Zoom credentials - clientId:",
      !!clientId,
      "clientSecret:",
      !!clientSecret,
      "accountId:",
      !!accountId,
    )
    throw new Error("Zoom credentials not configured")
  }

  console.log("[v0] Fetching Zoom access token via Server-to-Server OAuth...")

  const tokenResponse = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "account_credentials",
      account_id: accountId,
    }),
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    console.error("[v0] Zoom token error:", tokenResponse.status, errorText)
    throw new Error(`Failed to get Zoom access token: ${tokenResponse.status} - ${errorText}`)
  }

  const tokenData = await tokenResponse.json()
  console.log("[v0] Successfully obtained Zoom access token")

  return tokenData.access_token
}
