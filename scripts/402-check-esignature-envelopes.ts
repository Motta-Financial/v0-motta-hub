/**
 * 402-check-esignature-envelopes.ts
 *
 * Settle the last open "present-but-empty" question in the ProConnect
 * integration: is `esignature.envelopes[]` genuinely never populated, or is
 * it — like `taxFiling.filings[]` was — empty only on the LIST endpoint and
 * populated on the single-engagement GET?
 *
 * Why this matters. We recorded `filings[]` as an Intuit data gap on the
 * strength of "the key is present on all 908 engagements and empty on every
 * one." That inference was wrong: the bulk list returns `filings: []`
 * always, while GET /v2/engagements/{id} returns the real thing. Attributing
 * it to Intuit cost months. `esignature.envelopes[]` is the one remaining
 * item resting on exactly the same inference, and nothing has re-tested it
 * against the single GET. See docs/proconnect-api-coverage-status.md §2.
 *
 * READ-ONLY. Issues GETs only — never writes to a return, never imports.
 *
 * Usage (repo root; needs .env.local from the mottahub project —
 * `vercel env pull .env.local`):
 *   npx tsx scripts/402-check-esignature-envelopes.ts
 *   npx tsx scripts/402-check-esignature-envelopes.ts --limit 25
 *
 * It samples engagements most likely to have been e-signed (most recently
 * modified first), calls the single-engagement GET on each, and reports how
 * many carry a non-empty envelopes[].
 *
 * Reading the result:
 *   - ANY engagement with envelopes.length > 0  → not an Intuit gap. The
 *     data is there; hydrate it the way efile status is hydrated
 *     (lib/proconnect/sync.ts hydrateEngagementEfile) and the UI can show
 *     e-signature status. Update the coverage doc §2 row.
 *   - ZERO across a decent sample → the inference holds for the single GET
 *     too, which is a real question for Intuit rather than an assumption.
 *     Quote this sample size when asking.
 */
import { existsSync, readFileSync } from "node:fs"

function loadEnv() {
  const path = `${process.cwd()}/.env.local`
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=")
    if (eq < 1 || line.startsWith("#")) continue
    const key = line.slice(0, eq)
    let v = line.slice(eq + 1)
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    if (!(key in process.env)) process.env[key] = v
  }
}

/**
 * ProConnect client creds pull as "[SENSITIVE]" locally, so this script
 * cannot refresh the OAuth token itself. POST the production sync first —
 * it refreshes and stores the token server-side — then ride the fresh
 * DB-stored access token. Same approach as scripts/376.
 */
async function refreshTokenServerSide() {
  if (!process.env.CRON_SECRET) {
    console.warn("CRON_SECRET not set — assuming the DB token is already fresh")
    return
  }
  const res = await fetch("https://hub.motta.cpa/api/proconnect/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  console.log(`token refresh via prod sync: ${res.status}`)
}

async function main() {
  loadEnv()
  const limitArg = process.argv.indexOf("--limit")
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 15

  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // Most recently modified first: an e-signature envelope, if it exists at
  // all, is likeliest on returns that have moved recently.
  const { data: engagements, error } = await sb
    .from("proconnect_engagements")
    .select("engagement_id, tax_year, form_type, proconnect_modified_at")
    .order("proconnect_modified_at", { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  if (!engagements?.length) {
    console.error("no engagements found")
    process.exit(1)
  }

  await refreshTokenServerSide()

  const { fetchEngagement } = await import("../lib/proconnect/client")

  let withEnvelopes = 0
  let keyPresent = 0
  let failed = 0

  for (const eng of engagements) {
    const res = await fetchEngagement(eng.engagement_id)
    if (!res.ok || !res.data) {
      failed++
      console.log(`${eng.engagement_id}  HTTP ${res.status}  ${res.error ?? ""}`)
      continue
    }
    const esig = (res.data as Record<string, unknown>).esignature as
      | { envelopes?: unknown[] }
      | undefined
    if (esig !== undefined) keyPresent++
    const envelopes = esig?.envelopes ?? []
    if (envelopes.length > 0) {
      withEnvelopes++
      // Shape only — never the signer PII inside an envelope.
      console.log(
        `${eng.engagement_id}  ${eng.form_type} ${eng.tax_year}  ` +
          `envelopes=${envelopes.length}  keys=${Object.keys(
            (envelopes[0] ?? {}) as Record<string, unknown>,
          ).join(",")}`,
      )
    } else {
      console.log(
        `${eng.engagement_id}  ${eng.form_type} ${eng.tax_year}  ` +
          `envelopes=0  esignatureKeyPresent=${esig !== undefined}`,
      )
    }
  }

  console.log("\n─── result ───")
  console.log(`sampled            ${engagements.length}`)
  console.log(`fetch failures     ${failed}`)
  console.log(`esignature key     ${keyPresent}`)
  console.log(`non-empty envelopes ${withEnvelopes}`)
  console.log(
    withEnvelopes > 0
      ? "\n→ NOT an Intuit gap. The single GET carries envelopes; the list endpoint\n" +
          "  simply doesn't — same shape as the taxFiling.filings[] correction.\n" +
          "  Hydrate it like efile status and update coverage-status §2."
      : "\n→ Empty on the single GET too, across this sample. That makes it a real\n" +
          "  question for Intuit rather than an assumption — quote the sample size.",
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
