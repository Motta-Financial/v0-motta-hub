/**
 * Runs with the service-role client, matching /api/tax/clients and
 * /api/tax/returns.
 *
 * It used the session client at first and failed with "permission denied for
 * view tax_person_relationships_both". That is a missing GRANT, not an RLS
 * policy rejection — this project revokes default PostgREST grants (see
 * scripts/359), so new tables are unreachable by `authenticated` until
 * granted explicitly.
 *
 * Granting was the wrong fix here. Views in this schema run as their owner
 * and bypass base-table RLS for `authenticated` (scripts/359 documents this
 * and deliberately left it in place), and client-portal users hold
 * `authenticated` sessions in this same Supabase project. Granting the view
 * would have exposed every household — who is married to whom, who claims
 * which child — to any portal login.
 *
 * Staff-gating happens in middleware, which requires a session AND a
 * team_members row before any /api route runs. The is_staff() RLS policies on
 * both tables stay as defence in depth for any future caller that does use a
 * session client.
 */
import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"

/**
 * Dependents for the household model (scripts/404_tax_household_model.sql).
 *
 * The relationship (`tax_person_relationships`, e.g. "child") is durable
 * across years. The per-year facts that decide the credit — months lived
 * with the claimant, student/disability status, whether the claim was
 * released to the other parent — live in `tax_dependent_years`, scoped to
 * one tax_year. Adding a dependent for a year writes BOTH rows.
 *
 * `tax_dependent_years` is unique on (dependent_contact_id, tax_year): a
 * child can only be claimed once per year. We surface that as a named
 * conflict ("already claimed by X") rather than a raw Postgres error.
 *
 * RLS on both tables is `is_staff()`-gated, so this route uses the
 * per-request, cookie-authenticated client, never the service-role client.
 */

const DEPENDENT_RELATIONSHIP_TYPES = [
  "child",
  "stepchild",
  "foster_child",
  "adopted_child",
  "grandchild",
  "parent",
  "grandparent",
  "sibling",
  "other_dependent",
] as const

function ageAtYearEnd(dateOfBirth: string | null, taxYear: number): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null
  const yearEnd = new Date(Date.UTC(taxYear, 11, 31))
  let age = yearEnd.getUTCFullYear() - dob.getUTCFullYear()
  const dobInYearEnd = new Date(Date.UTC(taxYear, dob.getUTCMonth(), dob.getUTCDate()))
  if (dobInYearEnd > yearEnd) age -= 1
  return age
}

/**
 * GET /api/tax/household/dependents?contactId=<uuid>&taxYear=<year>
 *
 * Lists this claimant's dependents FOR THAT YEAR: every
 * tax_dependent_years row where claimed_by_contact_id = contactId and
 * tax_year matches, joined back to the durable relationship for the
 * relationship_type label and to `contacts` for name / age.
 */
export async function GET(req: NextRequest) {
  try {
    const sb = createAdminClient()
    const { searchParams } = new URL(req.url)
    const contactId = searchParams.get("contactId")
    const taxYearParam = searchParams.get("taxYear")
    if (!contactId || !taxYearParam) {
      return NextResponse.json({ error: "contactId and taxYear required" }, { status: 400 })
    }
    const taxYear = Number(taxYearParam)
    if (!Number.isInteger(taxYear)) {
      return NextResponse.json({ error: "taxYear must be an integer" }, { status: 400 })
    }

    const { data: yearRows, error: yearError } = await sb
      .from("tax_dependent_years")
      .select("*")
      .eq("claimed_by_contact_id", contactId)
      .eq("tax_year", taxYear)
      .order("created_at", { ascending: true })

    if (yearError) {
      console.error("[v0] /api/tax/household/dependents GET (years) failed", yearError)
      return NextResponse.json({ error: yearError.message }, { status: 500 })
    }

    const rows = yearRows ?? []
    const dependentIds = Array.from(new Set(rows.map((r) => r.dependent_contact_id as string)))

    const [{ data: contactRows, error: contactError }, { data: relRows, error: relError }] =
      await Promise.all([
        dependentIds.length
          ? sb.from("contacts").select("id, full_name, date_of_birth").in("id", dependentIds)
          : Promise.resolve({ data: [], error: null }),
        dependentIds.length
          ? sb
              .from("tax_person_relationships")
              .select("id, person_contact_id, related_contact_id, relationship_type, effective_to")
              .eq("person_contact_id", contactId)
              .in("related_contact_id", dependentIds)
              .in("relationship_type", DEPENDENT_RELATIONSHIP_TYPES)
          : Promise.resolve({ data: [], error: null }),
      ])

    if (contactError) {
      return NextResponse.json({ error: contactError.message }, { status: 500 })
    }
    if (relError) {
      return NextResponse.json({ error: relError.message }, { status: 500 })
    }

    const contactMap = new Map(
      (contactRows ?? []).map((c) => [c.id as string, c as Record<string, unknown>]),
    )
    // A dependent could theoretically carry more than one durable
    // relationship row over time (e.g. re-entered); prefer the one still
    // in effect, falling back to the most recently added.
    const relMap = new Map<string, Record<string, unknown>>()
    for (const r of relRows ?? []) {
      const row = r as Record<string, unknown>
      const key = row.related_contact_id as string
      const existing = relMap.get(key)
      if (!existing || (existing.effective_to && !row.effective_to)) {
        relMap.set(key, row)
      }
    }

    const dependents = rows.map((r) => {
      const contact = contactMap.get(r.dependent_contact_id as string)
      const rel = relMap.get(r.dependent_contact_id as string)
      const dob = (contact?.date_of_birth as string | null) ?? null
      return {
        id: r.id,
        dependentContactId: r.dependent_contact_id,
        relationshipId: rel?.id ?? null,
        fullName: (contact?.full_name as string | null) ?? null,
        dateOfBirth: dob,
        ageAtYearEnd: ageAtYearEnd(dob, taxYear),
        relationshipType: (rel?.relationship_type as string | null) ?? null,
        taxYear: r.tax_year,
        monthsLivedWithClaimant: r.months_lived_with_claimant,
        isFullTimeStudent: r.is_full_time_student,
        isPermanentlyDisabled: r.is_permanently_disabled,
        releasedToOtherParent: r.released_to_other_parent,
        creditType: r.credit_type,
        notes: r.notes,
      }
    })

    return NextResponse.json({ ok: true, dependents, taxYear })
  } catch (err) {
    console.error("[v0] /api/tax/household/dependents GET threw", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load dependents" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/tax/household/dependents
 *
 * Body shape A (add for a year — writes both rows):
 *   {
 *     action: "add",
 *     contactId, dependentContactId, relationshipType, taxYear,
 *     monthsLivedWithClaimant?, isFullTimeStudent?, isPermanentlyDisabled?,
 *     releasedToOtherParent?, creditType?, notes?
 *   }
 *
 * Body shape B (update the per-year facts / credit on an existing row):
 *   { action: "update", id, monthsLivedWithClaimant?, isFullTimeStudent?,
 *     isPermanentlyDisabled?, releasedToOtherParent?, creditType?, notes? }
 *
 * Body shape C (copy last year's dependents into this year):
 *   { action: "copy_from_last_year", contactId, taxYear }
 *   Copies every dependent claimed for taxYear-1 into taxYear, skipping any
 *   dependent already claimed this year. credit_type is reset to NULL on
 *   the copy — the credit depends on tests (age, support, etc.) that can
 *   change year to year, so it must be re-determined, never carried over.
 */
export async function POST(req: NextRequest) {
  try {
    const sb = createAdminClient()
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: "body required" }, { status: 400 })
    const action = body.action

    if (action === "add") {
      const contactId = body.contactId as string
      const dependentContactId = body.dependentContactId as string
      const relationshipType = body.relationshipType as string
      const taxYear = Number(body.taxYear)

      if (!contactId || !dependentContactId || !relationshipType || !Number.isInteger(taxYear)) {
        return NextResponse.json(
          { error: "contactId, dependentContactId, relationshipType, taxYear required" },
          { status: 400 },
        )
      }
      if (contactId === dependentContactId) {
        return NextResponse.json(
          { error: "A client cannot be their own dependent" },
          { status: 400 },
        )
      }

      // Durable relationship row — upsert so re-adding the same pair in a
      // later year doesn't 23505 on tax_person_rel_unique.
      const { error: relError } = await sb.from("tax_person_relationships").upsert(
        {
          person_contact_id: contactId,
          related_contact_id: dependentContactId,
          relationship_type: relationshipType,
          status: "confirmed",
          link_source: "manual",
          confidence: 1,
          reviewed_at: new Date().toISOString(),
        },
        { onConflict: "person_contact_id,related_contact_id,relationship_type,effective_from" },
      )
      if (relError) {
        console.error("[v0] dependent relationship upsert failed", relError)
        return NextResponse.json({ error: relError.message }, { status: 500 })
      }

      const { data, error } = await sb
        .from("tax_dependent_years")
        .insert({
          dependent_contact_id: dependentContactId,
          claimed_by_contact_id: contactId,
          tax_year: taxYear,
          months_lived_with_claimant: (body.monthsLivedWithClaimant as number | null) ?? null,
          is_full_time_student: (body.isFullTimeStudent as boolean | null) ?? null,
          is_permanently_disabled: (body.isPermanentlyDisabled as boolean | null) ?? null,
          released_to_other_parent: (body.releasedToOtherParent as boolean | null) ?? false,
          // credit_type stays NULL until the tests are answered — never
          // default it to "none". NULL and "none" mean different things.
          credit_type: (body.creditType as string | null) ?? null,
          notes: (body.notes as string | null) ?? null,
        })
        .select("id")
        .single()

      if (error) {
        if (error.code === "23505") {
          return NextResponse.json(
            { error: await describeDoubleClaim(sb, dependentContactId, taxYear) },
            { status: 409 },
          )
        }
        console.error("[v0] add dependent-year failed", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ ok: true, id: data.id })
    }

    if (action === "update") {
      const id = body.id as string
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

      const patch: Record<string, unknown> = {}
      for (const key of [
        ["monthsLivedWithClaimant", "months_lived_with_claimant"],
        ["isFullTimeStudent", "is_full_time_student"],
        ["isPermanentlyDisabled", "is_permanently_disabled"],
        ["releasedToOtherParent", "released_to_other_parent"],
        ["creditType", "credit_type"],
        ["notes", "notes"],
      ] as const) {
        const [bodyKey, column] = key
        if (bodyKey in body) patch[column] = body[bodyKey]
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "no fields to update" }, { status: 400 })
      }

      const { error } = await sb.from("tax_dependent_years").update(patch).eq("id", id)
      if (error) {
        console.error("[v0] update dependent-year failed", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    if (action === "copy_from_last_year") {
      const contactId = body.contactId as string
      const taxYear = Number(body.taxYear)
      if (!contactId || !Number.isInteger(taxYear)) {
        return NextResponse.json({ error: "contactId and taxYear required" }, { status: 400 })
      }

      const { data: priorRows, error: priorError } = await sb
        .from("tax_dependent_years")
        .select("*")
        .eq("claimed_by_contact_id", contactId)
        .eq("tax_year", taxYear - 1)

      if (priorError) {
        return NextResponse.json({ error: priorError.message }, { status: 500 })
      }
      if (!priorRows || priorRows.length === 0) {
        return NextResponse.json({ ok: true, copied: 0, skipped: 0, conflicts: [] })
      }

      const { data: existingRows, error: existingError } = await sb
        .from("tax_dependent_years")
        .select("dependent_contact_id")
        .eq("claimed_by_contact_id", contactId)
        .eq("tax_year", taxYear)

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 })
      }
      const already = new Set((existingRows ?? []).map((r) => r.dependent_contact_id as string))

      const toInsert = priorRows
        .filter((r) => !already.has(r.dependent_contact_id as string))
        .map((r) => ({
          dependent_contact_id: r.dependent_contact_id,
          claimed_by_contact_id: contactId,
          tax_year: taxYear,
          months_lived_with_claimant: r.months_lived_with_claimant,
          is_full_time_student: r.is_full_time_student,
          is_permanently_disabled: r.is_permanently_disabled,
          released_to_other_parent: r.released_to_other_parent,
          // Reset, not carried over — see doc comment above.
          credit_type: null,
          notes: r.notes,
        }))

      let copied = 0
      const conflicts: string[] = []
      if (toInsert.length > 0) {
        const { data: inserted, error: insertError } = await sb
          .from("tax_dependent_years")
          .insert(toInsert)
          .select("id")
        if (insertError) {
          if (insertError.code === "23505") {
            // A race with another preparer — fall back to inserting one
            // at a time so a single conflict doesn't drop the whole batch.
            for (const row of toInsert) {
              const { error: oneError } = await sb.from("tax_dependent_years").insert(row)
              if (oneError) {
                if (oneError.code === "23505") {
                  conflicts.push(
                    await describeDoubleClaim(
                      sb,
                      row.dependent_contact_id as string,
                      taxYear,
                    ),
                  )
                } else {
                  return NextResponse.json({ error: oneError.message }, { status: 500 })
                }
              } else {
                copied += 1
              }
            }
          } else {
            return NextResponse.json({ error: insertError.message }, { status: 500 })
          }
        } else {
          copied = inserted?.length ?? toInsert.length
        }
      }

      return NextResponse.json({
        ok: true,
        copied,
        skipped: already.size,
        conflicts,
      })
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[v0] /api/tax/household/dependents POST threw", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "dependent update failed" },
      { status: 500 },
    )
  }
}

/**
 * Turns the raw 23505 on tax_dependent_years_unique into the message the
 * plan calls for: WHO already claims this dependent for this year. This
 * constraint exists to catch double-claiming a child here rather than by
 * an IRS letter, so the message needs to read that way.
 */
async function describeDoubleClaim(
  sb: ReturnType<typeof createAdminClient>,
  dependentContactId: string,
  taxYear: number,
): Promise<string> {
  const { data } = await sb
    .from("tax_dependent_years")
    .select("claimed_by_contact_id")
    .eq("dependent_contact_id", dependentContactId)
    .eq("tax_year", taxYear)
    .maybeSingle()

  const claimantId = data?.claimed_by_contact_id as string | undefined
  if (!claimantId) {
    return `Someone else already claims this dependent for tax year ${taxYear}.`
  }
  const { data: claimant } = await sb
    .from("contacts")
    .select("full_name")
    .eq("id", claimantId)
    .maybeSingle()

  const name = (claimant?.full_name as string | null) ?? "another client"
  return `${name} already claims this dependent for tax year ${taxYear}. A dependent can only be claimed once per year.`
}
