import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { loadFieldDefs } from "@/lib/tax/intake/store"

/**
 * Documents within an intake set.
 *
 *   POST /api/tax/intake/{setId}/documents        add a document
 *   PUT  /api/tax/intake/{setId}/documents        save a document's values
 *
 * A document is one source form — one W-2. Its `instance_index` becomes
 * the ProConnect prefix, so adding a second W-2 yields p1 against the same
 * s11 codes rather than a different code set.
 */

async function actingTeamMember(admin: ReturnType<typeof createAdminClient>, authUserId: string) {
  const { data } = await admin
    .from("team_members")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function POST(req: Request, ctx: { params: Promise<{ setId: string }> }) {
  const { setId } = await ctx.params

  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { docType?: string; label?: string; taxpayerSpouse?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const docType = body.docType
  if (!docType) return NextResponse.json({ error: "docType is required" }, { status: 400 })

  const admin = createAdminClient()

  // Refuse document types we have no mapping for — otherwise a preparer
  // could key data that can never be imported.
  const { data: setRow } = await admin
    .from("tax_input_sets")
    .select("id, tax_year, return_type")
    .eq("id", setId)
    .maybeSingle()
  if (!setRow) return NextResponse.json({ error: "Intake set not found" }, { status: 404 })
  const s = setRow as { tax_year: number; return_type: string }

  const defs = await loadFieldDefs(admin, {
    taxYear: s.tax_year,
    returnType: s.return_type,
    docType,
  })
  if (!defs.get(docType)?.length) {
    return NextResponse.json(
      {
        error: `No field definitions exist for document type "${docType}" in ${s.tax_year}. It cannot be mapped to ProConnect yet.`,
      },
      { status: 400 },
    )
  }

  // Next instance index for this type. Read-then-insert races are
  // contained by the UNIQUE (input_set_id, doc_type, instance_index)
  // constraint, which surfaces below as a 409.
  const { data: existing } = await admin
    .from("tax_input_documents")
    .select("instance_index")
    .eq("input_set_id", setId)
    .eq("doc_type", docType)
    .order("instance_index", { ascending: false })
    .limit(1)
  const nextIndex =
    existing && existing.length > 0
      ? Number((existing[0] as { instance_index: number }).instance_index) + 1
      : 0

  const { data, error } = await admin
    .from("tax_input_documents")
    .insert({
      input_set_id: setId,
      doc_type: docType,
      instance_index: nextIndex,
      label: body.label ?? null,
      taxpayer_spouse: body.taxpayerSpouse === "S" ? "S" : "T",
      submitted_by: await actingTeamMember(admin, user.id),
    })
    .select("id, doc_type, instance_index, label, taxpayer_spouse")
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That document slot was just taken — retry." },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ document: { ...data, prefixId: `p${nextIndex}` } }, { status: 201 })
}

export async function PUT(req: Request, ctx: { params: Promise<{ setId: string }> }) {
  const { setId } = await ctx.params

  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: {
    documentId?: string
    values?: Record<string, string | number | boolean | null>
    label?: string
    taxpayerSpouse?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.documentId) {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: docRow } = await admin
    .from("tax_input_documents")
    .select("id, doc_type, input_set_id")
    .eq("id", body.documentId)
    .eq("input_set_id", setId)
    .maybeSingle()
  if (!docRow) return NextResponse.json({ error: "Document not found in this set" }, { status: 404 })
  const doc = docRow as { id: string; doc_type: string }

  const { data: setRow } = await admin
    .from("tax_input_sets")
    .select("tax_year, return_type")
    .eq("id", setId)
    .maybeSingle()
  const s = setRow as { tax_year: number; return_type: string }

  const defs = await loadFieldDefs(admin, {
    taxYear: s.tax_year,
    returnType: s.return_type,
    docType: doc.doc_type,
  })
  const byKey = new Map((defs.get(doc.doc_type) ?? []).map((d) => [d.fieldKey, d]))

  const teamMemberId = await actingTeamMember(admin, user.id)
  const now = new Date().toISOString()

  const rows: Array<Record<string, unknown>> = []
  const rejected: string[] = []
  for (const [key, raw] of Object.entries(body.values ?? {})) {
    const def = byKey.get(key)
    // Unknown keys are rejected rather than stored — a value with no field
    // def has no ProConnect address and would be silently unimportable.
    if (!def) {
      rejected.push(key)
      continue
    }
    let valueText: string | null = null
    let valueNum: number | null = null
    if (raw !== null && raw !== "") {
      if (def.dataType === "currency" || def.dataType === "integer") {
        // Accept "1,234.56" and "$1,234" from the form.
        const n = Number(String(raw).replace(/[$,\s]/g, ""))
        if (Number.isNaN(n)) {
          rejected.push(key)
          continue
        }
        valueNum = n
      } else if (def.dataType === "checkbox") {
        valueNum = raw === true || raw === 1 || raw === "1" || raw === "true" ? 1 : 0
      } else {
        valueText = String(raw)
      }
    }
    rows.push({
      document_id: doc.id,
      field_key: key,
      value_text: valueText,
      value_num: valueNum,
      updated_by: teamMemberId,
      updated_at: now,
    })
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from("tax_input_values")
      .upsert(rows, { onConflict: "document_id,field_key" })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const docPatch: Record<string, unknown> = { updated_at: now }
  if (typeof body.label === "string") docPatch.label = body.label
  if (body.taxpayerSpouse === "T" || body.taxpayerSpouse === "S") {
    docPatch.taxpayer_spouse = body.taxpayerSpouse
  }
  if (Object.keys(docPatch).length > 1) {
    await admin.from("tax_input_documents").update(docPatch).eq("id", doc.id)
  }

  return NextResponse.json({ saved: rows.length, rejected })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ setId: string }> }) {
  const { setId } = await ctx.params

  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const documentId = new URL(req.url).searchParams.get("documentId")
  if (!documentId) {
    return NextResponse.json({ error: "documentId query param is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  // Values cascade via the FK.
  const { error } = await admin
    .from("tax_input_documents")
    .delete()
    .eq("id", documentId)
    .eq("input_set_id", setId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
