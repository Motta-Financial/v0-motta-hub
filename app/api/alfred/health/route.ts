// Public health-check endpoint for the ALFRED public surface.
//
// Designed to be called unauthenticated from alfred.motta.cpa (or any
// monitor) so a freshly-deployed environment can self-verify before
// shipping real traffic. It deliberately does NOT call any
// user-scoped queries, return any team member rows, or report which
// secrets are set -- only booleans that fit on a status page.
//
// If you find yourself wanting to add more diagnostic detail here,
// consider a separate auth-required `/api/alfred/diagnostics` route
// instead. This one stays public.

import { applyAlfredCors, preflightResponse } from "@/lib/alfred/cors"
import { createAdminClient } from "@/lib/supabase/server"
import { getAlfredServiceAccount } from "@/lib/alfred/service-account"
import pkg from "@/package.json"

// Always run on the server, never cache. We want every health probe to
// reflect live state -- otherwise a stale "service account missing"
// could persist long after the migration ran.
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function OPTIONS(req: Request) {
  return preflightResponse(req)
}

export async function GET(req: Request) {
  // `supabaseConfigured` is a presence check on the env vars the admin
  // client needs to talk to Supabase. We don't call out to Supabase to
  // verify the credentials themselves -- that's what the
  // `alfredServiceAccountFound` step does, transitively.
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
  )

  // Probe for the singleton ALFRED row. We swallow the throw on purpose:
  // health endpoints should report failure as a boolean, not 500. Any
  // unexpected error path (network, auth, missing migration) collapses
  // to `false` here so the monitor sees the same "not ready" signal.
  let alfredServiceAccountFound = false
  if (supabaseConfigured) {
    try {
      const admin = createAdminClient()
      await getAlfredServiceAccount(admin)
      alfredServiceAccountFound = true
    } catch {
      alfredServiceAccountFound = false
    }
  }

  const body = {
    ok: true,
    version: (pkg as { version?: string }).version ?? "unknown",
    supabaseConfigured,
    alfredServiceAccountFound,
    generatedAt: new Date().toISOString(),
  }

  return applyAlfredCors(Response.json(body), req)
}
