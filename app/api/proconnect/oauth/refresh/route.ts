/**
 * Force a ProConnect OAuth token refresh — and nothing else.
 *
 * Why this exists: local scripts can't refresh the token themselves. The
 * ProConnect client creds in a `.env.local` pulled from this repo's default
 * Vercel project fail with `invalid_client` (the live integration lives on the
 * `mottahub` project), but the *stored* access token in Supabase is shared. So
 * the established pattern is: have production refresh it, then run locally
 * against the fresh token for its ~1h life.
 *
 * Until now the only way to do that was `POST /api/proconnect/sync`, which
 * refreshes the token as a side effect of running a full bulk sync. That is a
 * sledgehammer, and on 2026-07-28 it did real damage: two such calls, made only
 * to refresh a token mid-backfill, ran the then-deployed sync code that wrote
 * `efile_status` from the engagement list payload and blanked 407 freshly
 * hydrated e-file statuses. Recoverable (the detail lives in `efile_latest`),
 * but entirely self-inflicted — the caller wanted a token, not a sync.
 *
 * Authorisation matches the sync route: CRON_SECRET bearer, or a
 * leadership-role session.
 */

import { NextRequest, NextResponse } from "next/server"
import { forceTokenRefresh, getTokenStatus } from "@/lib/proconnect/oauth"
import { requireLeadership } from "@/lib/auth/require-leadership"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  const cronOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!cronOk) {
    const auth = await requireLeadership()
    if (!auth.ok) {
      return auth.response
    }
  }

  try {
    await forceTokenRefresh()
    const status = await getTokenStatus()
    // The token itself is never returned — callers use it via the stored row,
    // and echoing it would put a live credential in script logs.
    return NextResponse.json({
      ok: true,
      expiresAt: status.expiresAt,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
