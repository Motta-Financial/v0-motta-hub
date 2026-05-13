import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  buildLoomShareUrl,
  extractLoomVideoId,
  fetchLoomOEmbed,
} from "@/lib/loom"

/**
 * Bulk-add Loom videos.
 *
 * Closest thing to "auto-sync from a folder" Motta can have today
 * without Loom Enterprise API access: a teammate exports/pastes a list
 * of Loom share URLs (one per line, or comma/space separated), and we
 * enrich + insert them in a single round trip.
 *
 * Per-URL result shape lets the UI render a "10 added, 2 duplicates, 1
 * not a Loom URL" summary so the teammate sees exactly what happened.
 *
 * POST /api/training/videos/bulk
 *   body: { urls: string[]|string, category_id?: string|null,
 *           department?: string|null }
 */

interface BulkResult {
  /** Original input as the user typed it (so they can match results to lines). */
  input: string
  status: "added" | "duplicate" | "invalid" | "error"
  video_id?: string
  title?: string | null
  message?: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | {
        urls?: string | string[]
        category_id?: string | null
        department?: string | null
      }
    | null
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Accept either a string blob (textarea contents) or a pre-split array.
  // The string blob path is intentionally generous about separators —
  // teammates paste from Notion, Excel, plain text, and email; line
  // breaks / commas / tabs / whitespace all need to work.
  const rawList: string[] = Array.isArray(body.urls)
    ? body.urls
    : typeof body.urls === "string"
      ? body.urls.split(/[\s,]+/g)
      : []

  const inputs = rawList.map((s) => s.trim()).filter(Boolean)
  if (inputs.length === 0) {
    return NextResponse.json({ error: "No URLs provided" }, { status: 400 })
  }
  // Bound payload — a sane teammate won't ever paste 200+ at once, and
  // it protects us from a runaway oEmbed fanout.
  if (inputs.length > 50) {
    return NextResponse.json(
      { error: "Up to 50 URLs at a time, please." },
      { status: 400 },
    )
  }

  // Pre-fetch the teammate's display name once so we can stamp every
  // inserted row without N round-trips.
  const { data: teamMember } = await supabase
    .from("team_members")
    .select("id, full_name")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  // De-dupe within the request first — if the textarea has the same URL
  // twice, only attempt one insert.
  const seen = new Set<string>()
  const dedupedInputs = inputs.filter((raw) => {
    const id = extractLoomVideoId(raw)
    if (!id) return true // keep so we can surface "invalid"
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  // Enrich all valid URLs in parallel via Loom oEmbed. Invalid ones get
  // a null placeholder so we keep array indices aligned with `dedupedInputs`.
  const enriched = await Promise.all(
    dedupedInputs.map(async (raw) => {
      const id = extractLoomVideoId(raw)
      if (!id) return null
      const meta = await fetchLoomOEmbed(raw)
      return { id, raw, meta }
    }),
  )

  const results: BulkResult[] = []

  // Sequential inserts. We could batch via .insert([...]) and use the
  // returned rows, but the per-row error story (duplicate vs other) is
  // easier to surface when each insert is its own statement. Volume
  // is bounded at 50.
  for (let i = 0; i < dedupedInputs.length; i++) {
    const raw = dedupedInputs[i]
    const item = enriched[i]
    if (!item) {
      results.push({
        input: raw,
        status: "invalid",
        message: "Not a Loom URL",
      })
      continue
    }

    const insertRow = {
      loom_url: buildLoomShareUrl(item.id),
      loom_video_id: item.id,
      title:
        item.meta?.title ||
        `Loom video ${item.id.slice(0, 8)}`,
      description: null as string | null,
      thumbnail_url: item.meta?.thumbnailUrl || null,
      duration_seconds: item.meta?.durationSeconds ?? null,
      author_name: item.meta?.authorName || null,
      category_id: body.category_id || null,
      department: body.department || null,
      tags: null as string[] | null,
      is_pinned: false,
      added_by_id: teamMember?.id ?? null,
      added_by_name: teamMember?.full_name ?? user.email ?? null,
    }

    const { data, error } = await supabase
      .from("training_videos")
      .insert(insertRow)
      .select("id, title")
      .single()

    if (error) {
      if (error.code === "23505") {
        results.push({
          input: raw,
          status: "duplicate",
          video_id: item.id,
          message: "Already in the library",
        })
      } else {
        console.error("[training:bulk] supabase error", error)
        results.push({
          input: raw,
          status: "error",
          message: error.message,
        })
      }
    } else {
      results.push({
        input: raw,
        status: "added",
        video_id: data!.id,
        title: data!.title,
      })
    }
  }

  // Surface a tally at the top so the UI can render a one-line summary.
  const summary = results.reduce(
    (acc, r) => {
      acc[r.status]++
      return acc
    },
    { added: 0, duplicate: 0, invalid: 0, error: 0 },
  )

  return NextResponse.json({ summary, results })
}
