/**
 * Import (write-back) field data into a single series of a return.
 *
 * POST /api/proconnect/returns/[returnId]/import/[seriesId]
 *
 * Body (mirrors the upstream ImportRequest):
 * {
 *   "clientId":  "9341455559706519",         // required (path is firm-scoped)
 *   "version":   "550e8400-...",             // null when adding the series for the first time
 *   "dryRun":    false,                      // optional — runs validation without persisting
 *   "entries":   [ { prefixId, codeId, suffixId, ... } ],
 *   "actor":     "user-or-system-id",        // optional — recorded on the audit row
 *   "reason":    "free-text origin"          // optional — recorded on the audit row
 * }
 *
 * Phase 1 endpoint:
 *   POST https://api.intuit.com/v2/clients/{clientId}/returns/{returnId}/import/series/{seriesId}
 *
 * Write safety:
 *   Three independent gates stand in front of a commit. The return must not
 *   be locked by an accepted e-filing (see lib/proconnect/efile-lock), it
 *   must be on PROCONNECT_WRITE_ALLOWED_RETURN_IDS (fails closed when
 *   unset), and a clean dry run of the same shape must have happened in the
 *   last 30 minutes. Dry runs are refused by none of them — they persist
 *   nothing — but they DO carry the lock verdict back on `lock` so the
 *   editor can say a commit will be refused before anyone tries it.
 *
 *   The e-file lock is THE enforcement point for firm policy that a filed
 *   return is final. The viewer disables editing on a locked return too,
 *   but that is a courtesy: a disabled input is a UI convention, this route
 *   is the boundary. It re-reads the engagement from ProConnect on every
 *   commit rather than trusting a cached column, because the cached
 *   efile_* columns are hydrated by a separate pass and a list-derived
 *   upsert that reintroduced them would blank them nightly — which would
 *   quietly unlock every filed return.
 *
 * Audit policy:
 *   We record EVERY attempt — including dry runs and validation failures
 *   that never hit the network — into proconnect_import_jobs, with one
 *   row per rejected entry in proconnect_import_entry_results.
 *
 * Post-write verification:
 *   A commit re-exports the return and checks that each entry actually
 *   landed, because Intuit reports entries it did not apply as applied
 *   (open defect, confirmed 2026-08-07 — see verifyEntriesLanded). A job
 *   with unlanded entries is recorded as "partial", never "succeeded",
 *   and the per-entry addresses come back on `verification.unlanded`.
 *   That same Export doubles as the snapshot refresh.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireLeadership } from "@/lib/auth/require-leadership"
import {
  importSeries,
  exportReturnData,
  verifyEntriesLanded,
  MAX_ENTRIES_PER_IMPORT,
  type ImportEntry,
  type ImportRequest,
  type ImportVerification,
} from "@/lib/proconnect/data"
import { persistReturnSnapshot } from "@/lib/proconnect/snapshots"
import { resolveReturnLock } from "@/lib/proconnect/efile-lock"
import { isWriteAllowed } from "@/lib/proconnect/write-allowlist"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

type Body = {
  clientId?: string
  version?: string | null
  dryRun?: boolean
  entries?: ImportEntry[]
  actor?: string
  reason?: string
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ returnId: string; seriesId: string }> },
) {
  // Write-back modifies field values on live tax returns in ProConnect —
  // gate it to leadership, matching /api/proconnect/sync and the OAuth
  // connect/disconnect routes. (Middleware only enforces "any session".)
  const auth = await requireLeadership()
  if (!auth.ok) return auth.response

  const sb = admin()
  const { returnId, seriesId } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Body

  // ------------------------------------------------------------------ validate
  if (!body.clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: "entries[] is required and must be non-empty" }, { status: 400 })
  }
  if (body.entries.length > MAX_ENTRIES_PER_IMPORT) {
    return NextResponse.json(
      {
        error: `entries[].length=${body.entries.length} exceeds spec max of ${MAX_ENTRIES_PER_IMPORT}; chunk client-side`,
      },
      { status: 400 },
    )
  }
  if (body.version !== undefined && body.version !== null && typeof body.version !== "string") {
    return NextResponse.json({ error: "version must be string or null" }, { status: 400 })
  }

  const dryRun = Boolean(body.dryRun)

  // ------------------------------------------------------------------ write allowlist
  // Intuit has no delete/clear in the Import API, so a wrong returnId is
  // not recoverable through the API — the only fix is deleting the whole
  // return in the PTO UI. Commits are therefore restricted to returns
  // explicitly designated for testing. Fails CLOSED: an unset env var
  // means no return may be committed to.
  //
  // Dry runs are exempt — they persist nothing, and their field-rule
  // errors are a useful source of catalog facts on real returns.
  if (!dryRun && !isWriteAllowed(returnId)) {
    return NextResponse.json(
      {
        error:
          "Return is not on the import write allowlist. Commits are restricted to " +
          "returns designated for testing; set PROCONNECT_WRITE_ALLOWED_RETURN_IDS " +
          "(comma-separated return UUIDs) to authorize one. Dry runs are unrestricted.",
        returnId,
      },
      { status: 403 },
    )
  }

  // ------------------------------------------------------------------ post-e-file lock
  // Firm policy: once a return has been e-filed and accepted, its data is
  // final. This route is where that is enforced.
  //
  // The predicate is existential over the engagement's filings, not a read
  // of the headline efile_status. An accepted Form 4868 must NOT lock the
  // return it extends — 66 of 919 live engagements are in exactly that
  // state, nearly all TY2025 1040s still being worked — while a return with
  // an acceptance anywhere in its filings must stay locked even when a
  // later rejection is the newer news. See lib/proconnect/efile-lock.
  //
  // Read live and fail closed. Dry runs are evaluated but never blocked —
  // they persist nothing, and carrying the decision back lets the editor
  // warn before anyone spends a dry run on a return the commit will refuse.
  const lock = await resolveReturnLock(returnId)
  if (!dryRun && lock.locked) {
    return NextResponse.json({ error: lock.reason, lock, returnId }, { status: 423 })
  }

  // ------------------------------------------------------------------ dryRun-first gate
  // There is no ProConnect sandbox — a commit writes onto a live return.
  // A non-dry-run commit is only allowed when a CLEAN dry run (zero
  // errors) of the same shape ran recently for this (return, series).
  if (!dryRun) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: priorDry } = await sb
      .from("proconnect_import_jobs")
      .select("id, entry_count_requested, error_count, status")
      .eq("return_id", returnId)
      .eq("series_id", seriesId)
      .eq("dry_run", true)
      .eq("status", "succeeded")
      .eq("error_count", 0)
      .gte("started_at", thirtyMinAgo)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!priorDry || priorDry.entry_count_requested !== body.entries.length) {
      return NextResponse.json(
        {
          error:
            "dryRun-first required: run this exact import with dryRun:true first. " +
            "A commit is only accepted within 30 minutes of a clean (zero-error) dry run " +
            "of the same entry count for this return + series.",
        },
        { status: 409 },
      )
    }
  }

  // ------------------------------------------------------------------ create audit row up-front
  // Audit the VERIFIED caller identity, not the body's self-declared
  // actor — body.actor is kept in trigger_context for context only.
  const trigger = `manual:${auth.email ?? auth.userId}`
  const triggerCtx: Record<string, unknown> = {
    team_member_id: auth.teamMemberId,
    role: auth.role,
  }
  if (body.actor) triggerCtx.declared_actor = body.actor
  if (body.reason) triggerCtx.reason = body.reason
  // What the lock said at the moment of the attempt. On a commit this is
  // always an unlocked verdict — recording it makes "why was this return
  // writable on that date" answerable later without re-deriving it.
  triggerCtx.efile_lock = lock
  const { data: jobRow, error: jobErr } = await sb
    .from("proconnect_import_jobs")
    .insert({
      return_id: returnId,
      proconnect_client_id: body.clientId,
      series_id: seriesId,
      request_version: body.version ?? null,
      dry_run: dryRun,
      entry_count_requested: body.entries.length,
      // PII discipline: audit rows store field ADDRESSES and which
      // attributes were set — never the values. Tax field values are
      // SSNs, wages, names; they live only on the return (and in the
      // snapshot mirror), not in a log table.
      entries_payload: {
        entries: body.entries.map((e) => ({
          prefixId: e.prefixId,
          codeId: e.codeId,
          suffixId: e.suffixId,
          tsj: e.tsj ?? null,
          has_val: e.val !== undefined,
          has_desc: e.desc !== undefined,
          has_src: e.src !== undefined,
        })),
        redacted: true,
      },
      status: "pending",
      triggered_by: trigger,
      trigger_context: Object.keys(triggerCtx).length ? triggerCtx : null,
    })
    .select("id")
    .single()
  if (jobErr || !jobRow) {
    console.error("[v0] failed to create import job row", jobErr)
    return NextResponse.json(
      { error: "Failed to record audit row", details: jobErr?.message },
      { status: 500 },
    )
  }
  const jobId = jobRow.id as string

  // ------------------------------------------------------------------ call upstream
  const payload: ImportRequest = {
    version: body.version ?? null,
    dryRun,
    entries: body.entries,
  }
  const result = await importSeries(body.clientId, returnId, seriesId, payload)

  // ------------------------------------------------------------------ persist audit
  if (!result.ok) {
    await sb
      .from("proconnect_import_jobs")
      .update({
        status: "failed",
        http_status: result.error.status ?? null,
        error_message:
          (typeof result.error.body === "string"
            ? result.error.body
            : JSON.stringify(result.error.body ?? result.error.kind)) +
          ` [${result.error.kind}]`,
        response_raw: { error: result.error },
        intuit_tid: result.intuitTid ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)

    return NextResponse.json(
      { jobId, error: result.error, lock, intuitTid: result.intuitTid },
      { status: result.error.status || 500 },
    )
  }

  const seriesResult = result.data.results?.[0] ?? null

  // ------------------------------------------------------------------ verify it landed
  // Intuit defect 3 (open as of 2026-08-07): the API reports entries it did
  // not apply as applied — every clear attempt returned totalImported:1 with
  // the cell unchanged. So a commit is not "succeeded" because Intuit said
  // so; it is succeeded because a fresh Export agrees. Dry runs skip this,
  // having changed nothing by definition.
  let verification: ImportVerification | null = null
  if (!dryRun) {
    const fresh = await exportReturnData(body.clientId, returnId)
    if (fresh.ok) {
      verification = verifyEntriesLanded(
        fresh.data,
        seriesId,
        body.entries,
        seriesResult?.errors ?? [],
      )
      // Keep the local mirror consistent while we have the export in hand.
      await persistReturnSnapshot(sb, body.clientId, returnId, fresh.data).catch((err) =>
        console.error("[v0] post-import snapshot persist failed", err),
      )
    } else {
      console.error("[v0] post-import verification export failed", fresh.error)
    }
  }

  // An unverified commit must not read as a clean one. Both a per-entry
  // rejection and an entry that silently failed to land are "partial".
  const hasUnlanded = (verification?.unlanded.length ?? 0) > 0
  await sb
    .from("proconnect_import_jobs")
    .update({
      status: result.data.summary.totalErrors > 0 || hasUnlanded ? "partial" : "succeeded",
      http_status: 200,
      imported_count: result.data.summary.totalImported,
      error_count: result.data.summary.totalErrors,
      response_version: seriesResult?.version ?? null,
      // Addresses only — verifyEntriesLanded never returns values (§8).
      response_summary: { ...result.data.summary, verification },
      response_raw: result.data,
      intuit_tid: result.intuitTid ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)

  // Per-entry rejections — one row each. Lets the dashboard render a
  // cleanly searchable error table without unwrapping JSON in the UI.
  const errors = seriesResult?.errors ?? []
  if (errors.length > 0) {
    // Per Phase 1 spec §B.6, each rejected entry carries an *array* of
    // ErrorDetail objects (a single entry can fail multiple field rules
    // — e.g. value + length + oneOf). We persist the full array verbatim
    // into proconnect_import_entry_results.error_details (jsonb).
    const rows = errors.map((e) => ({
      job_id: jobId,
      prefix_id: e.prefixId,
      code_id: e.codeId,
      suffix_id: e.suffixId,
      error_details: e.errorDetails ?? [],
    }))
    const { error: errInsErr } = await sb.from("proconnect_import_entry_results").insert(rows)
    if (errInsErr) console.error("[v0] failed to write entry-results rows", errInsErr)
  }

  // The snapshot was already refreshed above, as a side effect of the
  // verification export — one Export serves both.
  return NextResponse.json({
    jobId,
    ...result.data,
    verification,
    lock,
    intuitTid: result.intuitTid,
  })
}
