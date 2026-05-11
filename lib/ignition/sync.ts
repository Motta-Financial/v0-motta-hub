/**
 * Ignition Reporting API backfill / sync layer.
 *
 * Responsibilities
 * ----------------
 * - Pull every page of every reporting endpoint we care about.
 * - Map each Ignition row to the shape of our existing `ignition_*` tables.
 * - UPSERT in batches keyed on Ignition's natural ID column so the whole
 *   thing is idempotent and safe to re-run.
 * - Always stash the raw API row into `raw_payload` so a wrong field mapping
 *   is recoverable from the database without re-hitting Ignition's rate
 *   limited API.
 *
 * Field-name strategy
 * -------------------
 * Ignition's docs and exports show different field names in different
 * places (snake_case in API, camelCase in some webhook payloads, mixed
 * `clientId` vs `client_id` in different exports). Rather than hard-code
 * one variant and risk shipping a backfill that quietly drops half the
 * columns, every mapper uses `pick(obj, ...keys)` which tries each candidate
 * key in order. This makes the mappers verbose but lets a single field name
 * change in the API roll out without breaking the sync.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type IgnitionConnectionRow,
  ignitionPaginate,
} from "@/lib/ignition/oauth"

/* ─────────────────────────────────────────────────────────────────────────
 * Generic helpers
 * ───────────────────────────────────────────────────────────────────────── */

/** Tries each key in order on `obj` and returns the first non-null/undefined
 *  value. Used everywhere in the mappers to tolerate field name variants. */
function pick<T = unknown>(obj: Record<string, any> | null | undefined, ...keys: string[]): T | null {
  if (!obj) return null
  for (const key of keys) {
    const value = key.split(".").reduce<any>((acc, part) => (acc == null ? acc : acc[part]), obj)
    if (value !== null && value !== undefined) return value as T
  }
  return null
}

function pickStr(obj: Record<string, any> | null | undefined, ...keys: string[]): string | null {
  const v = pick(obj, ...keys)
  if (v == null) return null
  return String(v)
}

function pickNum(obj: Record<string, any> | null | undefined, ...keys: string[]): number | null {
  const v = pick(obj, ...keys)
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function pickBool(obj: Record<string, any> | null | undefined, ...keys: string[]): boolean | null {
  const v = pick(obj, ...keys)
  if (v == null) return null
  if (typeof v === "boolean") return v
  if (v === "true" || v === 1 || v === "1") return true
  if (v === "false" || v === 0 || v === "0") return false
  return null
}

/** Coerces to an ISO timestamp string. Accepts Date, number (epoch seconds
 *  OR milliseconds), or string. Returns null on anything unparseable. */
function pickIso(obj: Record<string, any> | null | undefined, ...keys: string[]): string | null {
  const v = pick(obj, ...keys)
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "number") {
    // Heuristic: anything below 10^12 we treat as seconds (since the cutoff for
    // "year 33658 in milliseconds" is below 10^12). This matches what Stripe
    // and similar APIs do and is safe through year ~33,000.
    const ms = v < 1e12 ? v * 1000 : v
    const d = new Date(ms)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }
  const d = new Date(String(v))
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** Same as pickIso but truncated to a YYYY-MM-DD `date` column. */
function pickDate(obj: Record<string, any> | null | undefined, ...keys: string[]): string | null {
  const iso = pickIso(obj, ...keys)
  return iso ? iso.slice(0, 10) : null
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/* ─────────────────────────────────────────────────────────────────────────
 * Public types
 * ───────────────────────────────────────────────────────────────────────── */

export type ResourceName =
  | "clients"
  | "contacts"
  | "deal_stages"
  | "deals"
  | "services"
  | "proposals"
  | "invoices"
  | "payments"
  | "collections"

/** Order matters: dependencies must be synced before the things that depend
 *  on them. Specifically: deal_stages before deals (FK reference), clients
 *  before everything else (most resources carry an ignition_client_id). */
export const RESOURCE_ORDER: ResourceName[] = [
  "clients",
  "contacts",
  "deal_stages",
  "deals",
  "services",
  "proposals",
  "invoices",
  "payments",
  "collections",
]

export interface ResourceSyncResult {
  resource: ResourceName
  fetched: number
  upserted: number
  pages: number
  durationMs: number
  errors: string[]
}

export interface FullBackfillResult {
  startedAt: string
  finishedAt: string
  totalFetched: number
  totalUpserted: number
  totalErrors: number
  results: ResourceSyncResult[]
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shared run-loop. Every per-resource sync function follows the same
 * pattern, so we factor out the iteration and reporting boilerplate.
 * ───────────────────────────────────────────────────────────────────────── */

const BATCH_SIZE = 250

async function runResource<T>(
  resource: ResourceName,
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  path: string,
  upsertBatch: (rows: T[]) => Promise<{ upserted: number; error?: string }>,
  mapRow: (raw: any) => T | null,
): Promise<ResourceSyncResult> {
  const start = Date.now()
  const errors: string[] = []
  let fetched = 0
  let upserted = 0
  let pages = 0

  try {
    for await (const page of ignitionPaginate<any>(connection, supabase, path)) {
      pages += 1
      const rows = (page.data ?? [])
        .map(mapRow)
        .filter((row): row is T => row !== null)
      fetched += page.data?.length ?? 0

      for (const batch of chunk(rows, BATCH_SIZE)) {
        const { upserted: n, error } = await upsertBatch(batch)
        upserted += n
        if (error) errors.push(error)
      }
    }
  } catch (err: any) {
    errors.push(`fetch_failed: ${err?.message || String(err)}`)
  }

  return {
    resource,
    fetched,
    upserted,
    pages,
    durationMs: Date.now() - start,
    errors,
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Per-resource sync functions.
 *
 * Each one is intentionally explicit about which columns it writes; we
 * never blind-spread `...raw` into the database because column names in
 * the Ignition API don't match our schema and we want a stable contract.
 * ───────────────────────────────────────────────────────────────────────── */

export async function syncClients(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  return runResource(
    "clients",
    connection,
    supabase,
    "/reporting/clients",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_clients")
        .upsert(rows, { onConflict: "ignition_client_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "client_id", "ignition_client_id")
      if (!id) return null
      return {
        ignition_client_id: id,
        name: pickStr(raw, "name", "display_name", "full_name"),
        email: pickStr(raw, "email", "primary_email"),
        phone: pickStr(raw, "phone", "phone_number"),
        business_name: pickStr(raw, "business_name", "company_name", "organization_name"),
        client_type: pickStr(raw, "client_type", "type"),
        address_line1: pickStr(raw, "address.line1", "address.address_line1", "address_line1"),
        address_line2: pickStr(raw, "address.line2", "address.address_line2", "address_line2"),
        city: pickStr(raw, "address.city", "city"),
        state: pickStr(raw, "address.state", "state", "address.region"),
        zip_code: pickStr(raw, "address.zip", "address.zip_code", "address.postal_code", "zip_code"),
        country: pickStr(raw, "address.country", "country"),
        ignition_created_at: pickIso(raw, "created_at", "inserted_at"),
        ignition_updated_at: pickIso(raw, "updated_at", "modified_at"),
        archived_at: pickIso(raw, "archived_at", "deleted_at"),
        last_event_at: pickIso(raw, "updated_at", "modified_at", "last_event_at"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
  )
}

export async function syncContacts(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  return runResource(
    "contacts",
    connection,
    supabase,
    "/reporting/contacts",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_contacts")
        .upsert(rows, { onConflict: "ignition_contact_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "contact_id", "ignition_contact_id")
      if (!id) return null
      const first = pickStr(raw, "first_name", "firstName", "given_name")
      const last = pickStr(raw, "last_name", "lastName", "family_name")
      const full =
        pickStr(raw, "full_name", "name", "display_name") ||
        [first, last].filter(Boolean).join(" ").trim() ||
        null
      return {
        ignition_contact_id: id,
        ignition_client_id: pickStr(raw, "client_id", "client.id", "clientId"),
        first_name: first,
        last_name: last,
        full_name: full,
        email: pickStr(raw, "email", "primary_email"),
        phone: pickStr(raw, "phone", "phone_number"),
        role: pickStr(raw, "role", "title", "job_title"),
        raw_payload: raw,
        ignition_created_at: pickIso(raw, "created_at", "inserted_at"),
        ignition_updated_at: pickIso(raw, "updated_at", "modified_at"),
        last_event_at: pickIso(raw, "updated_at", "modified_at"),
        updated_at: new Date().toISOString(),
      }
    },
  )
}

export async function syncDealStages(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  return runResource(
    "deal_stages",
    connection,
    supabase,
    "/reporting/deal_stages",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_deal_stages")
        .upsert(rows, { onConflict: "ignition_stage_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "stage_id", "ignition_stage_id")
      if (!id) return null
      return {
        ignition_stage_id: id,
        name: pickStr(raw, "name", "stage_name"),
        pipeline_name: pickStr(raw, "pipeline_name", "pipeline.name", "pipeline"),
        is_active: pickBool(raw, "is_active", "active"),
        is_won: pickBool(raw, "is_won", "won"),
        is_lost: pickBool(raw, "is_lost", "lost"),
        sort_order: pickNum(raw, "sort_order", "order", "ordinal", "position"),
        raw_payload: raw,
        ignition_created_at: pickIso(raw, "created_at", "inserted_at"),
        ignition_updated_at: pickIso(raw, "updated_at", "modified_at"),
        updated_at: new Date().toISOString(),
      }
    },
  )
}

export async function syncDeals(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  return runResource(
    "deals",
    connection,
    supabase,
    "/reporting/deals",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_deals")
        .upsert(rows, { onConflict: "ignition_deal_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "deal_id", "ignition_deal_id")
      if (!id) return null
      return {
        ignition_deal_id: id,
        ignition_client_id: pickStr(raw, "client_id", "client.id", "clientId"),
        ignition_stage_id: pickStr(raw, "stage_id", "stage.id", "stageId", "deal_stage_id"),
        pipeline_name: pickStr(raw, "pipeline_name", "pipeline.name", "pipeline"),
        stage_name: pickStr(raw, "stage_name", "stage.name", "stage"),
        title: pickStr(raw, "title", "name", "description"),
        status: pickStr(raw, "status", "state"),
        owner_name: pickStr(raw, "owner_name", "owner.name", "owner.full_name"),
        owner_email: pickStr(raw, "owner_email", "owner.email"),
        value: pickNum(raw, "value", "amount", "total_value", "total"),
        currency: pickStr(raw, "currency", "currency_code"),
        expected_close_date: pickDate(raw, "expected_close_date", "expected_close", "close_date"),
        closed_at: pickIso(raw, "closed_at", "completed_at"),
        raw_payload: raw,
        ignition_created_at: pickIso(raw, "created_at", "inserted_at"),
        ignition_updated_at: pickIso(raw, "updated_at", "modified_at"),
        last_event_at: pickIso(raw, "updated_at", "modified_at"),
        updated_at: new Date().toISOString(),
      }
    },
  )
}

export async function syncServices(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  return runResource(
    "services",
    connection,
    supabase,
    "/reporting/services",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_services")
        .upsert(rows, { onConflict: "ignition_service_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "service_id", "ignition_service_id")
      if (!id) return null
      return {
        ignition_service_id: id,
        name: pickStr(raw, "name", "title"),
        description: pickStr(raw, "description", "summary"),
        category: pickStr(raw, "category", "service_category"),
        is_active: pickBool(raw, "is_active", "active"),
        default_price: pickNum(raw, "default_price", "price", "unit_price"),
        currency: pickStr(raw, "currency", "currency_code"),
        billing_type: pickStr(raw, "billing_type", "billing_frequency", "frequency"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
  )
}

export async function syncProposals(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  // Proposals already have Zapier-fed columns (payload, status, client_name).
  // We write to `raw_payload` (not `payload`) and only set columns we are
  // confident about — the upsert leaves any column we DON'T provide untouched,
  // so the existing webhook data stays intact.
  return runResource(
    "proposals",
    connection,
    supabase,
    "/reporting/proposals",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_proposals")
        .upsert(rows, { onConflict: "proposal_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "proposal_id", "ignition_proposal_id")
      if (!id) return null
      return {
        proposal_id: id,
        ignition_client_id: pickStr(raw, "client_id", "client.id", "clientId"),
        title: pickStr(raw, "title", "name"),
        proposal_number: pickStr(raw, "proposal_number", "number"),
        status: pickStr(raw, "status", "state"),
        client_name: pickStr(raw, "client_name", "client.name", "client.business_name"),
        client_email: pickStr(raw, "client_email", "client.email"),
        client_partner: pickStr(raw, "client_partner", "partner_name"),
        client_manager: pickStr(raw, "client_manager", "manager_name"),
        proposal_sent_by: pickStr(raw, "sent_by", "proposal_sent_by", "owner_name"),
        recurring_frequency: pickStr(raw, "recurring_frequency", "billing_frequency"),
        lost_reason: pickStr(raw, "lost_reason"),
        currency: pickStr(raw, "currency", "currency_code"),
        signed_url: pickStr(raw, "signed_url", "signing_url", "url"),
        amount: pickNum(raw, "amount", "total"),
        total_value: pickNum(raw, "total_value", "total", "amount"),
        one_time_total: pickNum(raw, "one_time_total", "oneTimeTotal"),
        recurring_total: pickNum(raw, "recurring_total", "recurringTotal"),
        effective_start_date: pickDate(raw, "effective_start_date", "start_date"),
        billing_starts_on: pickDate(raw, "billing_starts_on", "billing_start_date"),
        sent_at: pickIso(raw, "sent_at"),
        accepted_at: pickIso(raw, "accepted_at"),
        completed_at: pickIso(raw, "completed_at"),
        lost_at: pickIso(raw, "lost_at"),
        revoked_at: pickIso(raw, "revoked_at"),
        archived_at: pickIso(raw, "archived_at"),
        inserted_at: pickIso(raw, "inserted_at", "created_at"),
        modified_at: pickIso(raw, "modified_at", "updated_at"),
        last_event_at: pickIso(raw, "updated_at", "modified_at"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
  )
}

export async function syncInvoices(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  return runResource(
    "invoices",
    connection,
    supabase,
    "/reporting/invoices",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_invoices")
        .upsert(rows, { onConflict: "ignition_invoice_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "invoice_id", "ignition_invoice_id")
      if (!id) return null
      return {
        ignition_invoice_id: id,
        ignition_client_id: pickStr(raw, "client_id", "client.id"),
        proposal_id: pickStr(raw, "proposal_id", "proposal.id"),
        invoice_number: pickStr(raw, "invoice_number", "number"),
        status: pickStr(raw, "status", "state"),
        currency: pickStr(raw, "currency", "currency_code"),
        amount: pickNum(raw, "amount", "total"),
        amount_paid: pickNum(raw, "amount_paid", "paid_amount"),
        amount_outstanding: pickNum(raw, "amount_outstanding", "outstanding_amount", "balance"),
        stripe_invoice_id: pickStr(raw, "stripe_invoice_id"),
        stripe_customer_id: pickStr(raw, "stripe_customer_id"),
        invoice_date: pickDate(raw, "invoice_date", "issue_date", "issued_at"),
        due_date: pickDate(raw, "due_date"),
        sent_at: pickIso(raw, "sent_at"),
        paid_at: pickIso(raw, "paid_at"),
        voided_at: pickIso(raw, "voided_at"),
        last_event_at: pickIso(raw, "updated_at", "modified_at"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
  )
}

export async function syncPayments(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  return runResource(
    "payments",
    connection,
    supabase,
    "/reporting/payments",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_payments")
        .upsert(rows, { onConflict: "ignition_payment_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "payment_id", "ignition_payment_id")
      if (!id) return null
      return {
        ignition_payment_id: id,
        ignition_client_id: pickStr(raw, "client_id", "client.id"),
        ignition_invoice_id: pickStr(raw, "invoice_id", "invoice.id"),
        proposal_id: pickStr(raw, "proposal_id", "proposal.id"),
        payment_status: pickStr(raw, "status", "state", "payment_status"),
        payment_method: pickStr(raw, "payment_method", "method"),
        amount: pickNum(raw, "amount", "gross_amount"),
        net_amount: pickNum(raw, "net_amount", "net"),
        fees: pickNum(raw, "fees", "fee_amount"),
        refund_amount: pickNum(raw, "refund_amount", "refunded_amount"),
        currency: pickStr(raw, "currency", "currency_code"),
        stripe_charge_id: pickStr(raw, "stripe_charge_id"),
        stripe_payment_intent_id: pickStr(raw, "stripe_payment_intent_id"),
        paid_at: pickIso(raw, "paid_at", "payment_date"),
        refunded_at: pickIso(raw, "refunded_at"),
        raw_payload: raw,
        updated_at: new Date().toISOString(),
      }
    },
  )
}

export async function syncCollections(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<ResourceSyncResult> {
  // /reporting/collections returns disbursals (money paid out to the practice).
  // Maps to the existing ignition_disbursals table.
  return runResource(
    "collections",
    connection,
    supabase,
    "/reporting/collections",
    async (rows) => {
      if (rows.length === 0) return { upserted: 0 }
      const { error, count } = await supabase
        .from("ignition_disbursals")
        .upsert(rows, { onConflict: "disbursal_id", count: "exact" })
      if (error) return { upserted: 0, error: `upsert_failed: ${error.message}` }
      return { upserted: count ?? rows.length }
    },
    (raw) => {
      const id = pickStr(raw, "id", "disbursal_id", "collection_id")
      if (!id) return null
      return {
        disbursal_id: id,
        state: pickStr(raw, "state", "status"),
        currency: pickStr(raw, "currency", "currency_code"),
        total_amount: pickNum(raw, "total_amount", "amount", "gross_amount"),
        total_fees: pickNum(raw, "total_fees", "fees"),
        arrival_date: pickDate(raw, "arrival_date", "expected_arrival_date"),
        submitted_date: pickDate(raw, "submitted_date", "submitted_at"),
        notes: pickStr(raw, "notes", "description"),
        updated_at: new Date().toISOString(),
      }
    },
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * Orchestrator
 * ───────────────────────────────────────────────────────────────────────── */

const RESOURCE_FUNCTIONS: Record<
  ResourceName,
  (conn: IgnitionConnectionRow, sb: SupabaseClient) => Promise<ResourceSyncResult>
> = {
  clients: syncClients,
  contacts: syncContacts,
  deal_stages: syncDealStages,
  deals: syncDeals,
  services: syncServices,
  proposals: syncProposals,
  invoices: syncInvoices,
  payments: syncPayments,
  collections: syncCollections,
}

/**
 * Run a backfill across one or more resources. Updates the connection row's
 * sync timestamps and writes a `sync_log` entry summarizing the run.
 *
 * If any single resource fails, we keep going and aggregate errors at the
 * end. A partial success leaves `last_synced_at` updated but also writes
 * `last_sync_error` so the UI can warn the user.
 */
export async function runFullBackfill(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  options: {
    resources?: ResourceName[]
    triggeredByTeamMemberId?: string | null
    isManual?: boolean
  } = {},
): Promise<FullBackfillResult> {
  const startedAt = new Date().toISOString()
  const resources = options.resources?.length
    ? options.resources.filter((r): r is ResourceName => r in RESOURCE_FUNCTIONS)
    : RESOURCE_ORDER

  // Mark the connection row as syncing so the UI can show a spinner without
  // having to poll the orchestrator's progress.
  await supabase
    .from("ignition_connections")
    .update({
      last_sync_started_at: startedAt,
      last_sync_error: null,
      updated_at: startedAt,
    })
    .eq("id", connection.id)

  // Open a sync_log row up-front so we have a stable id to update later.
  const { data: syncLogRow } = await supabase
    .from("sync_log")
    .insert({
      sync_type: "ignition_backfill",
      sync_direction: "inbound",
      status: "running",
      started_at: startedAt,
      is_manual: options.isManual ?? true,
      triggered_by_id: options.triggeredByTeamMemberId ?? null,
    })
    .select("id")
    .maybeSingle()

  const results: ResourceSyncResult[] = []
  for (const resource of resources) {
    const fn = RESOURCE_FUNCTIONS[resource]
    if (!fn) continue
    const result = await fn(connection, supabase)
    results.push(result)
  }

  const finishedAt = new Date().toISOString()
  const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0)
  const totalUpserted = results.reduce((sum, r) => sum + r.upserted, 0)
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)
  const overallStatus = totalErrors === 0 ? "success" : "partial"

  // Update the connection row with the outcome. We always set last_synced_at
  // even on partial failure so subsequent jobs aren't confused by a stale
  // "Never" — last_sync_error carries the failure context.
  await supabase
    .from("ignition_connections")
    .update({
      last_synced_at: finishedAt,
      last_sync_started_at: null,
      last_sync_error:
        totalErrors === 0
          ? null
          : results
              .filter((r) => r.errors.length > 0)
              .map((r) => `${r.resource}: ${r.errors[0]}`)
              .join("; "),
      updated_at: finishedAt,
    })
    .eq("id", connection.id)

  if (syncLogRow?.id) {
    await supabase
      .from("sync_log")
      .update({
        status: overallStatus,
        completed_at: finishedAt,
        records_fetched: totalFetched,
        records_updated: totalUpserted,
        records_failed: totalErrors,
        error_details: totalErrors > 0 ? (results as any) : null,
      })
      .eq("id", syncLogRow.id)
  }

  return {
    startedAt,
    finishedAt,
    totalFetched,
    totalUpserted,
    totalErrors,
    results,
  }
}
