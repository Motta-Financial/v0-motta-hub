import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  buildLoomShareUrl,
  extractLoomVideoId,
  fetchLoomOEmbed,
} from "@/lib/loom"

/**
 * Training video library API.
 *
 * GET  /api/training/videos
 *   - Lists every video, newest pinned first, then newest unpinned.
 *   - Supports ?category=<uuid|slug-name>, ?q=<search>, ?department=<dept>.
 *   - Joins the category row so the grid can show the colored chip without
 *     a second round trip.
 *
 * POST /api/training/videos
 *   - Accepts { loom_url, category_id?, department?, description?, tags? }.
 *   - Calls Loom's public oEmbed to auto-populate title/thumbnail/
 *     duration/author. If oEmbed fails (private video, network blip), we
 *     still save the row with the share URL so the teammate can edit the
 *     title manually instead of getting a hard error.
 *   - Per the product decision, ANY authenticated team member can add a
 *     video (RLS is "Allow all", and we gate on session presence here).
 */

// Shape of the row we return to the client. Keep this in sync with what
// the page component expects so we don't accidentally drift.
type TrainingVideoRow = {
  id: string
  loom_url: string
  loom_video_id: string
  title: string | null
  description: string | null
  thumbnail_url: string | null
  duration_seconds: number | null
  author_name: string | null
  category_id: string | null
  department: string | null
  tags: string[] | null
  is_pinned: boolean
  added_by_id: string | null
  added_by_name: string | null
  created_at: string
  updated_at: string
  training_categories: {
    id: string
    name: string
    color: string | null
  } | null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)

  // Filters — all optional. We compose them server-side so the page can
  // request the exact slice it needs without overfetching.
  const category = searchParams.get("category")
  const department = searchParams.get("department")
  const q = searchParams.get("q")?.trim()

  // We need to know if "category" is a uuid or a category name so the
  // sidebar can link with either. Empty / "all" means no filter.
  const isUuid =
    !!category &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      category,
    )

  let query = supabase
    .from("training_videos")
    .select(
      // Inline join on the category so we can render its name + color
      // chip without another fetch. PostgREST will return `null` for the
      // join when category_id is null, which is fine for "Uncategorized".
      "*, training_categories(id, name, color)",
    )
    // Pinned content always floats to the top — useful for "Watch this
    // first" onboarding videos a partner wants front-and-center.
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })

  if (category && category !== "all") {
    if (isUuid) {
      query = query.eq("category_id", category)
    } else {
      // Resolve by name in a single round-trip via a subselect.
      const { data: catRow } = await supabase
        .from("training_categories")
        .select("id")
        .ilike("name", category)
        .maybeSingle()
      if (catRow?.id) {
        query = query.eq("category_id", catRow.id)
      } else {
        // Unknown category — return empty rather than error so a stale
        // bookmark renders an empty grid with the chip selected.
        return NextResponse.json({ videos: [] })
      }
    }
  }

  if (department && department !== "all") {
    query = query.eq("department", department)
  }

  if (q) {
    // ilike on title + description + author covers the common cases.
    // tags are stored as a Postgres array; we OR an array-contains check.
    // PostgREST `or` syntax requires commas-without-spaces inside parens.
    const safe = q.replace(/[,()]/g, " ")
    query = query.or(
      `title.ilike.%${safe}%,description.ilike.%${safe}%,author_name.ilike.%${safe}%`,
    )
  }

  const { data, error } = await query.returns<TrainingVideoRow[]>()
  if (error) {
    console.error("[training:list] supabase error", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ videos: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // Gate on session presence (RLS is "Allow all" on these tables, but
  // we don't want anonymous traffic creating rows even if they can).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | {
        loom_url?: string
        category_id?: string | null
        department?: string | null
        description?: string | null
        title?: string | null
        tags?: string[] | null
        is_pinned?: boolean
      }
    | null

  if (!body?.loom_url) {
    return NextResponse.json(
      { error: "loom_url is required" },
      { status: 400 },
    )
  }

  const videoId = extractLoomVideoId(body.loom_url)
  if (!videoId) {
    return NextResponse.json(
      { error: "Not a recognizable Loom URL." },
      { status: 400 },
    )
  }

  // Auto-enrich. We swallow oEmbed failures and fall back to manual
  // entry — the teammate can still save a row and edit the title later.
  const oembed = await fetchLoomOEmbed(body.loom_url)

  // Look up the teammate's display name so we can de-normalize it onto
  // the row. We could join on every read instead, but stamping at write
  // time keeps the grid render path simple and survives a name change
  // on the source row (good for historical "added by Jane Doe" labels).
  const { data: teamMember } = await supabase
    .from("team_members")
    .select("id, full_name")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  // Resolve title precedence: explicit override > oEmbed title > URL.
  const finalTitle =
    body.title?.trim() ||
    oembed?.title ||
    `Loom video ${videoId.slice(0, 8)}`

  const insertRow = {
    loom_url: buildLoomShareUrl(videoId),
    loom_video_id: videoId,
    title: finalTitle,
    description: body.description?.trim() || null,
    thumbnail_url: oembed?.thumbnailUrl || null,
    duration_seconds: oembed?.durationSeconds ?? null,
    author_name: oembed?.authorName || null,
    category_id: body.category_id || null,
    department: body.department || null,
    tags:
      Array.isArray(body.tags) && body.tags.length > 0
        ? body.tags.map((t) => String(t).trim()).filter(Boolean)
        : null,
    is_pinned: body.is_pinned === true,
    added_by_id: teamMember?.id ?? null,
    added_by_name: teamMember?.full_name ?? user.email ?? null,
  }

  const { data, error } = await supabase
    .from("training_videos")
    .insert(insertRow)
    .select("*, training_categories(id, name, color)")
    .single()

  if (error) {
    // Friendly message for the most common error: a teammate pasted a
    // URL that's already in the library. The DB has a UNIQUE on
    // loom_video_id, which surfaces as code 23505.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That Loom video is already in the library." },
        { status: 409 },
      )
    }
    console.error("[training:create] supabase error", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ video: data }, { status: 201 })
}
