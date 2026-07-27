import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import {
  loadIntakeSet,
  loadFieldDefs,
  loadForm1040Constants,
  w2sFromIntakeSet,
  int1099sFromIntakeSet,
  div1099sFromIntakeSet,
  r1099sFromIntakeSet,
  scheduleAFromIntakeSet,
  computeKeyDrift,
  filingStatusOf,
} from "@/lib/tax/intake/store"
import { serializeToImportBatches } from "@/lib/tax/intake/serialize"
import { computeForm1040Preview } from "@/lib/tax/intake/compute"
import { validateBatches } from "@/lib/proconnect/catalog"

/**
 * One intake set: the gathered documents, the computed 1040 preview, and
 * the exact ProConnect Import payload the data would produce.
 *
 *   GET /api/tax/intake/{setId}
 *
 * Returning the payload alongside the preview is the point of the whole
 * design — a preparer can see both "here is the return" and "here is
 * precisely what we will write to ProConnect, field by field" before
 * anything is sent. Nothing here calls Intuit.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ setId: string }> }) {
  const { setId } = await ctx.params

  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  try {
    const set = await loadIntakeSet(admin, setId)
    if (!set) return NextResponse.json({ error: "Intake set not found" }, { status: 404 })

    const defs = await loadFieldDefs(admin, {
      taxYear: set.taxYear,
      returnType: set.returnType,
    })

    // What would be written to ProConnect.
    const serialized = serializeToImportBatches(set, defs)

    // Check it against Intuit's own field rules before anyone gets the
    // chance to send it. This runs ahead of — never instead of — the
    // mandatory dryRun, which catches return-state rules the catalog
    // cannot express.
    const validation = await validateBatches(
      admin,
      { taxYear: set.taxYear, returnType: set.returnType },
      serialized.batches,
    )

    // What the return looks like, for review.
    const constants = await loadForm1040Constants(admin, set.taxYear)
    const preview = computeForm1040Preview(
      {
        filingStatus: filingStatusOf(set),
        w2s: w2sFromIntakeSet(set),
        int1099s: int1099sFromIntakeSet(set),
        div1099s: div1099sFromIntakeSet(set),
        r1099s: r1099sFromIntakeSet(set),
        scheduleA: scheduleAFromIntakeSet(set),
      },
      constants,
    )
    // If a field def was renamed out from under the calculator, that income
    // would vanish silently. Surface it as out-of-scope rather than let the
    // preview look complete.
    preview.outOfScope.push(...computeKeyDrift(defs))

    // Decorate documents with their field defs so the UI can render forms
    // without a second round trip.
    const documents = set.documents.map((d) => ({
      id: d.id,
      docType: d.docType,
      instanceIndex: d.instanceIndex,
      prefixId: `p${d.instanceIndex}`,
      label: d.label,
      taxpayerSpouse: d.taxpayerSpouse,
      values: d.values,
      fields: (defs.get(d.docType) ?? []).map((f) => ({
        fieldKey: f.fieldKey,
        label: f.label,
        dataType: f.dataType,
        required: f.required,
        target: `${f.seriesId}/${f.codeId}/${f.suffixId}`,
        confidence: f.confidence,
      })),
    }))

    return NextResponse.json({
      // Only types with seeded field defs can be added — anything else has
      // no ProConnect address and the POST route refuses it.
      availableDocTypes: [...defs.entries()]
        .filter(([, list]) => list.length > 0)
        .map(([docType, list]) => ({ docType, fieldCount: list.length })),
      set: {
        id: set.id,
        taxYear: set.taxYear,
        returnType: set.returnType,
        filingStatus: set.filingStatus,
        proconnectClientId: set.proconnectClientId,
        proconnectReturnId: set.proconnectReturnId,
      },
      documents,
      preview,
      importPlan: {
        batches: serialized.batches,
        entryCount: serialized.entryCount,
        problems: serialized.problems,
        validation,
        blocked:
          serialized.problems.some((p) => p.severity === "blocking") ||
          validation.problems.some((p) => p.severity === "blocking"),
        // Surfaced so the UI can state it plainly: p{n} for repeated
        // documents is inferred from the field model, not confirmed by a
        // real Export. See scripts/361.
        prefixAssumed: true,
        readyToImport:
          !!set.proconnectClientId &&
          !!set.proconnectReturnId &&
          !serialized.problems.some((p) => p.severity === "blocking") &&
          // An unloaded catalog means nothing was checked against Intuit's
          // rules. That is not "ready", it is "unverified".
          validation.ok,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] [tax/intake] GET failed:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** Update set-level fields (filing status, ProConnect targets, status). */
export async function PATCH(req: Request, ctx: { params: Promise<{ setId: string }> }) {
  const { setId } = await ctx.params

  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.filingStatus === "string") patch.filing_status = body.filingStatus
  if (typeof body.proconnectClientId === "string") patch.proconnect_client_id = body.proconnectClientId
  if (typeof body.proconnectReturnId === "string") patch.proconnect_return_id = body.proconnectReturnId
  if (typeof body.status === "string") patch.status = body.status
  if (typeof body.notes === "string") patch.notes = body.notes

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tax_input_sets")
    .update(patch)
    .eq("id", setId)
    .select("id, tax_year, filing_status, status, proconnect_client_id, proconnect_return_id")
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Intake set not found" }, { status: 404 })
  return NextResponse.json({ set: data })
}
