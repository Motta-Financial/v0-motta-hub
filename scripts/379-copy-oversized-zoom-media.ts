/**
 * Copy Zoom recordings to Blob from a local machine, largest first.
 *
 * The serverless path (`POST /api/zoom/recordings/sync-account`) caps at
 * 3009 MB and multipart streaming does not hold under multi-GB recordings: a
 * 4 GB MP4 OOM-kills the function on every pass, so the account sync can never
 * drain those files no matter how low `maxMediaCopies` goes. Worse, it retries
 * them each sweep, so one oversized recording can block every smaller file
 * behind it in the same month — that is how Feb and Jun 2026 stalled out at 10
 * consecutive failures and got abandoned by the backfill driver.
 *
 * This does the same work with no memory ceiling and no 300s clock: stream
 * Zoom → Blob directly, then write the blob link back onto the recording's
 * `recording_files` entry exactly as the ingest worker would.
 *
 * It also reaches files the account sync structurally cannot. The sync walks
 * each active Zoom user and lists their recordings; a row whose `host_email`
 * is null belongs to no user's listing, so the sync never sees it. This script
 * works straight from the stored `download_url`, so host attribution is
 * irrelevant.
 *
 * Usage:
 *   npx tsx scripts/379-copy-oversized-zoom-media.ts [minMB=500] [limit=20]
 *
 *   minMB 0 takes everything still unarchived, smallest included.
 *
 * Idempotent — files that already carry a blob_url are skipped, so it is safe
 * to re-run and safe to run after the backfill driver has swept a window.
 * Wrap long runs in `caffeinate -is`; these transfers take a while and they
 * stall when the Mac sleeps.
 */

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { put } from "@vercel/blob"

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  if (process.env[m[1]] === undefined) process.env[m[1]] = v
}

import { getS2SAccessToken } from "../lib/zoom/s2s-auth"

interface ZoomFile {
  id?: string
  file_type?: string
  file_extension?: string
  recording_type?: string
  download_url?: string
  file_size?: number
  blob_url?: string
  blob_pathname?: string
}

const MEDIA = new Set(["MP4", "M4A"])

/** Same path shape the ingest worker uses — base64 UUIDs can contain "/". */
function blobSafeUuid(uuid: string): string {
  return uuid.replace(/\//g, "_")
}

function extFor(file: ZoomFile): string {
  return (
    String(file.file_extension || file.file_type || "bin")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin"
  )
}

function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(0)} MB`
}

async function main() {
  const minMB = Number(process.argv[2]) || 0
  const limit = Number(process.argv[3]) || 20

  const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const blobToken = process.env.ZOOM_BLOB_READ_WRITE_TOKEN
  if (!blobToken) {
    throw new Error("ZOOM_BLOB_READ_WRITE_TOKEN not set — run `vercel env pull .env.local`")
  }

  type Target = { rowId: string; uuid: string; topic: string; start: string; file: ZoomFile }
  const targets: Target[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("zoom_recordings")
      .select("id, zoom_uuid, topic, start_time, recording_files")
      .order("id")
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      for (const f of ((r.recording_files as ZoomFile[]) ?? [])) {
        if (!MEDIA.has(String(f.file_type || "").toUpperCase())) continue
        if (f.blob_url || f.blob_pathname) continue
        if ((f.file_size ?? 0) < minMB * 1e6) continue
        targets.push({
          rowId: r.id,
          uuid: r.zoom_uuid,
          topic: String(r.topic || "").slice(0, 40),
          start: String(r.start_time).slice(0, 10),
          file: f,
        })
      }
    }
    if (!data || data.length < 1000) break
  }

  targets.sort((a, b) => (b.file.file_size ?? 0) - (a.file.file_size ?? 0))
  const work = targets.slice(0, limit)
  const totalGB = work.reduce((s, t) => s + (t.file.file_size ?? 0), 0) / 1e9
  console.log(
    `${targets.length} unarchived file(s) >= ${minMB} MB; copying ${work.length} (${totalGB.toFixed(1)} GB)\n`,
  )
  if (!work.length) return

  const token = await getS2SAccessToken()
  let done = 0
  let failed = 0

  for (const t of work) {
    const size = t.file.file_size ?? 0
    console.log(`→ ${mb(size).padStart(8)}  ${t.start}  ${t.topic}`)
    try {
      if (!t.file.download_url) throw new Error("no download_url")

      let res = await fetch(t.file.download_url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        // Some Zoom endpoints only accept the token as a query param.
        const sep = t.file.download_url.includes("?") ? "&" : "?"
        res = await fetch(`${t.file.download_url}${sep}access_token=${encodeURIComponent(token)}`)
      }
      if (!res.ok || !res.body) throw new Error(`zoom http ${res.status}`)

      const pathname = `zoom/${blobSafeUuid(t.uuid)}/${t.file.id || t.file.recording_type || "media"}.${extFor(t.file)}`
      const started = Date.now()
      const blob = await put(pathname, res.body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: blobToken,
        multipart: true,
      })
      const secs = (Date.now() - started) / 1000

      // Re-read before writing so we merge into whatever the nightly sync may
      // have written while we were streaming. Four separate bugs in this
      // pipeline have been "upserted recording_files fresh and wiped the blob
      // links" — do not add a fifth.
      const { data: fresh, error: readErr } = await admin
        .from("zoom_recordings")
        .select("recording_files")
        .eq("id", t.rowId)
        .maybeSingle()
      if (readErr) throw new Error(`read-back: ${readErr.message}`)

      const files = ((fresh?.recording_files as ZoomFile[]) ?? []).map((f) =>
        String(f.id) === String(t.file.id)
          ? { ...f, blob_url: blob.url, blob_pathname: blob.pathname }
          : f,
      )
      const { error: updErr } = await admin
        .from("zoom_recordings")
        .update({ recording_files: files })
        .eq("id", t.rowId)
      if (updErr) throw new Error(`update: ${updErr.message}`)

      done++
      console.log(`  ✓ archived in ${secs.toFixed(0)}s (${(size / 1e6 / secs).toFixed(1)} MB/s)`)
    } catch (err) {
      failed++
      console.log(`  ✗ ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log(`\ndone: ${done} copied, ${failed} failed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
