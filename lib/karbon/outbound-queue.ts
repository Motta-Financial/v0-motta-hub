/**
 * Outbound write queue (Phase-2 two-way sync, currently DISABLED).
 *
 * When `KARBON_TWO_WAY_SYNC=true` is set, calling `enqueueOutboundChange()`
 * will record a pending write to the `karbon_outbound_changes` table so a
 * follow-up cron / drainer can push it to Karbon via PUT/PATCH.
 *
 * Today the function is a no-op when the flag is unset, so callers in the app
 * can already wire up `await enqueueOutboundChange(...)` after a local mutation
 * without changing behavior. Flipping the flag in production drops the writes
 * into the queue automatically — no code changes required at the call sites.
 *
 * This file exists deliberately ahead of the drainer so the data shape and
 * call surface are settled. The drainer (a future `/api/cron/karbon-push`) is
 * not part of the current release.
 */

import { tryCreateAdminClient } from "@/lib/supabase/server"

export type OutboundResource = "Contact" | "Organization" | "ClientGroup" | "Work" | "Note" | "Task"
export type OutboundOperation = "create" | "update" | "delete"

export interface EnqueueOutboundChangeOptions {
  resource_type: OutboundResource
  /** The Karbon perma_key (UUID) when updating; omit for create operations. */
  resource_perma_key?: string | null
  operation: OutboundOperation
  /** JSON payload to send to Karbon. Field-level allow-listing happens in the drainer, not here. */
  payload: Record<string, any>
  /** Optional team_member.id who triggered the change, for audit. */
  origin_user_id?: string | null
  /** Optional idempotency key — repeated calls with the same key are coalesced. */
  idempotency_key?: string
}

/**
 * Returns true when two-way sync is enabled in this environment.
 * Default: FALSE. Must be explicitly opted in.
 */
export function isTwoWaySyncEnabled(): boolean {
  return process.env.KARBON_TWO_WAY_SYNC === "true"
}

/**
 * Records an outbound change destined for Karbon. No-op when two-way sync
 * is disabled — the call is safe to leave in production code paths today.
 *
 * Returns: { queued: true, id } when persisted, { queued: false, reason } otherwise.
 */
export async function enqueueOutboundChange(opts: EnqueueOutboundChangeOptions) {
  if (!isTwoWaySyncEnabled()) {
    return { queued: false as const, reason: "two-way sync disabled" }
  }

  const supabase = tryCreateAdminClient()
  if (!supabase) {
    return { queued: false as const, reason: "supabase unavailable" }
  }

  // Coalesce on idempotency key when provided. Otherwise insert fresh.
  if (opts.idempotency_key) {
    const { data: existing } = await supabase
      .from("karbon_outbound_changes")
      .select("id")
      .eq("idempotency_key", opts.idempotency_key)
      .maybeSingle()
    if (existing) {
      return { queued: false as const, reason: "duplicate idempotency_key", id: existing.id }
    }
  }

  const { data, error } = await supabase
    .from("karbon_outbound_changes")
    .insert({
      resource_type: opts.resource_type,
      resource_perma_key: opts.resource_perma_key ?? null,
      operation: opts.operation,
      payload: opts.payload,
      origin_user_id: opts.origin_user_id ?? null,
      idempotency_key: opts.idempotency_key ?? null,
      status: "pending",
    })
    .select("id")
    .single()

  if (error) {
    console.error("[outbound-queue] insert failed:", error)
    return { queued: false as const, reason: error.message }
  }
  return { queued: true as const, id: data.id }
}
