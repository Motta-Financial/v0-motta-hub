/**
 * Independent Zoom→Hub archive audit.
 *
 * Enumerates every cloud recording DIRECTLY from the Zoom API (source of
 * truth — not our DB), and for each:
 *   - MP4/M4A file  → verifies a blob exists in the private zoom-recordings
 *     store (head() with the store token) and its byte size matches Zoom's.
 *   - TRANSCRIPT/CC → verifies a parsed row exists in zoom_transcripts.
 *
 * Prints a coverage report and an explicit missing list. The rule: nothing
 * gets deleted from Zoom until the missing list is empty.
 *
 *   npx tsx scripts/376-audit-zoom-archive.ts [monthsBack=36]
 */

import { readFileSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { head } from "@vercel/blob"
import { listAllZoomUsers, s2sFetch } from "../lib/zoom/s2s-auth"
import type { ZoomRecordingFile } from "../lib/zoom/ingest-recording-files"

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  if (process.env[m[1]] === undefined) process.env[m[1]] = v
}

const MEDIA = new Set(["MP4", "M4A"])
const TRANSCRIPT = new Set(["TRANSCRIPT", "CC", "CLOSED_CAPTION"])
const AUX = new Set(["SUMMARY", "TIMELINE", "CHAT", "CHAT_MESSAGE", "AUDIO_INTERPRETATION"])

interface Missing {
  kind: "video" | "transcript"
  topic: string
  start: string
  host: string
  uuid: string
  fileId: string
  fileType: string
  reason: string
  sizeMB?: number
}

function monthWindow(back: number): [string, string] {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0))
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return [fmt(start), fmt(end)]
}

async function main() {
  const monthsBack = Math.max(1, Number(process.argv[2]) || 36)
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const blobToken = process.env.ZOOM_BLOB_READ_WRITE_TOKEN
  if (!blobToken) throw new Error("ZOOM_BLOB_READ_WRITE_TOKEN not set")

  // ── Hub state: recording_files by uuid, parsed transcripts by uuid|fileId ──
  const dbFiles = new Map<string, ZoomRecordingFile[]>()
  for (let fromRow = 0; ; fromRow += 1000) {
    const { data, error } = await admin
      .from("zoom_recordings")
      .select("zoom_uuid, recording_files")
      .order("id")
      .range(fromRow, fromRow + 999)
    if (error) throw new Error(`zoom_recordings page: ${error.message}`)
    for (const r of data ?? []) dbFiles.set(r.zoom_uuid, (r.recording_files as ZoomRecordingFile[]) ?? [])
    if (!data || data.length < 1000) break
  }

  const parsedTranscripts = new Set<string>()
  for (let fromRow = 0; ; fromRow += 1000) {
    const { data, error } = await admin
      .from("zoom_transcripts")
      .select("zoom_meeting_uuid, recording_file_id, status")
      .eq("status", "parsed")
      .order("id")
      .range(fromRow, fromRow + 999)
    if (error) throw new Error(`zoom_transcripts page: ${error.message}`)
    for (const t of data ?? []) parsedTranscripts.add(`${t.zoom_meeting_uuid}|${t.recording_file_id}`)
    if (!data || data.length < 1000) break
  }
  console.log(`hub state: ${dbFiles.size} recordings, ${parsedTranscripts.size} parsed transcripts\n`)

  // ── Walk Zoom (source of truth) ────────────────────────────────────────
  const users = await listAllZoomUsers("active")
  console.log(`zoom users: ${users.length}, scanning ${monthsBack} months...\n`)

  let totVideos = 0
  let okVideos = 0
  let totTranscripts = 0
  let okTranscripts = 0
  let totBytes = 0
  let okBytes = 0
  let auxSkipped = 0
  const missing: Missing[] = []
  const blobCache = new Map<string, number | null>() // pathname → size or null

  for (const user of users) {
    for (let back = 0; back < monthsBack; back++) {
      const [from, to] = monthWindow(back)
      let nextToken: string | null = null
      for (let page = 0; page < 20; page++) {
        const params = new URLSearchParams({ page_size: "300", from, to })
        if (nextToken) params.set("next_page_token", nextToken)
        const res = await s2sFetch(
          `https://api.zoom.us/v2/users/${encodeURIComponent(user.id)}/recordings?${params.toString()}`,
        )
        if (res.status === 404) break
        if (!res.ok) throw new Error(`recordings ${user.email} ${from}: http ${res.status}`)
        const data = (await res.json()) as {
          meetings?: Array<Record<string, any>>
          next_page_token?: string
        }

        for (const rec of data.meetings ?? []) {
          const hubFiles = dbFiles.get(rec.uuid) ?? []
          for (const f of (rec.recording_files ?? []) as ZoomRecordingFile[]) {
            const type = (f.file_type || "").toUpperCase()
            const base = {
              topic: rec.topic ?? "(untitled)",
              start: rec.start_time ?? "?",
              host: user.email ?? user.id,
              uuid: rec.uuid,
              fileId: String(f.id ?? "?"),
              fileType: type,
            }

            if (MEDIA.has(type)) {
              totVideos++
              totBytes += f.file_size ?? 0
              const hub = hubFiles.find((h) => String(h.id) === String(f.id))
              if (!hub?.blob_pathname) {
                missing.push({ kind: "video", ...base, reason: "no blob link in hub", sizeMB: (f.file_size ?? 0) / 1e6 })
                continue
              }
              let size = blobCache.get(hub.blob_pathname)
              if (size === undefined) {
                try {
                  const meta = await head(hub.blob_pathname, { token: blobToken })
                  size = meta?.size ?? null
                } catch {
                  size = null
                }
                blobCache.set(hub.blob_pathname, size)
              }
              if (size === null) {
                missing.push({ kind: "video", ...base, reason: "blob not found in store", sizeMB: (f.file_size ?? 0) / 1e6 })
              } else if (f.file_size && size !== f.file_size) {
                missing.push({
                  kind: "video",
                  ...base,
                  reason: `size mismatch (zoom ${f.file_size} vs blob ${size})`,
                  sizeMB: (f.file_size ?? 0) / 1e6,
                })
              } else {
                okVideos++
                okBytes += f.file_size ?? 0
              }
            } else if (TRANSCRIPT.has(type)) {
              totTranscripts++
              if (parsedTranscripts.has(`${rec.uuid}|${f.id}`)) okTranscripts++
              else missing.push({ kind: "transcript", ...base, reason: "no parsed transcript row" })
            } else if (AUX.has(type)) {
              auxSkipped++
            }
          }
        }

        nextToken = data.next_page_token || null
        if (!nextToken) break
      }
    }
    process.stdout.write(`scanned ${user.email ?? user.id}\n`)
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const gb = (b: number) => (b / 1e9).toFixed(2)
  console.log("\n════════ ARCHIVE AUDIT ════════")
  console.log(`videos/audio : ${okVideos}/${totVideos} archived & size-verified (${gb(okBytes)}/${gb(totBytes)} GB)`)
  console.log(`transcripts  : ${okTranscripts}/${totTranscripts} parsed in hub`)
  console.log(`aux files    : ${auxSkipped} (summaries/timelines/chat — not archived by design)`)
  console.log(`MISSING      : ${missing.length}`)
  for (const m of missing.slice(0, 50)) {
    console.log(
      `  - [${m.kind}] ${m.start} "${m.topic}" (${m.host}) ${m.fileType}${m.sizeMB ? ` ${m.sizeMB.toFixed(0)}MB` : ""} — ${m.reason}`,
    )
  }
  if (missing.length > 50) console.log(`  ...and ${missing.length - 50} more`)

  writeFileSync("zoom-archive-audit.json", JSON.stringify({ ranAt: new Date().toISOString(), okVideos, totVideos, okTranscripts, totTranscripts, okBytes, totBytes, missing }, null, 2))
  console.log("\nfull report: zoom-archive-audit.json")
  console.log(missing.length === 0 ? "\n✅ SAFE: everything on Zoom is archived in the Hub." : "\n⚠️ NOT SAFE to delete from Zoom yet.")
}

main().catch((e) => {
  console.error("AUDIT FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
})
