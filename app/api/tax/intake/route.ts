import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { loadFieldDefs } from "@/lib/tax/intake/store"

/**
 * Tax intake sets — list, create, and fetch the field definitions a form
 * needs to render.
 *
 *   GET  /api/tax/intake?taxYear=2025[&contactId=…]   list sets
 *   GET  /api/tax/intake?docType=w2&taxYear=2025      field defs for a form
 *   POST /api/tax/intake                              create a set
 *
 * The tax_input_* tables are service-role-only by RLS (they hold real
 * taxpayer figures and SSNs), so every read here authenticates the
 * preparer first and then uses the admin client deliberately.
 */

async function requireSession() {
  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  return user
}

export async function GET(req: Request) {
  const user = await requireSession()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const taxYear = Number(url.searchParams.get("taxYear")) || new Date().getFullYear() - 1
  const docType = url.searchParams.get("docType")
  const contactId = url.searchParams.get("contactId")

  const admin = createAdminClient()

  // Field-definition mode: what a document form should render, including
  // each field's ProConnect target so the UI can show provenance.
  if (docType) {
    const defs = await loadFieldDefs(admin, { taxYear, docType })
    const list = defs.get(docType) ?? []
    return NextResponse.json({
      docType,
      taxYear,
      fields: list.map((d) => ({
        fieldKey: d.fieldKey,
        label: d.label,
        dataType: d.dataType,
        required: d.required,
        target: `${d.seriesId}/${d.codeId}/${d.suffixId}`,
        confidence: d.confidence,
      })),
    })
  }

  let q = admin
    .from("tax_input_sets")
    .select(
      "id, tax_year, return_type, contact_id, status, filing_status, proconnect_client_id, proconnect_return_id, created_at, updated_at",
    )
    .eq("tax_year", taxYear)
    .order("updated_at", { ascending: false })
  if (contactId) q = q.eq("contact_id", contactId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Document counts per set, in one grouped query rather than per-set.
  const ids = (data ?? []).map((s) => (s as { id: string }).id)
  const counts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: docs } = await admin
      .from("tax_input_documents")
      .select("input_set_id")
      .in("input_set_id", ids)
    for (const d of docs ?? []) {
      const k = (d as { input_set_id: string }).input_set_id
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }

  return NextResponse.json({
    sets: (data ?? []).map((s) => {
      const row = s as Record<string, unknown>
      return { ...row, document_count: counts.get(row.id as string) ?? 0 }
    }),
  })
}

export async function POST(req: Request) {
  const user = await requireSession()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { taxYear?: number; contactId?: string; filingStatus?: string; returnType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.taxYear) {
    return NextResponse.json({ error: "taxYear is required" }, { status: 400 })
  }

  const admin = createAdminClient()

  // Resolve the acting team member so created_by is populated; a missing
  // profile is not fatal here (the set is still valid).
  const { data: tm } = await admin
    .from("team_members")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  const { data, error } = await admin
    .from("tax_input_sets")
    .insert({
      tax_year: body.taxYear,
      return_type: body.returnType ?? "IND",
      contact_id: body.contactId ?? null,
      filing_status: body.filingStatus ?? null,
      created_by: (tm as { id: string } | null)?.id ?? null,
    })
    .select("id, tax_year, return_type, contact_id, status, filing_status")
    .single()

  if (error) {
    // The partial unique index enforces one active gathering per
    // client-year; surface that as a conflict rather than a 500.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "An active intake set already exists for this client and tax year." },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ set: data }, { status: 201 })
}
