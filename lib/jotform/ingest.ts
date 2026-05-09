/**
 * Idempotent upsert of Jotform submissions into Supabase.
 *
 * Used by both the live webhook receiver and the historical backfill,
 * so the dedupe semantics live in one place.
 */
import { createClient } from "@supabase/supabase-js"
import { buildIntakeRow } from "./parse"
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
