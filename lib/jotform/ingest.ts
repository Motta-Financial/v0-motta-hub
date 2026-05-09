/**
 * Idempotent upsert of Jotform submissions into Supabase.
 *
 * Used by both the live webhook receiver and the historical backfill,
 * so the dedupe semantics live in one place.
 */
import { createClient } from "@supabase/supabase-js"
import { buildIntakeRow } from "./parse"
import { buildFeedbackRow } from "./parse-feedback"
import type { JotformSubmission } from "./client"

function getServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error("Supabase service-role credentials are not configured")
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function getFormUuidByJotformId(jotformFormId: string): Promise<string | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from("jotform_forms")
    .select("id")
    .eq("jotform_form_id", jotformFormId)
    .maybeSingle()
  if (error) {
    console.log("[v0] getFormUuidByJotformId error:", error.message)
    return null
  }
  return data?.id ?? null
}

export async function upsertIntakeSubmission(submission: JotformSubmission) {
  const supabase = getServiceClient()
  const formUuid = await getFormUuidByJotformId(submission.form_id)
  const row = buildIntakeRow(submission, formUuid)

  const { error } = await supabase
    .from("jotform_intake_submissions")
    .upsert(row, { onConflict: "jotform_submission_id" })

  if (error) {
    throw new Error(`Failed to upsert intake submission ${submission.id}: ${error.message}`)
  }
  return { id: submission.id }
}

/**
 * Idempotent upsert into `jotform_feedback_submissions`. Mirrors
 * `upsertIntakeSubmission` so the webhook receiver can dispatch by
 * form `kind` without caring which target table the row lands in.
 */
export async function upsertFeedbackSubmission(submission: JotformSubmission) {
  const supabase = getServiceClient()
  const formUuid = await getFormUuidByJotformId(submission.form_id)
  const row = buildFeedbackRow(submission, formUuid)

  const { error } = await supabase
    .from("jotform_feedback_submissions")
    .upsert(row, { onConflict: "jotform_submission_id" })

  if (error) {
    throw new Error(`Failed to upsert feedback submission ${submission.id}: ${error.message}`)
  }
  return { id: submission.id }
}

/**
 * Look up a form's `kind` (intake / feedback / debrief / other) and
 * Hub UUID by the per-form webhook secret token. Used by the webhook
 * receiver to dispatch to the right ingest function in O(1) without
 * baking form IDs into application code.
 */
export async function getFormByWebhookToken(token: string): Promise<{
  id: string
  jotform_form_id: string
  kind: "intake" | "feedback" | "debrief" | "other"
  webhook_secret: string
} | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from("jotform_forms")
    .select("id, jotform_form_id, kind, webhook_secret")
    .eq("webhook_secret", token)
    .maybeSingle()
  if (error) {
    console.log("[v0] getFormByWebhookToken error:", error.message)
    return null
  }
  if (!data) return null
  // Defensive: an old row written before migration 046 might have a
  // null kind even though the column has a default — coerce to
  // 'intake' so the dispatcher still routes correctly.
  return {
    ...data,
    kind: (data.kind as "intake" | "feedback" | "debrief" | "other") ?? "intake",
  }
}

export async function recordWebhookEvent(args: {
  jotform_form_id: string | null
  jotform_submission_id: string | null
  raw_payload: unknown
  request_headers: Record<string, string>
  source_ip: string | null
}): Promise<string> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from("jotform_webhook_events")
    .insert({
      jotform_form_id: args.jotform_form_id,
      jotform_submission_id: args.jotform_submission_id,
      raw_payload: args.raw_payload as never,
      request_headers: args.request_headers as never,
      source_ip: args.source_ip,
      processing_status: "pending",
    })
    .select("id")
    .single()
  if (error) {
    throw new Error(`Failed to record webhook event: ${error.message}`)
  }
  return data.id
}

export async function markWebhookProcessed(eventId: string) {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from("jotform_webhook_events")
    .update({ processing_status: "processed", processed_at: new Date().toISOString() })
    .eq("id", eventId)
  if (error) console.log("[v0] markWebhookProcessed error:", error.message)
}

export async function markWebhookFailed(eventId: string, message: string) {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from("jotform_webhook_events")
    .update({
      processing_status: "failed",
      processing_error: message,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId)
  if (error) console.log("[v0] markWebhookFailed error:", error.message)
}
