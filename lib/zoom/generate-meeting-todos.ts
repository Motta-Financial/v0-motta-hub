/**
 * Sweeps the Zoom meeting list and creates a "tag this meeting" task in
 * every host's To-Do list for any meeting that is still untagged.
 *
 * Why this exists
 * ───────────────
 * Tagging meetings against a Karbon work item + client is how we tie
 * billable conversations back to engagements. The dashboard already has
 * a per-meeting Tag dialog, but historically untagged meetings just sit
 * silently in the "27 Untagged" pile. The fix is to push each untagged
 * meeting into its host's day-to-day To-Do list so it becomes a normal
 * piece of work that's tracked and aged like anything else.
 *
 * Dedup contract
 * ──────────────
 * The `tasks_unique_zoom_meeting_per_assignee` partial unique index
 * (assignee_id, zoom_meeting_id) guarantees idempotency: running the
 * sweep N times produces the same rows. We rely on Postgres `ON
 * CONFLICT DO NOTHING` rather than checking-then-inserting so concurrent
 * runs (cron + manual button) never race.
 *
 * Source of truth
 * ───────────────
 * `zoom_meetings_with_tag_counts` is a view that LEFT-joins the two
 * junction tables and exposes a precomputed `needs_tagging` boolean
 * (zero clients AND zero work items linked). Using the view keeps this
 * library agnostic of the underlying tagging schema.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface GenerateZoomMeetingTodosOptions {
  /**
   * Initialised Supabase admin client. We expect admin because the
   * sweep needs to insert tasks on behalf of every user, bypassing
   * per-user RLS.
   */
  supabase: SupabaseClient
  /**
   * Only sweep meetings whose `start_time` is within this many days of
   * `now()`. Defaults to 60 — anything older than that is realistically
   * never going to get tagged retroactively, and we don't want the
   * first run to flood every user's todo list with hundreds of stale
   * entries from the historic backfill.
   */
  sinceDays?: number
  /**
   * Optional filter for a single team member's meetings. Used by the
   * manual "Generate my Zoom tasks" button on the dashboard so a user
   * can sweep only their own queue without waiting for the next cron.
   */
  teamMemberId?: string | null
}

export interface GenerateZoomMeetingTodosResult {
  candidates: number
  created: number
  /**
   * Per-assignee counts so callers can show a friendly toast or audit
   * the sweep run.
   */
  perAssignee: Array<{
    team_member_id: string
    team_member_name: string | null
    created: number
  }>
}

/**
 * Row shape we project out of `zoom_meetings_with_tag_counts`. The view
 * carries the full meeting record plus the two count columns, but we
 * only need a handful of fields here.
 */
interface CandidateRow {
  id: string // internal uuid
  zoom_meeting_id: number | string | null
  team_member_id: string | null
  topic: string | null
  start_time: string | null
  host_email: string | null
  needs_tagging: boolean | null
}

export async function generateZoomMeetingTodos(
  opts: GenerateZoomMeetingTodosOptions,
): Promise<GenerateZoomMeetingTodosResult> {
  const { supabase, sinceDays = 60, teamMemberId = null } = opts
  const sinceIso = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  // ── 1. Pull untagged meetings in window ───────────────────────────
  let query = supabase
    .from("zoom_meetings_with_tag_counts")
    .select(
      "id, zoom_meeting_id, team_member_id, topic, start_time, host_email, needs_tagging",
    )
    .eq("needs_tagging", true)
    // We require a known assignee — meetings whose host hasn't been
    // matched to a team_member yet can't go to anyone's todo list.
    .not("team_member_id", "is", null)
    .not("zoom_meeting_id", "is", null)
    .gte("start_time", sinceIso)
    // Only sweep meetings that actually happened. Future meetings are
    // not "untagged" in any meaningful sense yet.
    .lte("start_time", new Date().toISOString())

  if (teamMemberId) {
    query = query.eq("team_member_id", teamMemberId)
  }

  const { data: candidates, error: candErr } = await query.returns<
    CandidateRow[]
  >()

  if (candErr) throw new Error(`zoom todo sweep query failed: ${candErr.message}`)

  const rows: CandidateRow[] = candidates ?? []

  if (rows.length === 0) {
    return { candidates: 0, created: 0, perAssignee: [] }
  }

  // ── 2. Resolve team member display names for the response ─────────
  const assigneeIds = Array.from(
    new Set(rows.map((r) => r.team_member_id!).filter(Boolean)),
  )
  const { data: members } = await supabase
    .from("team_members")
    .select("id, full_name")
    .in("id", assigneeIds)

  const nameById = new Map<string, string | null>(
    (members ?? []).map((m: any) => [m.id, m.full_name as string | null]),
  )

  // ── 3. Build the insert payload ───────────────────────────────────
  // We compute a per-row sort_order off the max existing value so new
  // auto-tasks land at the bottom of each user's list rather than
  // jumping above whatever they were already working on. Using the
  // same scalar for every inserted row in this run is fine — the
  // existing reorder UI is per-user anyway.
  const { data: maxOrderRow } = await supabase
    .from("tasks")
    .select("sort_order")
    .order("sort_order", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  const baseSortOrder = (maxOrderRow?.sort_order ?? 0) + 1

  const insertRows = rows.map((r) => {
    const meetingDate = r.start_time
      ? new Date(r.start_time).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "the recent meeting"
    // Give the user a week from the meeting to file it. After that the
    // task will go red in the UI which is the right signal.
    const dueIso = r.start_time
      ? new Date(
          new Date(r.start_time).getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString()
      : null

    return {
      title: `Tag Zoom meeting: ${r.topic ?? "(no title)"}`,
      description: `Link the Zoom meeting from ${meetingDate} to a Karbon work item and the client(s) it relates to so the recording is documented against the engagement.`,
      assignee_id: r.team_member_id,
      priority: "medium",
      status: "open",
      is_completed: false,
      due_date: dueIso,
      sort_order: baseSortOrder,
      source_type: "zoom_meeting" as const,
      zoom_meeting_id: r.zoom_meeting_id,
      // We deep-link back into the Zoom dashboard with the meeting
      // pre-selected so clicking the task takes the user straight to
      // the tag dialog. The dashboard reads `?meetingId=` and opens
      // the dialog (see zoom-dashboard.tsx changes in this commit).
      source_url: `/meetings/zoom?meetingId=${r.zoom_meeting_id}`,
    }
  })

  // ── 4. Upsert with the partial unique index doing the dedup ───────
  // We can't use Supabase's `.upsert({ onConflict })` here because the
  // dedup target is a *partial* unique index (where zoom_meeting_id is
  // not null). Supabase's REST layer wants a column tuple. Instead we
  // INSERT and let the index reject duplicates with `ignoreDuplicates`,
  // then count returned rows to know what was actually created.
  const { data: inserted, error: insErr } = await supabase
    .from("tasks")
    .upsert(insertRows, {
      onConflict: "assignee_id,zoom_meeting_id",
      ignoreDuplicates: true,
    })
    .select("id, assignee_id, zoom_meeting_id")

  if (insErr) throw new Error(`zoom todo insert failed: ${insErr.message}`)

  const createdRows = inserted ?? []

  // ── 5. Group by assignee for the response payload ─────────────────
  const grouped = new Map<string, number>()
  for (const row of createdRows) {
    const k = row.assignee_id as string
    grouped.set(k, (grouped.get(k) ?? 0) + 1)
  }

  const perAssignee = Array.from(grouped.entries()).map(
    ([team_member_id, created]) => ({
      team_member_id,
      team_member_name: nameById.get(team_member_id) ?? null,
      created,
    }),
  )

  return {
    candidates: rows.length,
    created: createdRows.length,
    perAssignee,
  }
}
