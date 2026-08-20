/**
 * POST /api/prospects/[id]/create-tax-return
 *
 * Closes the one confirmed gap from the ProConnect API coverage audit:
 * "Create Tax Return in PTO" (POST /v2/clients/oii-client/{id}/returns).
 *
 * ⚠️ SPEC CAVEAT — the authoritative spec ("ProConnect Open API — Series
 * Map Export & Import (Phase 1) v3") only documents Export and Import; it
 * does not define this endpoint. The path/payload here come from a
 * separate, unconfirmed doc. That doc also confirms only the IND (1040)
 * module is live today — COR/PAR/SCO/FID/EXM/GFT are "will follow" and are
 * rejected below. Treat any response from `createTaxReturn()` — success or
 * failure — as unverified until confirmed against a live Intuit call.
 *
 * Safety model (per product decision):
 *   - Leadership-gated, same as the Import write-back route.
 *   - NEVER creates a ProConnect client. Requires the prospect's linked
 *     Hub contact/organization to already have exactly one matching row
 *     in `proconnect_clients` (see the /proconnect-match preview route).
 *   - Always requires an explicit human confirmation: the caller must
 *     echo back the `proconnectClientId` it saw in the match preview.
 *     If it doesn't match what we resolve server-side, we reject rather
 *     than silently using a different client.
 *   - Every attempt (success, rejection, or ProConnect error) is logged
 *     to `proconnect_tax_return_creation_jobs` — there is no delete
 *     endpoint for a created return, so a bad call can't be undone via
 *     the API and the audit trail is the only record of what happened.
 *
 * Request body:
 *   {
 *     proconnectClientId: string   // must match the resolved match
 *     name: string                 // display name for the return
 *     type: string                 // IND/COR/PAR/SCO/FID/EXM/GFT
 *     year: number                 // tax year (period)
 *     source?: string              // prior-year engagement id, for proforma
 *   }
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireLeadership } from "@/lib/auth/require-leadership"
import { createTaxReturn, RETURN_TYPE_MAP, SUPPORTED_RETURN_TYPES } from "@/lib/proconnect/client"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

type RequestBody = {
  proconnectClientId?: string
  name?: string
  type?: string
  year?: number
  source?: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireLeadership()
    if (!auth.ok) return auth.response

    const { id } = await params
    if (!id || !isUuid(id)) {
      return NextResponse.json({ error: "Invalid prospect id" }, { status: 400 })
    }

    const body: RequestBody = await req.json().catch(() => ({}))
    const { proconnectClientId, name, type, year, source } = body

    if (!proconnectClientId || typeof proconnectClientId !== "string") {
      return NextResponse.json(
        { error: "proconnectClientId is required — confirm the match preview first." },
        { status: 400 },
      )
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    if (!type || typeof type !== "string" || !(type in RETURN_TYPE_MAP)) {
      return NextResponse.json(
        {
          error: `type must be one of: ${Object.keys(RETURN_TYPE_MAP).join(", ")}`,
        },
        { status: 400 },
      )
    }
    // Per the authoritative Phase 1 v3 doc, only the IND (1040) module is
    // confirmed live — COR/PAR/SCO/FID/EXM/GFT are documented as "will
    // follow" and are not yet available. Reject them here rather than
    // sending an unsupported request to ProConnect and logging a confusing
    // failure.
    if (!(SUPPORTED_RETURN_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        {
          error: `type "${type}" is not yet supported by ProConnect's Open API (Phase 1 covers ${SUPPORTED_RETURN_TYPES.join(", ")} only; other modules are documented as "will follow").`,
          code: "module_not_supported",
        },
        { status: 422 },
      )
    }
    if (!year || typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "year must be a valid 4-digit tax year" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // ── Re-resolve the match server-side — never trust the client's
    // claimed proconnectClientId without re-deriving it from the same
    // prospect → contact/org → proconnect_clients path used by the
    // preview endpoint. This is what prevents a stale or tampered
    // client id from ever reaching ProConnect.
    const { data: submission, error: submissionError } = await supabase
      .from("prospect_submissions")
      .select("id, contact_id, organization_id")
      .eq("id", id)
      .maybeSingle()

    if (submissionError) throw submissionError
    if (!submission) {
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 })
    }

    if (!submission.contact_id && !submission.organization_id) {
      return NextResponse.json(
        { error: "Prospect isn't linked to a Hub contact or organization.", code: "no_hub_link" },
        { status: 422 },
      )
    }

    const matches: Array<{ proconnect_client_id: string }> = []
    if (submission.contact_id) {
      const { data, error } = await supabase
        .from("proconnect_clients")
        .select("proconnect_client_id")
        .eq("hub_contact_id", submission.contact_id)
      if (error) throw error
      matches.push(...(data || []))
    }
    if (submission.organization_id) {
      const { data, error } = await supabase
        .from("proconnect_clients")
        .select("proconnect_client_id")
        .eq("hub_organization_id", submission.organization_id)
      if (error) throw error
      matches.push(...(data || []))
    }
    const uniqueIds = Array.from(new Set(matches.map((m) => m.proconnect_client_id)))

    if (uniqueIds.length !== 1) {
      return NextResponse.json(
        {
          error:
            uniqueIds.length === 0
              ? "No matching ProConnect client found for this prospect. Refusing to create a tax return without a confirmed client."
              : "This prospect matches more than one ProConnect client. Resolve the ambiguity before creating a tax return.",
          code: uniqueIds.length === 0 ? "no_match" : "ambiguous",
        },
        { status: 409 },
      )
    }

    const resolvedClientId = uniqueIds[0]
    if (resolvedClientId !== proconnectClientId) {
      return NextResponse.json(
        {
          error:
            "The confirmed client id does not match what we resolve for this prospect right now. Re-run the match preview and try again.",
          code: "match_mismatch",
        },
        { status: 409 },
      )
    }

    const payload = {
      name: name.trim(),
      type,
      year,
      ...(source ? { source } : {}),
    }

    // ── Log the attempt BEFORE calling ProConnect. There is no delete
    // endpoint for a created return, so we want a row even if the
    // process crashes mid-call — "did we already try this?" must be
    // answerable from the DB alone.
    const { data: job, error: jobInsertError } = await supabase
      .from("proconnect_tax_return_creation_jobs")
      .insert({
        prospect_submission_id: id,
        proconnect_client_id: resolvedClientId,
        requested_name: payload.name,
        requested_type: payload.type,
        requested_year: payload.year,
        requested_source: payload.source ?? null,
        status: "pending",
        triggered_by: auth.email ?? auth.userId,
        trigger_context: { teamMemberId: auth.teamMemberId, role: auth.role },
      })
      .select("id")
      .single()

    if (jobInsertError) throw jobInsertError

    const result = await createTaxReturn(resolvedClientId, payload)

    const completedAt = new Date().toISOString()

    if (!result.ok) {
      await supabase
        .from("proconnect_tax_return_creation_jobs")
        .update({
          status: "failed",
          http_status: result.status,
          error_message: result.error,
          completed_at: completedAt,
        })
        .eq("id", job.id)

      return NextResponse.json(
        {
          error: result.error || "ProConnect rejected the Create Tax Return request",
          code: "proconnect_error",
          jobId: job.id,
        },
        { status: result.status && result.status >= 400 ? result.status : 502 },
      )
    }

    const created = (result.data ?? {}) as Record<string, unknown>
    const createdEngagementId =
      (created.engagementId as string) ||
      (created.id as string) ||
      (created.returnId as string) ||
      null

    await supabase
      .from("proconnect_tax_return_creation_jobs")
      .update({
        status: "succeeded",
        http_status: result.status,
        response_raw: result.data,
        created_engagement_id: createdEngagementId,
        completed_at: completedAt,
      })
      .eq("id", job.id)

    // Best-effort: mark the prospect as pushed. Never block the response
    // on this — the ProConnect write already succeeded and is the
    // source of truth; a failure here only affects the Hub's own status
    // badge, not what exists in ProConnect.
    await supabase
      .from("prospect_submissions")
      .update({
        proconnect_push_status: "success",
        proconnect_pushed_at: completedAt,
        proconnect_push_error: null,
      })
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.error("[v0] failed to update prospect_submissions push status:", error.message)
      })

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      proconnectClientId: resolvedClientId,
      createdEngagementId,
      response: result.data,
    })
  } catch (err: any) {
    console.error("[v0] POST /api/prospects/[id]/create-tax-return error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}
