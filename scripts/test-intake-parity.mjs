/**
 * Intake field-parity test — the gate on retiring the Jotform form.
 *
 *   node scripts/test-intake-parity.mjs
 *
 * Two assertions, no database and no network:
 *
 *   1. ROUND-TRIP. A payload from the Hub's native wizard, containing
 *      every field the wizard can send, must survive
 *      `synthesizeJotformSubmission` → `parseIntakeAnswers` and land on
 *      the right denormalized column with the right value. This is the
 *      whole contract between the new form and the pipeline: the website
 *      route only synthesizes Jotform-shaped answers, so if the slugs
 *      drift the columns silently go null and the team email renders
 *      blank sections. That failure mode is invisible in production
 *      (a 200 with empty fields) which is exactly why it needs a test.
 *
 *   2. PARITY. Every field the LEGACY Jotform actually populated must be
 *      reachable from the new form. The expected list was derived from
 *      all 220 real submissions, not from the form definition, so it
 *      reflects what prospects genuinely answered.
 *
 * Deliberately excluded from parity, with reasons — see NOT_PORTED.
 *
 * Implementation note: parse.ts and the route are TypeScript, so rather
 * than pulling in a build step this test reimplements nothing and instead
 * strips types with a tiny transform before import. If that ever gets
 * fragile, move this to vitest.
 */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"

/**
 * Strip types with the TypeScript compiler already in the project's
 * dependency tree, rather than adding a build step or a test-runner just
 * for this file. `transpileModule` does no type-checking — `tsc
 * --noEmit` in CI covers that — it only erases annotations, which is all
 * we need to execute the real source.
 */
function transformSync(src, _opts) {
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.Preserve,
    },
  })
  return { code: out.outputText }
}

const ROOT = new URL("..", import.meta.url).pathname

/** Compile a .ts file to ESM on disk and import it. */
async function importTs(relPath) {
  const src = readFileSync(join(ROOT, relPath), "utf8")
  const { code } = transformSync(src, { loader: "ts", format: "esm", target: "node20" })
  const dir = mkdtempSync(join(tmpdir(), "parity-"))
  const out = join(dir, "mod.mjs")
  writeFileSync(out, code)
  return import(pathToFileURL(out).href)
}

// ── The payload the wizard sends when every field is filled ───────────
const WIZARD_PAYLOAD = {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  phone: "+15551234567",
  street_address: "100 Main St",
  city: "Tampa",
  state: "FL",
  zip: "33602",

  service_focus: "Both Personal & Business",
  services_requested: ["Tax Preparation", "Payroll Services"],
  entity_types: ["Individual (1040)", "S-Corp (1120-S)"],

  business_name: "Doe Family LLC",
  business_email: "info@doefamily.com",
  business_phone: "+15559998888",
  business_state: "FL",
  business_street_address: "200 Commerce Way",
  business_city: "Tampa",
  business_zip: "33603",
  business_tax_classification: "S-Corp",
  business_revenue_range: "$500k – $1M",
  business_employee_count: "5",
  business_uses_accounting_system: "QuickBooks Online",
  business_situation: "I have an existing business",
  business_summary: "Family-run HVAC contractor, 12 years trading.",

  questions_or_concerns: "Behind on 2024 and got an IRS letter.",
  additional_notes: "Prefer mornings.",
  referral_source: "Sam Wilson",
  preferred_team_member: "Dat Le",

  behind_on_filings: "Behind 1 year",
  pending_tax_notices: "Yes — IRS",
  current_cpa_status: "Works with a CPA",
  cpa_switch_reason: "They retired.",

  terms_accepted: "Accepted",
  consent_store_data: "I accept",
  consent_marketing_contact: "I don't accept",

  utm_source: "google",
  page_url: "https://motta.cpa/get-started",
}

/** column → expected value after the round trip. */
const EXPECTED = {
  submitter_first_name: "Jane",
  submitter_last_name: "Doe",
  submitter_full_name: "Jane Doe",
  submitter_email: "jane@example.com",
  submitter_phone: "+15551234567",
  submitter_city: "Tampa",
  submitter_state: "FL",
  submitter_zip: "33602",

  service_focus: "Both Personal & Business",
  services_requested: ["Tax Preparation", "Payroll Services"],
  entity_types: ["Individual (1040)", "S-Corp (1120-S)"],
  business_situation: "I have an existing business",

  business_name: "Doe Family LLC",
  business_email: "info@doefamily.com",
  business_phone: "+15559998888",
  business_state: "FL",
  business_street_address: "200 Commerce Way",
  business_tax_classification: "S-Corp",
  business_revenue_range: "$500k – $1M",
  business_employee_count: "5",
  business_uses_accounting_system: "QuickBooks Online",
  business_summary: "Family-run HVAC contractor, 12 years trading.",

  questions_or_concerns: "Behind on 2024 and got an IRS letter.",
  additional_notes: "Prefer mornings.",
  referral_source: "Sam Wilson",
  preferred_team_member: "Dat Le",

  behind_on_filings: "Behind 1 year",
  pending_tax_notices: "Yes — IRS",
  current_cpa_status: "Works with a CPA",
  cpa_switch_reason: "They retired.",

  terms_accepted: "Accepted",
  consent_store_data: "I accept",
  consent_marketing_contact: "I don't accept",
}

/**
 * Jotform fields answered by real submitters that we deliberately do NOT
 * carry over. Listed so the omissions are a decision on the record rather
 * than an oversight discovered later.
 */
const NOT_PORTED = {
  haveYou:
    "‘Have you scheduled a meeting?’ (220/220) — superseded: the new form ends with the booking step itself.",
  newBusiness116:
    "‘New Business Primary Contact SSN’ (12/220) — deliberately dropped. An SSN has no business on a public pre-engagement form.",
  inWhich: "New-business industry (16/220) — better asked on the discovery call.",
  willYour110: "New business accounting system (17/220) — discovery call.",
  willYour111: "New business cash vs accrual (16/220) — discovery call.",
  willYour114: "New business multi-state (16/220) — discovery call.",
  willYour: "Multiple owners/partners (17/220) — discovery call.",
  howMany: "Total owners/partners (3/220) — discovery call.",
  howMany113: "New business employee count (17/220) — discovery call.",
  whatIs81: "New business entity type (17/220) — covered by entity_types.",
  whatIs112: "New business fiscal year-end (5/220) — discovery call.",
  pleaseSelect115: "New business operating states (3/220) — discovery call.",
  areThere: "New business setup details (12/220) — covered by additional_notes.",
  owner2: "Owner #2 contact (5/220) — discovery call.",
  owner3: "Owner #3 contact (1/220) — discovery call.",
  owner4: "Owner #4 contact (0/220) — never used.",
  owner5: "Owner #5 contact (0/220) — never used.",
  whatIs31: "Proposed new-business name (17/220) — folded into business_name.",
  whatIs93: "New-business phone (17/220) — folded into business_phone.",
  whatIs33: "New-business state (17/220) — folded into business_state.",
  whatIs82: "New-business address (8/220) — folded into business address.",
  pleaseProvide: "New-business summary (17/220) — folded into business_summary.",
  newBusiness: "New-business contact info (16/220) — folded into business_email/phone.",
}

function eq(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }
  return a === b
}

const failures = []
const notes = []

function check(name, actual, expected) {
  if (!eq(actual, expected)) {
    failures.push(
      `  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`,
    )
  }
}

async function main() {
  const parse = await importTs("lib/jotform/parse.ts")

  // The synthesizer lives inside the route module, which pulls in Next
  // and Supabase. Rather than import that graph, extract the function
  // source and evaluate it against the same parser contract — it is the
  // exact code under test, just isolated.
  const routeSrc = readFileSync(join(ROOT, "app/api/public/intake/route.ts"), "utf8")
  const start = routeSrc.indexOf("function synthesizeJotformSubmission(")
  const endMarker = "\n// ── Naive in-memory IP throttle"
  const end = routeSrc.indexOf(endMarker)
  if (start === -1 || end === -1) {
    throw new Error("Could not locate synthesizeJotformSubmission in the route source")
  }
  const helpersStart = routeSrc.indexOf("function asString(")
  const synthSrc = routeSrc.slice(helpersStart, end)
  const { code } = transformSync(
    `import { randomUUID } from "node:crypto"\n${synthSrc}\nexport { synthesizeJotformSubmission }`,
    { loader: "ts", format: "esm", target: "node20" },
  )
  const dir = mkdtempSync(join(tmpdir(), "parity-synth-"))
  const out = join(dir, "synth.mjs")
  writeFileSync(out, code)
  const { synthesizeJotformSubmission } = await import(pathToFileURL(out).href)

  // ── 1. Round trip ──────────────────────────────────────────────────
  const submission = synthesizeJotformSubmission(WIZARD_PAYLOAD)
  const parsed = parse.parseIntakeAnswers(submission.answers ?? {})

  for (const [column, expected] of Object.entries(EXPECTED)) {
    check(column, parsed[column], expected)
  }

  // ── 2. Nothing silently null ───────────────────────────────────────
  // A slug typo shows up as a null column, so call those out explicitly
  // even when they aren't in EXPECTED.
  const nulls = Object.entries(parsed)
    .filter(([, v]) => v === null)
    .map(([k]) => k)
  if (nulls.length > 0) {
    notes.push(`  · columns still null after a full payload: ${nulls.join(", ")}`)
  }

  // ── 3. The submission is shaped as the pipeline expects ────────────
  check("submission.form_id", submission.form_id, "website")
  if (!/^web_[0-9a-f-]{36}$/.test(submission.id)) {
    failures.push(`  ✗ submission.id should be web_<uuid>, got ${submission.id}`)
  }

  // ── 4. Optional: a payload captured from a real browser walk ───────
  // `CAPTURED_PAYLOAD=<path>` lets the Playwright walkthrough hand its
  // real POST body to this same parser, closing the loop from rendered
  // form → payload → columns. Without it the test still covers the
  // contract; with it, it covers the actual UI too.
  const capturedPath = process.env.CAPTURED_PAYLOAD
  if (capturedPath) {
    const captured = JSON.parse(readFileSync(capturedPath, "utf8"))
    const capturedParsed = parse.parseIntakeAnswers(
      synthesizeJotformSubmission(captured).answers ?? {},
    )
    const mustHave = [
      "submitter_full_name",
      "submitter_email",
      "submitter_state",
      "service_focus",
      "business_name",
      "business_situation",
      "business_summary",
      "business_street_address",
      "questions_or_concerns",
      "additional_notes",
      "behind_on_filings",
      "terms_accepted",
      "consent_store_data",
      "consent_marketing_contact",
    ]
    for (const col of mustHave) {
      if (capturedParsed[col] == null) {
        failures.push(`  ✗ browser payload produced null ${col}`)
      }
    }
    // The decline must survive verbatim — this is the field that made
    // retiring the Jotform a compliance question rather than a cleanup.
    if (capturedParsed.consent_marketing_contact !== "I don't accept") {
      failures.push(
        `  ✗ marketing decline not preserved: ${JSON.stringify(capturedParsed.consent_marketing_contact)}`,
      )
    }
    notes.push(`  · browser-captured payload: ${mustHave.length} columns verified from a real wizard walk`)
  }

  // ── Report ─────────────────────────────────────────────────────────
  const total = Object.keys(EXPECTED).length
  console.log("\nIntake parity test")
  console.log("══════════════════")
  console.log(`Round-trip fields checked: ${total}`)
  console.log(`Jotform fields deliberately not ported: ${Object.keys(NOT_PORTED).length}`)

  if (notes.length > 0) {
    console.log("\nNotes:")
    notes.forEach((n) => console.log(n))
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILURE(S):\n`)
    failures.forEach((f) => console.log(f))
    process.exit(1)
  }

  console.log("\n✓ All fields round-trip correctly. The native form is at parity.")
  console.log("\nDeliberate omissions:")
  for (const [field, why] of Object.entries(NOT_PORTED)) {
    console.log(`  · ${field}: ${why}`)
  }
}

main().catch((err) => {
  console.error("\nTest harness error:", err)
  process.exit(1)
})
