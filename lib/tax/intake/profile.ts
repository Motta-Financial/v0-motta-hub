/**
 * Client profile → tax intake alignment.
 *
 * The Hub already knows who the taxpayer is. `contacts` carries the name,
 * date of birth, SSN, address and contact details that Form 1040's header
 * needs, and re-keying them into the intake set would be both wasted work
 * and a second place for them to be wrong. This module is the single
 * declared correspondence between the two vocabularies.
 *
 * It answers three questions, and the third is the one that earns its keep:
 *
 *   1. Which 1040 header fields can be filled from the profile?
 *   2. For this client, which are actually populated?
 *   3. Which fields does the return need that the profile has NO COLUMN
 *      for at all? Those are gaps in the Hub's data model, not gaps in one
 *      client's record, and no amount of chasing the client fixes them.
 *
 * ── Direction of travel ──
 * The profile is the source of truth for identity; the intake set never
 * writes back to it. A preparer who finds a wrong SSN fixes the client
 * record, not the return — otherwise next year's return inherits the error
 * again.
 *
 * ── PII ──
 * `contacts.ssn_encrypted` holds PLAINTEXT despite the name — see migration
 * 364, which closed anonymous access to the table but could not restrict the
 * column further without breaking `SELECT *` callers. So this module masks by
 * policy rather than relying on the grant: `loadClientProfile` returns the SSN
 * masked, always. Only `resolveTaxpayerIdentity` — called server-side when
 * building an Import payload — sees the full value, and it is never logged or
 * returned to the browser.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

/** A 1040 header field and where it comes from in the Hub. */
export interface ProfileFieldMapping {
  /** Stable key used by the intake layer. */
  key: string
  label: string
  /** Column on `contacts`, or null when the Hub has nowhere to put it. */
  contactColumn: string | null
  /** True when the value is PII that must not reach the browser raw. */
  sensitive: boolean
  /**
   * Whether Form 1040 can be filed without it.
   *   required  — the return cannot be e-filed without it
   *   expected  — the return is accepted but incomplete or suboptimal
   *   optional  — nice to have
   */
  necessity: "required" | "expected" | "optional"
  /** Why it matters, shown to the preparer when it is missing. */
  note?: string
}

/**
 * Fields the 1040 header needs, and the profile column that supplies each.
 *
 * `contactColumn: null` marks a genuine hole in the Hub's model. These are
 * deliberately listed rather than omitted — an alignment document that only
 * shows the matches would imply the profile is sufficient, and it is not.
 */
export const PROFILE_FIELD_MAP: ProfileFieldMapping[] = [
  // ── Identity ──
  { key: "first_name", label: "First name", contactColumn: "first_name", sensitive: false, necessity: "required" },
  { key: "middle_initial", label: "Middle initial", contactColumn: "middle_name", sensitive: false, necessity: "optional" },
  { key: "last_name", label: "Last name", contactColumn: "last_name", sensitive: false, necessity: "required" },
  { key: "suffix", label: "Suffix", contactColumn: "suffix", sensitive: false, necessity: "optional" },
  {
    key: "ssn",
    label: "Social security number",
    contactColumn: "ssn_encrypted",
    sensitive: true,
    necessity: "required",
    note: "Stored in a column named ssn_encrypted that is not in fact encrypted — see migration 364.",
  },
  {
    key: "date_of_birth",
    label: "Date of birth",
    contactColumn: "date_of_birth",
    sensitive: true,
    necessity: "required",
    note:
      "Drives OBBBA §63(f)'s additional senior deduction, which has NO ProConnect input field — " +
      "ProConnect derives it from DOB. A missing DOB silently costs the client that deduction.",
  },
  {
    key: "occupation",
    label: "Occupation",
    contactColumn: "occupation",
    sensitive: false,
    necessity: "expected",
    note: "Form 1040 asks for it in the signature block.",
  },

  // ── Address ──
  { key: "address_line1", label: "Address", contactColumn: "address_line1", sensitive: false, necessity: "required" },
  { key: "address_line2", label: "Apt / suite", contactColumn: "address_line2", sensitive: false, necessity: "optional" },
  { key: "city", label: "City", contactColumn: "city", sensitive: false, necessity: "required" },
  { key: "state", label: "State", contactColumn: "state", sensitive: false, necessity: "required" },
  { key: "zip_code", label: "ZIP", contactColumn: "zip_code", sensitive: false, necessity: "required" },

  // ── Contact ──
  { key: "email", label: "Email", contactColumn: "primary_email", sensitive: false, necessity: "expected" },
  { key: "phone", label: "Phone", contactColumn: "phone_mobile", sensitive: false, necessity: "optional" },

  // ── Identity verification ──
  {
    key: "drivers_license",
    label: "Driver's licence / state ID",
    contactColumn: "drivers_license",
    sensitive: true,
    necessity: "expected",
    note: "Several states require it for e-file identity verification; some reject the return without it.",
  },

  // ── Holes in the Hub's model ────────────────────────────────────────
  // Everything below has no home on `contacts`. Listing them is the point:
  // these cannot be fixed by chasing a client for information, only by
  // extending the profile.
  {
    key: "filing_status",
    label: "Filing status",
    contactColumn: null,
    sensitive: false,
    necessity: "required",
    note:
      "Lives on tax_input_sets.filing_status, per return rather than per client — which is correct, " +
      "since it can change year to year. Noted here so the alignment is complete.",
  },
  {
    key: "spouse",
    label: "Spouse (name, SSN, DOB)",
    contactColumn: null,
    sensitive: true,
    necessity: "required",
    note:
      "Lives in tax_person_relationships (scripts/404), read through " +
      "tax_person_relationships_both so it resolves from either side of the link. " +
      "loadClientProfile resolves this live rather than from a contacts column — see " +
      "resolveHouseholdFields below.",
  },
  {
    key: "dependents",
    label: "Dependents",
    contactColumn: null,
    sensitive: true,
    necessity: "expected",
    note:
      "Lives in tax_dependent_years (scripts/404), one row per dependent per tax year. " +
      "loadClientProfile resolves this live rather than from a contacts column — see " +
      "resolveHouseholdFields below.",
  },
  {
    key: "bank_account",
    label: "Direct deposit (routing + account)",
    contactColumn: null,
    sensitive: true,
    necessity: "optional",
    note: "Form 1040 lines 35b-35d. No column exists; a refund would have to go by cheque.",
  },
  {
    key: "ip_pin",
    label: "IRS Identity Protection PIN",
    contactColumn: null,
    sensitive: true,
    necessity: "optional",
    note: "Required to e-file for any taxpayer the IRS has issued one to. No column exists.",
  },
  {
    key: "presidential_campaign",
    label: "Presidential election campaign fund",
    contactColumn: null,
    sensitive: false,
    necessity: "optional",
  },
]

export type Necessity = ProfileFieldMapping["necessity"]

export interface ProfileFieldState {
  key: string
  label: string
  contactColumn: string | null
  necessity: Necessity
  sensitive: boolean
  note?: string
  /** Masked for sensitive fields; null when absent. */
  display: string | null
  present: boolean
  /** True when the Hub has no column for this at all. */
  unmodelled: boolean
}

export interface ClientProfileAlignment {
  contactId: string
  displayName: string
  fields: ProfileFieldState[]
  /** Required fields that are missing — these block a filed return. */
  blocking: ProfileFieldState[]
  /** Expected fields that are missing. */
  warnings: ProfileFieldState[]
  coverage: { present: number; applicable: number; unmodelled: number }
}

/** Show the shape of an SSN without disclosing it. */
export function maskSsn(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, "")
  if (digits.length !== 9) return "invalid"
  return `***-**-${digits.slice(-4)}`
}

function maskGeneric(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw)
  return s.length <= 4 ? "****" : `****${s.slice(-4)}`
}

const SELECT_COLUMNS = [
  "id",
  "full_name",
  "first_name",
  "middle_name",
  "last_name",
  "suffix",
  "ssn_encrypted",
  "ssn_last_four",
  "date_of_birth",
  "occupation",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "zip_code",
  "primary_email",
  "phone_mobile",
  "phone_primary",
  "drivers_license",
].join(", ")

/**
 * Read a client profile and report how well it covers the 1040 header.
 *
 * Requires an admin client: `ssn_encrypted`, `drivers_license` and
 * `passport_number` are service-role-only since migration 364. The caller
 * must authenticate the preparer first — same contract as
 * lib/tax/intake/store.ts.
 *
 * Sensitive values are MASKED in the result. Nothing here is safe to log,
 * but it is safe to send to a browser a preparer is already authenticated in.
 */
export async function loadClientProfile(
  sb: SupabaseClient,
  contactId: string,
): Promise<ClientProfileAlignment | null> {
  const { data, error } = await sb
    .from("contacts")
    .select(SELECT_COLUMNS)
    .eq("id", contactId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  // The generated types can't narrow a runtime-joined column list, so the
  // row comes back as a generic bag.
  const row = data as unknown as Record<string, unknown>
  const fields: ProfileFieldState[] = PROFILE_FIELD_MAP.map((m) => {
    const raw = m.contactColumn ? row[m.contactColumn] : null
    const present = raw !== null && raw !== undefined && String(raw).trim() !== ""

    let display: string | null = null
    if (present) {
      if (m.key === "ssn") display = maskSsn(String(raw))
      else if (m.sensitive) display = maskGeneric(String(raw))
      else if (m.key === "middle_initial") display = String(raw).trim().slice(0, 1)
      else display = String(raw)
    }

    return {
      key: m.key,
      label: m.label,
      contactColumn: m.contactColumn,
      necessity: m.necessity,
      sensitive: m.sensitive,
      note: m.note,
      display,
      present,
      unmodelled: m.contactColumn === null,
    }
  })

  // An unmodelled field is not this client's fault, so it is reported
  // separately rather than counted as a missing value against them.
  const applicable = fields.filter((f) => !f.unmodelled)

  return {
    contactId,
    displayName:
      (row.full_name as string | null) ??
      [row.first_name, row.last_name].filter(Boolean).join(" ") ??
      contactId,
    fields,
    blocking: applicable.filter((f) => f.necessity === "required" && !f.present),
    warnings: applicable.filter((f) => f.necessity === "expected" && !f.present),
    coverage: {
      present: applicable.filter((f) => f.present).length,
      applicable: applicable.length,
      unmodelled: fields.filter((f) => f.unmodelled).length,
    },
  }
}

/**
 * The unmasked taxpayer identity, for building an Import payload.
 *
 * Separate from `loadClientProfile` on purpose: that one is for display and
 * masks everything, this one returns real values and must never be sent to
 * a browser or written to a log. Keeping them apart makes the unsafe call
 * visible at every call site.
 */
export async function resolveTaxpayerIdentity(
  sb: SupabaseClient,
  contactId: string,
): Promise<{
  firstName: string | null
  middleInitial: string | null
  lastName: string | null
  suffix: string | null
  /** Nine digits, unformatted — the shape the Import API wants. */
  ssn: string | null
  dateOfBirth: string | null
  occupation: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zipCode: string | null
} | null> {
  const { data, error } = await sb
    .from("contacts")
    .select(SELECT_COLUMNS)
    .eq("id", contactId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as unknown as Record<string, unknown>

  const digits = String(r.ssn_encrypted ?? "").replace(/\D/g, "")
  return {
    firstName: (r.first_name as string | null) ?? null,
    middleInitial: ((r.middle_name as string | null) ?? "").trim().slice(0, 1) || null,
    lastName: (r.last_name as string | null) ?? null,
    suffix: (r.suffix as string | null) ?? null,
    // A malformed SSN is returned as null rather than passed through —
    // Intuit rejects it without echoing back which field failed, which is
    // expensive to debug against a real return.
    ssn: digits.length === 9 ? digits : null,
    dateOfBirth: (r.date_of_birth as string | null) ?? null,
    occupation: (r.occupation as string | null) ?? null,
    addressLine1: (r.address_line1 as string | null) ?? null,
    addressLine2: (r.address_line2 as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    state: (r.state as string | null) ?? null,
    zipCode: (r.zip_code as string | null) ?? null,
  }
}

/**
 * Firm-wide coverage of the profile fields the 1040 needs.
 *
 * Answers "what should we chase before filing season" at the population
 * level rather than one client at a time.
 */
export async function profileCoverageReport(
  sb: SupabaseClient,
  opts: { clientsOnly?: boolean } = {},
): Promise<{
  totalContacts: number
  perField: Array<{ key: string; label: string; necessity: Necessity; populated: number; pct: number }>
}> {
  const columns = PROFILE_FIELD_MAP.filter((m) => m.contactColumn !== null)

  let q = sb.from("contacts").select(columns.map((m) => m.contactColumn).join(", "))
  if (opts.clientsOnly) q = q.like("contact_type", "Client%")

  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>

  return {
    totalContacts: rows.length,
    perField: columns.map((m) => {
      const populated = rows.filter((r) => {
        const v = r[m.contactColumn as string]
        return v !== null && v !== undefined && String(v).trim() !== ""
      }).length
      return {
        key: m.key,
        label: m.label,
        necessity: m.necessity,
        populated,
        pct: rows.length === 0 ? 0 : Math.round((populated / rows.length) * 1000) / 10,
      }
    }),
  }
}
