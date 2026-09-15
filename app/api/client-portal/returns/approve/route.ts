/**
 * POST /api/client-portal/returns/approve
 * Body: { consentText: string, taxYear?: number, taxReturnId?: string,
 *         documentId?: string, withdraw?: boolean }
 *
 * Records a client approving their return for filing, as an append-only
 * row in return_approvals (scripts/421).
 *
 * The caller sends the consent wording it actually displayed, and we store
 * that string verbatim. This is the point of the table: a boolean on a
 * return row cannot answer "what did this person agree to" once the
 * wording on screen has changed. Approving twice writes two rows; a
 * withdrawal writes a third. Nothing is ever updated or deleted.
 */
import { NextResponse, type NextRequest } from "next/server"

import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"

/**
 * Vercel puts the real client IP first in x-forwarded-for; everything after
 * is proxy hops. Stored as inet, so a malformed value must become null
 * rather than fail the insert -- losing the IP is survivable, losing the
 * approval is not.
 */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for")
  const candidate = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")
  if (!candidate) return null
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)
  const isIpv6 = candidate.includes(":")
  return isIpv4 || isIpv6 ? candidate : null
}

export async function POST(request: NextRequest) {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth

  let consentText: string
  let taxYear: number | null
  let taxReturnId: string | null
  let documentId: string | null
  let withdraw: boolean
  try {
    const json = await request.json()
    consentText = (json?.consentText ?? "").trim()
    taxYear = typeof json?.taxYear === "number" ? json.taxYear : null
    taxReturnId = json?.taxReturnId ?? null
    documentId = json?.documentId ?? null
    withdraw = json?.withdraw === true
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Refuse rather than substitute a default. An approval whose consent text
  // we invented is worse than no approval at all -- it would look like
  // evidence of something nobody was shown.
  if (!consentText) {
    return NextResponse.json(
      { error: "consentText is required — send the exact wording shown to the client" },
      { status: 400 },
    )
  }

  const contactId = portalUser.contactIds[0] ?? null
  const organizationId = contactId ? null : portalUser.organizationIds[0] ?? null
  if (!contactId && !organizationId) {
    return NextResponse.json({ error: "No linked account found" }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from("return_approvals")
    .insert({
      tax_return_id: taxReturnId,
      document_id: documentId,
      contact_id: contactId,
      organization_id: organizationId,
      portal_user_id: portalUser.id,
      actor_name: portalUser.fullName ?? portalUser.email,
      action: withdraw ? "withdrawn" : "approved",
      tax_year: taxYear,
      consent_text: consentText,
      ip_address: clientIp(request),
      user_agent: request.headers.get("user-agent"),
    })
    .select("id, action, created_at")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ approval: data }, { status: 201 })
}

/**
 * GET /api/client-portal/returns/approve
 * The caller's own approval history, newest first — so the Tax page can
 * show "You approved this on March 3" instead of re-asking.
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  const orFilters = [
    portalUser.contactIds.length > 0 ? `contact_id.in.(${portalUser.contactIds.join(",")})` : null,
    portalUser.organizationIds.length > 0
      ? `organization_id.in.(${portalUser.organizationIds.join(",")})`
      : null,
  ].filter(Boolean)

  if (orFilters.length === 0) {
    return NextResponse.json({ approvals: [] })
  }

  const { data, error } = await supabase
    .from("return_approvals")
    .select("id, action, tax_year, tax_return_id, document_id, actor_name, created_at")
    .or(orFilters.join(","))
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ approvals: data ?? [] })
}
