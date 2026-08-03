/**
 * Backfill Karbon contact names.
 *
 * Heals contacts that were written from the Karbon `/Contacts` LIST endpoint
 * (which only returns `FullName`, never `FirstName`/`LastName`/`BusinessCards`)
 * and therefore landed in Supabase with NULL names — rendering as "Unknown" in
 * the Hub UI.
 *
 * For every contact that has a `karbon_contact_key` but NULL first_name AND
 * last_name, this re-fetches the full record from the single-contact endpoint
 * (`/Contacts/{key}?$expand=BusinessCards`) and re-upserts it through the
 * canonical mapper. The mapper now also falls back to parsing `FullName`, so
 * even a contact that only has a FullName in Karbon will get a name.
 *
 * Idempotent and safe to re-run. Read-only against Karbon; writes only the
 * affected `contacts` rows in Supabase.
 *
 * Usage:
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     -r tsx/cjs scripts/backfill-karbon-contact-names.ts          # live run
 *   ...same... -- --dry-run                                        # preview only
 */
import { createClient } from "@supabase/supabase-js"
import { getKarbonCredentials, karbonFetch } from "../lib/karbon-api"
import { mapKarbonContactToSupabase } from "../lib/karbon/mappers/contact"

const DRY_RUN = process.argv.includes("--dry-run")
// Karbon rate-limits aggressively (HTTP 429). Keep concurrency low and retry
// with backoff rather than hammering the API.
const CONCURRENCY = 3
const BATCH_DELAY_MS = 400
const MAX_RETRIES = 6

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function getDb() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error("Supabase service-role env vars not set")
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Fetch a single contact, retrying on Karbon 429 rate-limit responses with
 * exponential backoff. Returns the same shape as karbonFetch.
 */
async function fetchContactWithRetry(key: string, creds: Parameters<typeof karbonFetch>[1]) {
  let attempt = 0
  while (true) {
    const res = await karbonFetch<any>(`/Contacts/${key}?$expand=BusinessCards`, creds)
    const isRateLimited = res.error?.startsWith("429")
    if (!isRateLimited || attempt >= MAX_RETRIES) return res
    // Backoff: 2s, 4s, 6s, 8s … (Karbon usually asks for 6–7s)
    await sleep(2000 * (attempt + 1))
    attempt++
  }
}

async function main() {
  const db = getDb()
  const creds = getKarbonCredentials()
  if (!creds) throw new Error("Karbon API credentials not configured")

  // Page through every nameless-but-keyed contact.
  const targets: { id: string; karbon_contact_key: string }[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("contacts")
      .select("id, karbon_contact_key")
      .is("first_name", null)
      .is("last_name", null)
      .not("karbon_contact_key", "is", null)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    targets.push(...(data as any))
    if (data.length < pageSize) break
  }

  console.log(`[backfill] ${targets.length} nameless contacts with a Karbon key${DRY_RUN ? " (dry run)" : ""}`)
  if (!targets.length) return

  let fixed = 0
  let stillBlank = 0
  let notFound = 0
  let failed = 0

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const slice = targets.slice(i, i + CONCURRENCY)
    await Promise.all(
      slice.map(async (t) => {
        const { data, error } = await fetchContactWithRetry(t.karbon_contact_key, creds)
        if (error || !data) {
          notFound++
          return
        }
        const row = mapKarbonContactToSupabase(data)
        if (!row.first_name && !row.last_name) {
          // Karbon itself has no name for this record — nothing we can do.
          stillBlank++
          return
        }
        if (DRY_RUN) {
          fixed++
          return
        }
        const { error: upErr } = await db
          .from("contacts")
          .upsert(row, { onConflict: "karbon_contact_key", ignoreDuplicates: false })
        if (upErr) {
          failed++
          console.error(`[backfill] upsert failed for ${t.karbon_contact_key}: ${upErr.message}`)
          return
        }
        fixed++
      }),
    )
    if (i + CONCURRENCY < targets.length) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS))
    if ((i / CONCURRENCY) % 10 === 0) {
      console.log(`[backfill] processed ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}…`)
    }
  }

  console.log(
    `[backfill] done — ${fixed} ${DRY_RUN ? "would be fixed" : "fixed"}, ` +
      `${stillBlank} blank in Karbon, ${notFound} not found, ${failed} failed`,
  )
}

main().catch((e) => {
  console.error("[backfill] fatal:", e)
  process.exit(1)
})
