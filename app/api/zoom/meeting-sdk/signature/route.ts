/**
 * POST /api/zoom/meeting-sdk/signature
 *
 * Mints a short-lived HS256 JWT "signature" the Zoom Meeting SDK (Client View)
 * needs to join a meeting. The SDK secret never leaves the server — only the
 * signed token and the public SDK key are returned to the browser.
 *
 * Auth: signed-in Hub teammate only (same gate as the other Zoom routes).
 *
 * Env (separate from the OAuth / S2S apps):
 *   - ZOOM_MEETING_SDK_KEY     (the Meeting SDK app's Client ID)
 *   - ZOOM_MEETING_SDK_SECRET  (the Meeting SDK app's Client Secret)
 * When either is missing we return 503 { configured:false } so the UI can show
 * a clean "join isn't configured yet" state instead of failing opaquely.
 */

import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

export async function POST(req: NextRequest) {
  // Require a session — never hand out signatures anonymously.
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sdkKey = process.env.ZOOM_MEETING_SDK_KEY
  const sdkSecret = process.env.ZOOM_MEETING_SDK_SECRET
  if (!sdkKey || !sdkSecret) {
    return NextResponse.json(
      {
        configured: false,
        error: "Zoom Meeting SDK is not configured. Set ZOOM_MEETING_SDK_KEY and ZOOM_MEETING_SDK_SECRET.",
      },
      { status: 503 },
    )
  }

  let body: { meetingNumber?: string | number; role?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const meetingNumber = String(body.meetingNumber ?? "").replace(/\D/g, "")
  if (!meetingNumber) {
    return NextResponse.json({ error: "missing_meeting_number" }, { status: 400 })
  }
  // Default to participant (0). Host (1) requires a ZAK and is a follow-up.
  const role = body.role === 1 ? 1 : 0

  const iat = Math.floor(Date.now() / 1000) - 30 // small clock-skew cushion
  const exp = iat + 60 * 60 * 2 // 2h validity per Zoom guidance

  const header = { alg: "HS256", typ: "JWT" }
  const payload = {
    appKey: sdkKey,
    sdkKey,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp: exp,
  }

  const segments = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signaturePart = base64url(crypto.createHmac("sha256", sdkSecret).update(segments).digest())
  const signature = `${segments}.${signaturePart}`

  return NextResponse.json({ signature, sdkKey })
}
