// Auth debug endpoint for the ALFRED public surface.
//
// alfred.motta.cpa hits this after sign-in to verify which auth
// strategy resolved (cookie vs Bearer) and which team_members row was
// matched. The response shape is intentionally narrow -- it returns
// only what the resolver already knows about the caller, never the
// underlying auth.users row, never the raw `team_members` row, never
// any other user's data.
//
// Auth requirements mirror /api/alfred/chat: dual-strategy via
// `resolveAlfredUser`. If neither strategy succeeds, 401 (not 403) so
// the caller can detect "session expired" vs "wrong permissions".

import { applyAlfredCors, preflightResponse } from "@/lib/alfred/cors"
import { resolveAlfredUser } from "@/lib/alfred/resolve-user"

// `audience` is fixed to "staff" here because /whoami is only ever
// useful for the in-Hub debug flow today. If we ever expose a
// client-portal flavor of ALFRED that also needs a whoami, this should
// be derived from the resolved row instead of hard-coded.
const STAFF_AUDIENCE = "staff" as const

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function OPTIONS(req: Request) {
  return preflightResponse(req)
}

export async function GET(req: Request) {
  const user = await resolveAlfredUser(req)
  if (!user) {
    return applyAlfredCors(
      Response.json(
        {
          error: "Unauthorized",
          detail:
            "ALFRED whoami requires either a Supabase session cookie or an Authorization: Bearer token.",
        },
        { status: 401 },
      ),
      req,
    )
  }

  return applyAlfredCors(
    Response.json({
      teamMemberId: user.teamMemberId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      department: user.department,
      audience: STAFF_AUDIENCE,
      resolvedVia: user.resolvedVia,
    }),
    req,
  )
}
