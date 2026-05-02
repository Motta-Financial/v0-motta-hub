/**
 * Ignition webhook event handlers.
 *
 * Ignition has no public REST API; their only programmatic surface is
 * Zapier triggers (Proposal Accepted/Sent/Lost/Archived/Revoked, Service
 * Accepted/Completed, Client Created/Updated, Invoice/Payment events).
 *
 * Each handler upserts the right tables and is fully idempotent — safe to
 * replay an event log against, safe to reprocess if Zapier double-fires.
 *
 * The webhook route logs every payload to `ignition_webhook_events` BEFORE
 * dispatching here, so even if a handler throws we still have the raw body.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

// -------- Types ----------------------------------------------------------

export type IgnitionEventType =
  | "client.created"
  | "client.updated"
  | "client.archived"
  | "proposal.created"
  | "proposal.sent"
  | "proposal.accepted"
  | "proposal.completed"
  | "proposal.lost"
  | "proposal.archived"
  | "proposal.revoked"
  | "service.accepted"
  | "service.completed"
  | "invoice.created"
  | "invoice.sent"
  | "invoice.paid"
  | "invoice.voided"
  | "payment.received"
  | "payment.refunded"
  | "payment.failed"

export interface HandlerResult {
  status: "success" | "skipped" | "failed"
  resourceId?: string
  message?: string
}

// -------- Helpers --------------------------------------------------------

/** Pick first non-empty string-ish value from a payload by trying multiple keys. */
function pick<T = string>(obj: Record<string, unknown>, keys: string[]): T | null {
  for (const key of keys) {
    const v = obj[key]
    if (v !== undefined && v !== null && v !== "") return v as T
  }
  return null
}

/** Coerce a value to a Postgres-friendly date or null. */
function toDate(v: unknown): string | null {
  if (!v) return null
  const s = String(v).trim()
  if (!s) return null
  // Already a YYYY-MM-DD or full ISO? Pass through after parse-validate.
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Coerce a value to a Postgres-friendly numeric or null. */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  // Strip currency symbols / commas Zapier sometimes passes through.
  const cleaned = String(v).replace(/[^\d.\-]/g, "")
  if (!cleaned) return null
  const n = Number.parseFloat(cleaned)
  return Number.isNaN(n) ? null : n
}

// -------- Client upsert (used by both client.* and embedded inside proposal payloads) --

interface UpsertClientArgs {
  ignitionClientId: string
  payload: Record<string, unknown>
  eventReceivedAt: string
}

async function upsertIgnitionClient(supabase: SupabaseClient, args: UpsertClientArgs) {
  const { ignitionClientId, payload, eventReceivedAt } = args

  // Zapier flattens nested objects with double-underscore separators; we
  // accept either flat keys or a nested `client` object.
  const isNestedClient = payload.client && typeof payload.client === "object"
  const c = (isNestedClient
    ? (payload.client as Record<string, unknown>)
    : payload) as Record<string, unknown>

  // When the client is embedded inside a non-client event (e.g. proposal.accepted
  // payloads carry client info alongside the proposal), the top-level `name`
  // field describes the proposal, NOT the client. Restrict to client-prefixed
  // keys in that case so we don't clobber a real client name with a proposal title.
  const isStandaloneClientPayload = isNestedClient || !payload.proposal_id
  const nameKeys = isStandaloneClientPayload
    ? ["name", "client_name", "client__name", "full_name", "display_name"]
    : ["client_name", "client__name", "full_name", "display_name"]

  const row = {
    ignition_client_id: ignitionClientId,
    name: pick<string>(c, nameKeys),
    email: pick<string>(c, ["email", "client_email", "client__email", "primary_email"]),
    phone: pick<string>(c, ["phone", "client_phone", "phone_number"]),
    business_name: pick<string>(c, ["business_name", "company_name", "company", "organization_name"]),
    client_type: pick<string>(c, ["client_type", "type"]),
    address_line1: pick<string>(c, ["address_line1", "address__line1", "street", "address"]),
    address_line2: pick<string>(c, ["address_line2", "address__line2"]),
    city: pick<string>(c, ["city", "address__city"]),
    state: pick<string>(c, ["state", "region", "address__state"]),
    zip_code: pick<string>(c, ["zip_code", "postal_code", "zip", "address__postal_code"]),
    country: pick<string>(c, ["country", "address__country"]),
    ignition_created_at: toDate(pick(c, ["created_at", "client_created_at", "created"])),
    ignition_updated_at: toDate(pick(c, ["updated_at", "client_updated_at", "updated"])),
    archived_at: toDate(pick(c, ["archived_at"])),
    raw_payload: c,
    last_event_at: eventReceivedAt,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from("ignition_clients")
    .upsert(row, { onConflict: "ignition_client_id" })

  if (error) throw new Error(`upsert ignition_client: ${error.message}`)

  // Auto-match if not yet linked.
  const { data: existing } = await supabase
    .from("ignition_clients")
    .select("contact_id, organization_id, match_status")
    .eq("ignition_client_id", ignitionClientId)
    .single()

  if (existing && !existing.contact_id && !existing.organization_id && existing.match_status === "unmatched") {
    const { data: match } = await supabase.rpc("match_ignition_client_to_supabase", {
      p_ignition_client_id: ignitionClientId,
    })
    if (match && match.length > 0) {
      const m = match[0]
      const update: Record<string, unknown> = {
        match_status: m.confidence >= 1.0 ? "auto_matched" : "manual_review",
        match_confidence: m.confidence,
        match_method: m.method,
      }
      if (m.match_kind === "contact") update.contact_id = m.matched_id
      if (m.match_kind === "organization") update.organization_id = m.matched_id

      await supabase.from("ignition_clients").update(update).eq("ignition_client_id", ignitionClientId)
    }
  }
}

// -------- Event dispatcher ----------------------------------------------

export async function handleIgnitionEvent(
  supabase: SupabaseClient,
  eventType: IgnitionEventType,
  payload: Record<string, unknown>,
  eventReceivedAt: string,
): Promise<HandlerResult> {
  // Common: every event is associated with a client_id and/or proposal_id.
  // For client.* events, the top-level `id` IS the client id; for everything
  // else `id` typically refers to the proposal/invoice/payment, so we only
  // fall back to it on client.* events.
  const isClientEvent = eventType.startsWith("client.")
  const clientId = pick<string>(
    payload,
    isClientEvent
      ? ["client_id", "ignition_client_id", "client__id", "client_uuid", "id"]
      : ["client_id", "ignition_client_id", "client__id", "client_uuid"],
  )
  const proposalId = pick<string>(payload, [
    "proposal_id",
    "ignition_proposal_id",
    "proposal__id",
    // Only fall back to top-level `id` for proposal.* events.
    ...(eventType.startsWith("proposal.") ? ["id"] : []),
  ])

  // ---- Client events ---------------------------------------------------
  if (eventType.startsWith("client.")) {
    if (!clientId) return { status: "skipped", message: "no client_id in payload" }
    await upsertIgnitionClient(supabase, {
      ignitionClientId: clientId,
      payload,
      eventReceivedAt,
    })
    if (eventType === "client.archived") {
      await supabase
        .from("ignition_clients")
        .update({ archived_at: eventReceivedAt })
        .eq("ignition_client_id", clientId)
    }
    return { status: "success", resourceId: clientId }
  }

  // ---- Proposal events --------------------------------------------------
  if (eventType.startsWith("proposal.")) {
    if (!proposalId) return { status: "skipped", message: "no proposal_id in payload" }

    // First, make sure the embedded client exists (Zapier usually inlines it).
    if (clientId) {
      await upsertIgnitionClient(supabase, {
        ignitionClientId: clientId,
        payload,
        eventReceivedAt,
      })
    }

    const row: Record<string, unknown> = {
      proposal_id: proposalId,
      ignition_client_id: clientId,
      title: pick(payload, ["title", "proposal_title", "name"]),
      status: pick(payload, ["status", "proposal_status", "state"]),
      proposal_number: pick(payload, ["proposal_number", "number"]),
      client_name: pick(payload, ["client_name", "client__name"]),
      client_email: pick(payload, ["client_email", "client__email"]),
      amount: toNumber(pick(payload, ["amount", "total", "total_value", "value"])),
      currency: pick(payload, ["currency", "currency_code"]),
      sent_at: toDate(pick(payload, ["sent_at", "proposal_sent_at"])),
      accepted_at: toDate(pick(payload, ["accepted_at", "proposal_accepted_at"])),
      completed_at: toDate(pick(payload, ["completed_at", "proposal_completed_at"])),
      lost_at: toDate(pick(payload, ["lost_at"])),
      lost_reason: pick(payload, ["lost_reason", "reason"]),
      archived_at: toDate(pick(payload, ["archived_at"])),
      revoked_at: toDate(pick(payload, ["revoked_at"])),
      effective_start_date: toDate(pick(payload, ["effective_start_date"])),
      billing_starts_on: toDate(pick(payload, ["billing_starts_on"])),
      one_time_total: toNumber(pick(payload, ["one_time_total", "one_off_total"])),
      recurring_total: toNumber(pick(payload, ["recurring_total"])),
      recurring_frequency: pick(payload, ["recurring_frequency", "frequency"]),
      total_value: toNumber(pick(payload, ["total_value", "annual_value"])),
      proposal_sent_by: pick(payload, ["proposal_sent_by", "sent_by"]),
      client_manager: pick(payload, ["client_manager", "manager"]),
      client_partner: pick(payload, ["client_partner", "partner"]),
      signed_url: pick(payload, ["signed_url", "proposal_url", "url"]),
      // `payload` is the legacy NOT NULL column from the original schema; we
      // mirror raw_payload into it so old queries keep working without a
      // breaking migration.
      payload,
      raw_payload: payload,
      last_event_at: eventReceivedAt,
      updated_at: new Date().toISOString(),
    }

    // Stamp the event-specific timestamp from received_at if the payload
    // didn't carry one (so we always know when the lifecycle changed).
    const stamps: Partial<Record<keyof typeof row, string>> = {
      "proposal.sent": "sent_at",
      "proposal.accepted": "accepted_at",
      "proposal.completed": "completed_at",
      "proposal.lost": "lost_at",
      "proposal.archived": "archived_at",
      "proposal.revoked": "revoked_at",
    }
    const stampKey = stamps[eventType as keyof typeof stamps]
    if (stampKey && !row[stampKey]) row[stampKey] = eventReceivedAt

    const { error } = await supabase
      .from("ignition_proposals")
      .upsert(row, { onConflict: "proposal_id" })

    if (error) throw new Error(`upsert ignition_proposal: ${error.message}`)
    return { status: "success", resourceId: proposalId }
  }

  // ---- Service events --------------------------------------------------
  if (eventType.startsWith("service.")) {
    const serviceId = pick<string>(payload, ["service_id", "ignition_service_id", "service__id"])
    if (!proposalId || !serviceId) {
      return { status: "skipped", message: "missing proposal_id or service_id" }
    }

    // Upsert into service catalog.
    await supabase.from("ignition_services").upsert(
      {
        ignition_service_id: serviceId,
        name: pick(payload, ["service_name", "service__name", "name"]) || "(unnamed)",
        description: pick(payload, ["description", "service_description"]),
        category: pick(payload, ["service_category", "category"]),
        billing_type: pick(payload, ["billing_type", "service_billing_type"]),
        currency: pick(payload, ["currency"]),
        raw_payload: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ignition_service_id" },
    )

    // Upsert proposal_service line item.
    const ordinal = (pick<number>(payload, ["ordinal", "line_number", "position"]) as number) ?? 0
    await supabase.from("ignition_proposal_services").upsert(
      {
        proposal_id: proposalId,
        ignition_service_id: serviceId,
        ordinal,
        service_name: pick(payload, ["service_name", "service__name", "name"]) || "(unnamed)",
        description: pick(payload, ["description"]),
        quantity: toNumber(pick(payload, ["quantity"])),
        unit_price: toNumber(pick(payload, ["unit_price", "price"])),
        total_amount: toNumber(pick(payload, ["total_amount", "total", "amount"])),
        currency: pick(payload, ["currency"]),
        billing_frequency: pick(payload, ["billing_frequency", "frequency"]),
        billing_type: pick(payload, ["billing_type"]),
        start_date: toDate(pick(payload, ["start_date", "billing_starts_on"])),
        end_date: toDate(pick(payload, ["end_date"])),
        status: pick(payload, ["service_status", "status"]),
        accepted_at: eventType === "service.accepted" ? eventReceivedAt : null,
        completed_at: eventType === "service.completed" ? eventReceivedAt : null,
        raw_payload: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "proposal_id,ignition_service_id,ordinal" },
    )
    return { status: "success", resourceId: `${proposalId}/${serviceId}` }
  }

  // ---- Invoice events --------------------------------------------------
  if (eventType.startsWith("invoice.")) {
    const invoiceId = pick<string>(payload, [
      "invoice_id",
      "ignition_invoice_id",
      "invoice__id",
      "id",
    ])
    if (!invoiceId) return { status: "skipped", message: "no invoice_id" }

    const row: Record<string, unknown> = {
      ignition_invoice_id: invoiceId,
      proposal_id: proposalId,
      ignition_client_id: clientId,
      invoice_number: pick(payload, ["invoice_number", "number"]),
      status: pick(payload, ["status", "invoice_status"]),
      amount: toNumber(pick(payload, ["amount", "total"])),
      amount_paid: toNumber(pick(payload, ["amount_paid", "paid"])),
      amount_outstanding: toNumber(pick(payload, ["amount_outstanding", "outstanding"])),
      currency: pick(payload, ["currency"]),
      invoice_date: toDate(pick(payload, ["invoice_date", "issued_at"])),
      due_date: toDate(pick(payload, ["due_date"])),
      sent_at: toDate(pick(payload, ["sent_at"])),
      paid_at: toDate(pick(payload, ["paid_at"])),
      voided_at: toDate(pick(payload, ["voided_at"])),
      stripe_invoice_id: pick(payload, ["stripe_invoice_id"]),
      stripe_customer_id: pick(payload, ["stripe_customer_id"]),
      raw_payload: payload,
      last_event_at: eventReceivedAt,
      updated_at: new Date().toISOString(),
    }

    const stamps: Record<string, string> = {
      "invoice.sent": "sent_at",
      "invoice.paid": "paid_at",
      "invoice.voided": "voided_at",
    }
    const stampKey = stamps[eventType]
    if (stampKey && !row[stampKey]) row[stampKey] = eventReceivedAt

    const { error } = await supabase
      .from("ignition_invoices")
      .upsert(row, { onConflict: "ignition_invoice_id" })
    if (error) throw new Error(`upsert ignition_invoice: ${error.message}`)
    return { status: "success", resourceId: invoiceId }
  }

  // ---- Payment events --------------------------------------------------
  if (eventType.startsWith("payment.")) {
    const paymentId = pick<string>(payload, [
      "payment_id",
      "ignition_payment_id",
      "payment__id",
      "id",
    ])
    const invoiceId = pick<string>(payload, ["invoice_id", "ignition_invoice_id"])
    if (!paymentId) return { status: "skipped", message: "no payment_id" }

    const row: Record<string, unknown> = {
      ignition_payment_id: paymentId,
      ignition_invoice_id: invoiceId,
      proposal_id: proposalId,
      ignition_client_id: clientId,
      amount: toNumber(pick(payload, ["amount", "gross_amount"])),
      fees: toNumber(pick(payload, ["fees", "fee"])),
      net_amount: toNumber(pick(payload, ["net_amount", "net"])),
      currency: pick(payload, ["currency"]),
      payment_method: pick(payload, ["payment_method", "method"]),
      payment_status: pick(payload, ["payment_status", "status"]),
      paid_at: toDate(pick(payload, ["paid_at", "payment_date"])),
      refunded_at: eventType === "payment.refunded" ? eventReceivedAt : null,
      refund_amount: toNumber(pick(payload, ["refund_amount"])),
      stripe_charge_id: pick(payload, ["stripe_charge_id"]),
      stripe_payment_intent_id: pick(payload, ["stripe_payment_intent_id"]),
      raw_payload: payload,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from("ignition_payments")
      .upsert(row, { onConflict: "ignition_payment_id" })
    if (error) throw new Error(`upsert ignition_payment: ${error.message}`)
    return { status: "success", resourceId: paymentId }
  }

  return { status: "skipped", message: `unknown event_type: ${eventType}` }
}
