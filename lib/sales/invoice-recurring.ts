/**
 * Invoice-anchored recurring revenue
 * ────────────────────────────────────────────────────────────────────────
 * Derives the firm's LIVE recurring book from what Ignition actually
 * invoices, instead of from proposal service lines.
 *
 * Why: proposals are a statement of intent, and Ignition never flips a
 * proposal off `status = "accepted"` when its engagement ends or is
 * superseded. A Nov 2026 reconciliation against real invoices found the
 * proposal-based MRR overstated by ~24%:
 *   • ended engagements still counted (proposal_end_date passed, billing
 *     stopped — e.g. a $574/mo bookkeeping client whose last invoice was
 *     five months ago),
 *   • superseded engagements double-counted (old $4,000/mo proposal still
 *     "accepted" next to the $15,000/mo one that replaced it),
 *   • renegotiated rates stale (billing changed without a new proposal),
 *   • real recurring billing missed entirely (a $3,000/mo CFO line with
 *     no counted proposal line behind it).
 *
 * The invoice ledger has none of those problems: a line is recurring
 * revenue iff it is actually billing on a cadence, at whatever amount the
 * most recent invoice shows.
 *
 * Algorithm
 * ─────────
 * 1. Pull non-voided Reporting-API invoices (payment_state IS NOT NULL —
 *    the legacy CSV imports carry no line items) from the last ~4 full
 *    months, and explode their `items` JSON.
 * 2. Group line items by (client, normalized description). Same-invoice
 *    duplicates sum (two "Additional Employee" lines on one invoice are
 *    one month's charge).
 * 3. Classify each group with the shared service classifier. Firm policy
 *    applies unchanged: Tax lines are never recurring; onboarding /
 *    set-up / clean-up lines are one-time by definition.
 * 4. Decide cadence from the billing pattern:
 *      • billed in consecutive months            → monthly
 *      • billed on a steady ~3-month gap         → quarterly
 *      • billed in only one month so far         → adopt the cadence of
 *        the matching accepted-proposal line (catches brand-new
 *        engagements whose second invoice hasn't landed yet); skip when
 *        no monthly/quarterly proposal line backs it
 *      • ≥3 invoices inside a single month       → weekly/ad-hoc, skipped
 *        (firm policy already excludes weekly from MRR)
 * 5. Recency gate so churned lines age out: monthly lines must have
 *    billed within the last 45 days, quarterly within the last 100.
 * 6. MRR = most recent invoice amount (monthly) or amount ÷ 3
 *    (quarterly). The latest amount wins so renegotiations are reflected
 *    immediately.
 *
 * Kept as a lib so /api/sales/recurring-revenue and /api/sales/dashboard
 * compute the SAME number — they disagreed before (the dashboard quoted
 * the partner CSV while the page quoted proposals).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  classifyService,
  normalizeBillingFrequency,
  type Department,
} from "@/lib/sales/ignition-recurring"

export interface InvoiceRecurringLine {
  ignition_client_id: string | null
  organization_id: string | null
  contact_id: string | null
  /** Best-effort display name from ignition_clients (the API routes may
   *  override it with the linked org/contact name). */
  client_name: string
  /** Invoice line description exactly as Ignition bills it. */
  description: string
  department: Department
  service_type: string
  cadence: "monthly" | "quarterly"
  /** Per-cycle amount from the MOST RECENT invoice — reflects
   *  renegotiations that never produced a new proposal. */
  period_amount: number
  mrr: number
  arr: number
  last_billed_on: string
  months_billed: number
  /** Proposal slugs referenced by the billing lines (origin_identifier),
   *  for linking the invoice reality back to the proposals behind it. */
  proposal_slugs: string[]
}

export interface InvoiceRecurringResult {
  lines: InvoiceRecurringLine[]
  totals: {
    mrr: number
    arr: number
    distinct_clients: number
    lines: number
  }
  /** First day of the invoice window the computation looked at. */
  windowStart: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** "YYYY-MM" → absolute month index for gap math. */
function monthIndex(yyyymm: string): number {
  const [y, m] = yyyymm.split("-").map(Number)
  return y * 12 + (m - 1)
}

/** Fetch every row of a paged PostgREST query (1000-row response cap). */
async function fetchPaged<T>(
  build: () => any,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data ?? []) as T[]
    out.push(...chunk)
    if (chunk.length < PAGE) break
    if (offset >= 50_000) break
  }
  return out
}

export async function computeInvoiceAnchoredRecurring(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<InvoiceRecurringResult> {
  // ── Window: 4 full months back catches two quarterly cycles ─────────
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 4, 1)
  const windowStartIso = windowStart.toISOString().slice(0, 10)

  // ── Cadence hints from accepted-proposal lines ───────────────────────
  // Used ONLY for lines that have billed a single time so far (new
  // engagements). Key: `${proposal_slug}::${lowercased description}`.
  const acceptedIds = await fetchPaged<{ proposal_id: string }>(() =>
    supabase
      .from("ignition_proposals")
      .select("proposal_id")
      .is("archived_at", null)
      .is("revoked_at", null)
      .is("lost_at", null)
      .not("accepted_at", "is", null)
      .eq("status", "accepted"),
  )
  const proposalLineFreq = new Map<string, "monthly" | "quarterly">()
  {
    const ids = acceptedIds.map((r) => r.proposal_id)
    const CHUNK = 200
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      const rows = await fetchPaged<{
        proposal_id: string
        service_name: string | null
        billing_frequency: string | null
      }>(() =>
        supabase
          .from("ignition_proposal_services")
          .select("proposal_id, service_name, billing_frequency")
          .in("proposal_id", chunk),
      )
      for (const r of rows) {
        const freq = normalizeBillingFrequency(r.billing_frequency)
        if (freq !== "monthly" && freq !== "quarterly") continue
        const key = `${r.proposal_id}::${(r.service_name ?? "").trim().toLowerCase()}`
        proposalLineFreq.set(key, freq)
      }
    }
  }

  // ── Invoice lines in the window ───────────────────────────────────────
  interface InvoiceRow {
    ignition_invoice_id: string
    ignition_client_id: string | null
    organization_id: string | null
    contact_id: string | null
    invoice_date: string | null
    items: Array<Record<string, unknown>> | null
  }
  const invoices = await fetchPaged<InvoiceRow>(() =>
    supabase
      .from("ignition_invoices")
      .select(
        "ignition_invoice_id, ignition_client_id, organization_id, contact_id, invoice_date, items",
      )
      .is("voided_at", null)
      .not("payment_state", "is", null)
      .not("items", "is", null)
      .gte("invoice_date", windowStartIso),
  )

  // ── Group: (client, description) → per-invoice occurrences ──────────
  interface Occurrence {
    date: string
    month: string
    amount: number
    proposal: string | null
  }
  interface Group {
    ignition_client_id: string | null
    organization_id: string | null
    contact_id: string | null
    description: string
    department: Department
    service_type: string
    /** invoice id → occurrence, so same-invoice duplicates sum. */
    byInvoice: Map<string, Occurrence>
  }
  const groups = new Map<string, Group>()

  for (const inv of invoices) {
    if (!inv.invoice_date || !Array.isArray(inv.items)) continue
    const clientKey =
      inv.ignition_client_id ?? inv.organization_id ?? inv.contact_id
    if (!clientKey) continue // unattributable — can't roll up by client

    for (const raw of inv.items) {
      const it = raw as {
        description?: unknown
        total?: unknown
        origin_type?: unknown
        origin_identifier?: unknown
      }
      const description = typeof it.description === "string" ? it.description.trim() : ""
      if (!description) continue
      const amount = Number(it.total) || 0
      if (amount <= 0) continue

      const cls = classifyService(description)
      // Firm policy, unchanged from the proposal-based computation:
      // Tax never recurs; onboarding/set-up/clean-up is one-time work.
      if (cls.department === "Tax" || cls.is_onboarding) continue

      const groupKey = `${clientKey}::${description.toLowerCase()}`
      let g = groups.get(groupKey)
      if (!g) {
        g = {
          ignition_client_id: inv.ignition_client_id,
          organization_id: inv.organization_id,
          contact_id: inv.contact_id,
          description,
          department: cls.department,
          service_type: cls.service_type,
          byInvoice: new Map(),
        }
        groups.set(groupKey, g)
      }
      // Backfill links a later invoice might carry that an earlier one lacked.
      g.organization_id ??= inv.organization_id
      g.contact_id ??= inv.contact_id

      const occ = g.byInvoice.get(inv.ignition_invoice_id)
      if (occ) {
        occ.amount += amount // duplicate line on the same invoice → one charge
      } else {
        g.byInvoice.set(inv.ignition_invoice_id, {
          date: inv.invoice_date,
          month: inv.invoice_date.slice(0, 7),
          amount,
          proposal:
            it.origin_type === "proposal" && typeof it.origin_identifier === "string"
              ? it.origin_identifier
              : null,
        })
      }
    }
  }

  // ── Decide cadence + recency per group ───────────────────────────────
  const lines: InvoiceRecurringLine[] = []
  for (const g of groups.values()) {
    const occurrences = Array.from(g.byInvoice.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    )
    if (occurrences.length === 0) continue

    const perMonth = new Map<string, number>()
    for (const o of occurrences) {
      perMonth.set(o.month, (perMonth.get(o.month) ?? 0) + 1)
    }
    // Weekly / ad-hoc guard: three or more invoices for the same line in
    // one month is not a monthly cadence. Firm policy excludes weekly.
    if (Math.max(...perMonth.values()) >= 3) continue

    const months = Array.from(perMonth.keys()).sort()
    const last = occurrences[occurrences.length - 1]
    const daysSinceLast = (now.getTime() - new Date(last.date).getTime()) / DAY_MS

    // Cadence hint from the accepted-proposal line backing this exact
    // billing line — the tiebreaker for ambiguous patterns and the only
    // signal for lines that have billed just once (new engagements).
    const hinted = occurrences
      .map((o) =>
        o.proposal
          ? proposalLineFreq.get(`${o.proposal}::${g.description.toLowerCase()}`)
          : undefined,
      )
      .find(Boolean)

    let cadence: "monthly" | "quarterly" | null = null
    if (months.length >= 2) {
      const gaps: number[] = []
      for (let i = 1; i < months.length; i++) {
        gaps.push(monthIndex(months[i]) - monthIndex(months[i - 1]))
      }
      const maxGap = Math.max(...gaps)
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
      if (Math.min(...gaps) === 1) {
        // Billed in consecutive months → monthly.
        cadence = "monthly"
      } else if (maxGap <= 4) {
        // 2–4 month gaps are ambiguous: a quarterly cycle billing a bit
        // early/late, or a monthly line that skipped a month (failed
        // payment, pause). Prefer the proposal's own cadence, then the
        // description ("Bookkeeping (Quarterly)"), then the average gap.
        cadence =
          hinted ??
          (/quarter/i.test(g.description)
            ? "quarterly"
            : avgGap >= 2.5
              ? "quarterly"
              : "monthly")
      }
    } else {
      cadence = hinted ?? null
    }
    if (!cadence) continue

    // Recency gate — churned engagements age out of the book instead of
    // being counted forever (the core failure of the proposal approach).
    if (cadence === "monthly" && daysSinceLast > 45) continue
    if (cadence === "quarterly" && daysSinceLast > 100) continue

    const periodAmount = last.amount
    const mrr = cadence === "monthly" ? periodAmount : periodAmount / 3
    const arr = cadence === "monthly" ? periodAmount * 12 : periodAmount * 4
    const proposalSlugs = Array.from(
      new Set(
        occurrences
          .map((o) => o.proposal)
          .filter((p): p is string => !!p),
      ),
    )

    lines.push({
      ignition_client_id: g.ignition_client_id,
      organization_id: g.organization_id,
      contact_id: g.contact_id,
      client_name: "", // hydrated below
      description: g.description,
      department: g.department,
      service_type: g.service_type,
      cadence,
      period_amount: round2(periodAmount),
      mrr: round2(mrr),
      arr: round2(arr),
      last_billed_on: last.date,
      months_billed: months.length,
      proposal_slugs: proposalSlugs,
    })
  }

  // ── Hydrate client display names ─────────────────────────────────────
  const igcIds = Array.from(
    new Set(
      lines
        .map((l) => l.ignition_client_id)
        .filter((id): id is string => !!id),
    ),
  )
  const nameByIgc = new Map<string, string>()
  if (igcIds.length) {
    const CHUNK = 300
    for (let i = 0; i < igcIds.length; i += CHUNK) {
      const { data } = await supabase
        .from("ignition_clients")
        .select("ignition_client_id, name, business_name")
        .in("ignition_client_id", igcIds.slice(i, i + CHUNK))
      for (const c of data ?? []) {
        nameByIgc.set(
          c.ignition_client_id,
          (c.business_name || c.name || "").trim(),
        )
      }
    }
  }
  for (const l of lines) {
    l.client_name =
      (l.ignition_client_id ? nameByIgc.get(l.ignition_client_id) : "") ||
      "Unknown Client"
  }

  // ── Totals ───────────────────────────────────────────────────────────
  const clientKeys = new Set(
    lines.map(
      (l) => l.ignition_client_id ?? l.organization_id ?? l.contact_id ?? l.client_name,
    ),
  )
  const totals = {
    mrr: round2(lines.reduce((s, l) => s + l.mrr, 0)),
    arr: round2(lines.reduce((s, l) => s + l.arr, 0)),
    distinct_clients: clientKeys.size,
    lines: lines.length,
  }

  return { lines, totals, windowStart: windowStartIso }
}
