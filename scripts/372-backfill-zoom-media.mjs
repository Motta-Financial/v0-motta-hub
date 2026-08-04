/**
 * Historical Zoom media backfill driver.
 *
 * Walks month windows from newest to oldest, repeatedly POSTing the
 * account-wide sync endpoint with `includeMedia: true` until a window
 * reports `mediaCopied: 0` (= every video in that month is in Blob).
 * The endpoint is idempotent and persists per-recording, so 300s function
 * timeouts (504s) just mean "run it again" — no progress is lost.
 *
 * Usage:
 *   CRON_SECRET=... node scripts/372-backfill-zoom-media.mjs [monthsBack]
 *
 * CRON_SECRET falls back to .env.local. Default monthsBack = 24.
 * Safe to interrupt and re-run at any time.
 */

import { readFileSync } from "node:fs"

const BASE_URL = process.env.HUB_URL || "https://hub.motta.cpa"
const MAX_PASSES_PER_WINDOW = 60

function loadEnvLocal() {
  let text
  try {
    text = readFileSync(".env.local", "utf8")
  } catch {
    return
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}

/** [from, to] (inclusive, YYYY-MM-DD) for the month `back` months ago. */
function monthWindow(back) {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0))
  const fmt = (d) => d.toISOString().slice(0, 10)
  return [fmt(start), fmt(end)]
}

async function runPass(secret, from, to) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 320_000)
  try {
    const res = await fetch(`${BASE_URL}/api/zoom/recordings/sync-account`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, includeMedia: true, tagParticipants: false }),
    })
    // 5xx = function timed out or crashed mid-run (e.g. OOM on one huge
    // file). Progress persists per-recording, so another pass resumes where
    // it left off — treat like a timeout, not a fatal error.
    if (!res.ok) return { timeout: res.status >= 500, error: `http_${res.status}` }
    return await res.json()
  } catch (err) {
    // Abort/network drop while the function keeps running server-side —
    // treat like a timeout and take another pass.
    return { timeout: true, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  loadEnvLocal()
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("CRON_SECRET is not set (env or .env.local)")
    process.exit(1)
  }

  const monthsBack = Math.max(1, Number(process.argv[2]) || 24)
  let totalMedia = 0

  for (let back = 0; back < monthsBack; back++) {
    const [from, to] = monthWindow(back)
    let windowMedia = 0

    let consecutiveRetries = 0
    for (let pass = 1; pass <= MAX_PASSES_PER_WINDOW; pass++) {
      const t0 = Date.now()
      const r = await runPass(secret, from, to)
      const secs = Math.round((Date.now() - t0) / 1000)

      if (r.timeout) {
        consecutiveRetries++
        if (consecutiveRetries >= 10) {
          console.error(`${from}: ${consecutiveRetries} retries without a completed pass — giving up on this window, continuing`)
          break
        }
        console.log(`${from}: pass ${pass} retryable (${r.error ?? "timeout"}) after ${secs}s (progress kept) — re-running`)
        await new Promise((res) => setTimeout(res, 15_000))
        continue
      }
      consecutiveRetries = 0
      if (r.error || r.ok === false) {
        console.error(`${from}: pass ${pass} FAILED (${r.error ?? "unknown"}) — stopping`)
        process.exit(1)
      }

      const copied = r.mediaCopied ?? 0
      windowMedia += copied
      totalMedia += copied
      console.log(
        `${from}: pass ${pass} → recs=${r.recordingsUpserted} media=${copied} errors=${r.errors?.length ?? 0} (${secs}s)`,
      )

      if ((r.errors?.length ?? 0) > 0) console.error(`  errors: ${r.errors.join("; ")}`)
      if (copied === 0) break
    }

    console.log(`${from}: DONE (${windowMedia} media files this month, ${totalMedia} total)\n`)
  }

  console.log(`Backfill complete: ${totalMedia} media files copied to Blob.`)
}

main()
