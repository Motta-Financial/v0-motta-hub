/**
 * Zoom per-session client links — READ-ONLY check (after 432 + 433).
 *
 * A Zoom meeting NUMBER is shared by every session of a Personal Meeting Room
 * or recurring meeting. Since 433 each session has its own zoom_meetings row,
 * and its client links must come from evidence THAT session holds. For every
 * session of a shared number this classifies each client link by where it
 * came from:
 *
 *   own_participant  a participant of this very session resolved to that
 *                    contact (zoom_meeting_participants on this row + uuid)
 *   own_booking      the Calendly booking bridged to this session starts
 *                    within 30 min of it and carries that client
 *   manual           a teammate tagged this session (not flagged)
 *   flagged          needs_review — never used to file notes automatically
 *   alfred           ALFRED's guess, not flagged — shown in the UI but never
 *                    used to file notes on a shared number
 *   UNCORROBORATED   none of the above: an unflagged link this session gives
 *                    no reason for. Should be 0.
 *
 * Also checks the structure 433 promises: every recorded/transcribed session
 * has its own row, participant rows sit on their own session, no booking is
 * bridged to two sessions, no bridge is more than 30 min from its session.
 *
 * Prints counts and row ids only — never names, emails or meeting topics.
 * Exits 1 when any check fails.
 *
 *   npx tsx scripts/434-zoom-session-links-check.ts           # summary
 *   npx tsx scripts/434-zoom-session-links-check.ts --verbose # + per-session lines
 */
import { Client } from "pg"
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

type LinkRow = {
  session_row: string
  zoom_uuid: string
  zoom_meeting_id: string
  start_time: string | null
  link_id: string
  link_source: string
  needs_review: boolean | null
  own_participant: boolean
  own_booking: boolean
}

/** Runs every check on an open connection; returns the names that failed. */
export async function runChecks(db: Client, opts: { verbose?: boolean } = {}): Promise<string[]> {
  const verbose = opts.verbose === true
  const failures: string[] = []
  const check = (name: string, value: number, ok: boolean) => {
    console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(66)} ${value}`)
    if (!ok) failures.push(name)
  }

  // Shared = more than one real session seen (recordings / transcripts),
  // or more than one zoom_meetings row.
  const shared = `
    with occ as (
      select zoom_meeting_id n, zoom_uuid u from zoom_recordings where zoom_uuid is not null
      union select zoom_meeting_id, zoom_meeting_uuid from zoom_transcripts where zoom_meeting_uuid is not null
    )
    select n from occ group by n having count(distinct u) > 1
    union select zoom_meeting_id from zoom_meetings group by zoom_meeting_id having count(*) > 1`

  const { rows: [structure] } = await db.query(`
    with shared as (${shared})
    select
      (select count(*) from shared)::int as shared_numbers,
      (select count(*) from zoom_meetings where zoom_meeting_id in (select n from shared))::int as session_rows,
      (select count(*) from (
         select zoom_uuid u from zoom_recordings where zoom_uuid is not null
         union select zoom_meeting_uuid from zoom_transcripts where zoom_meeting_uuid is not null
       ) s where not exists (select 1 from zoom_meetings z where z.zoom_uuid = s.u))::int as sessions_without_row,
      (select count(*) from zoom_meeting_participants p join zoom_meetings zm on zm.id = p.zoom_meeting_id
         where p.zoom_meeting_uuid is distinct from zm.zoom_uuid)::int as participants_on_other_session,
      (select count(*) from (select calendly_event_id from zoom_meetings where calendly_event_id is not null
         and zoom_meeting_id in (select n from shared) group by 1 having count(*) > 1) x)::int as bookings_on_two_sessions,
      (select count(*) from zoom_meetings zm join calendly_events ce on ce.id = zm.calendly_event_id
         where zm.zoom_meeting_id in (select n from shared)
           and (zm.start_time is null or abs(extract(epoch from (ce.start_time - zm.start_time))) > 1800))::int as bridges_off_session,
      (select count(*) from (select zoom_meeting_id from zoom_meetings group by 1 having count(*) > 1) x)::int as numbers_with_several_rows,
      exists (select 1 from pg_indexes where indexname = 'zoom_meetings_zoom_uuid_key')::int as has_uuid_key,
      exists (select 1 from pg_constraint where conname = 'zoom_meetings_zoom_meeting_id_key')::int as has_number_key
  `)

  console.log("Structure")
  check("432 applied (unique zoom_uuid)", structure.has_uuid_key, structure.has_uuid_key === 1)
  check("433 applied (per-number unique key dropped)", structure.has_number_key, structure.has_number_key === 0)
  console.log(`      shared numbers ${structure.shared_numbers}, their session rows ${structure.session_rows}`)
  check("recorded/transcribed sessions with no row of their own", structure.sessions_without_row, structure.sessions_without_row === 0)
  check("participant rows sitting on another session's row", structure.participants_on_other_session, structure.participants_on_other_session === 0)
  check("Calendly bookings bridged to two sessions of one number", structure.bookings_on_two_sessions, structure.bookings_on_two_sessions === 0)
  check("bridges more than 30 min from their session (shared numbers)", structure.bridges_off_session, structure.bridges_off_session === 0)

  const { rows: links } = await db.query<LinkRow>(`
    with shared as (${shared})
    select zm.id as session_row, zm.zoom_uuid, zm.zoom_meeting_id::text, zm.start_time,
           c.id as link_id, c.link_source, c.needs_review,
           exists (
             select 1 from zoom_meeting_participants p
             where p.zoom_meeting_id = zm.id and p.zoom_meeting_uuid = zm.zoom_uuid
               and c.contact_id is not null and p.contact_id = c.contact_id
           ) as own_participant,
           exists (
             select 1 from calendly_events ce
             join calendly_event_clients ec on ec.calendly_event_id = ce.id
             where ce.id = zm.calendly_event_id
               and zm.start_time is not null
               and abs(extract(epoch from (ce.start_time - zm.start_time))) <= 1800
               and (ec.contact_id = c.contact_id or ec.organization_id = c.organization_id)
           ) as own_booking
    from zoom_meetings zm
    join zoom_meeting_clients c on c.zoom_meeting_id = zm.id
    where zm.zoom_meeting_id in (select n from shared)
    order by zm.zoom_meeting_id, zm.start_time
  `)

  const classify = (l: LinkRow) =>
    l.own_participant
      ? "own_participant"
      : l.own_booking
        ? "own_booking"
        : l.needs_review
          ? "flagged"
          : l.link_source === "manual"
            ? "manual"
            : l.link_source === "alfred"
              ? "alfred"
              : "UNCORROBORATED"

  const tally = new Map<string, number>()
  const sessionsWithLinks = new Set<string>()
  const sessionsWithConfident = new Set<string>()
  for (const l of links) {
    const k = classify(l)
    tally.set(k, (tally.get(k) ?? 0) + 1)
    sessionsWithLinks.add(l.session_row)
    if (k === "own_participant" || k === "own_booking" || k === "manual") sessionsWithConfident.add(l.session_row)
    if (verbose) {
      console.log(
        `      ${l.zoom_meeting_id} ${l.start_time ? new Date(l.start_time).toISOString() : "(no start)"} ` +
          `session=${l.session_row} link=${l.link_id} source=${l.link_source} → ${k}`,
      )
    }
  }

  console.log("\nClient links on shared-number sessions, by evidence")
  for (const k of ["own_participant", "own_booking", "manual", "flagged", "alfred"]) {
    console.log(`      ${k.padEnd(66)} ${tally.get(k) ?? 0}`)
  }
  const uncorroborated = tally.get("UNCORROBORATED") ?? 0
  check("UNCORROBORATED (unflagged, not from this session)", uncorroborated, uncorroborated === 0)
  console.log(`      sessions with any client link ${sessionsWithLinks.size}, with one confident enough to file notes ${sessionsWithConfident.size}`)

  // What the reviewed notes step would cover — reported, never acted on.
  const { rows: [notes] } = await db.query(`
    with shared as (${shared})
    select
      count(*) filter (where zt.summary_note_id is not null)::int as notes_filed,
      count(*) filter (where zt.summary_status in ('skipped_no_client', 'skipped_shared_number'))::int as not_summarized
    from zoom_transcripts zt
    where zt.zoom_meeting_id in (select n from shared)
  `)
  console.log("\nTranscripts on shared numbers (for the separate, reviewed notes step)")
  console.log(`      with an ALFRED note already filed                               ${notes.notes_filed}`)
  console.log(`      not summarized (skipped_no_client / skipped_shared_number)      ${notes.not_summarized}`)
  return failures
}

async function main() {
  loadEnv()
  const pgUrl = process.env.POSTGRES_URL_NON_POOLING
  if (!pgUrl) throw new Error("POSTGRES_URL_NON_POOLING not set")

  // sslmode in the URL would override the ssl object below (verify-full).
  const db = new Client({
    connectionString: pgUrl.replace(/[?&]sslmode=[^&]*/, ""),
    ssl: { rejectUnauthorized: false },
  })
  await db.connect()
  await db.query("set default_transaction_read_only = on")
  let failures: string[]
  try {
    failures = await runChecks(db, { verbose: process.argv.includes("--verbose") })
  } finally {
    await db.end()
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log("\nall checks passed")
}

if (process.argv[1]?.endsWith("434-zoom-session-links-check.ts")) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
