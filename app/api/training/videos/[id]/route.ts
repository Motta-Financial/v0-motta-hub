import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

/**
 * Single-video endpoints.
 *
 * GET    /api/training/videos/:id — fetch one (used by the watch page).
 * PATCH  /api/training/videos/:id — edit fields (title, description,
 *          category, department, tags, pin state). Any authenticated team
 *          member can edit per the product decision.
 * DELETE /api/training/videos/:id — remove from the library.
 *
 * We deliberately do NOT allow changing loom_url or loom_video_id from
 * here — that's effectively a different video and should be a new row.
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("training_videos")
    .select("*, training_categories(id, name, color)")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("[training:get] supabase error", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ video: data })
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await getAuthenticatedUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | {
        title?: string | null
        description?: string | null
        category_id?: string | null
        department?: string | null
        tags?: string[] | null
        is_pinned?: boolean
      }
    | null
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Only forward whitelisted fields. This protects against a client
  // sending e.g. `loom_video_id` (which would re-key the row) or
  // `added_by_id` (which would rewrite history).
  const patch: Record<string, unknown> = {}
  if (body.title !== undefined) patch.title = body.title?.trim() || null
  if (body.description !== undefined)
    patch.description = body.description?.trim() || null
  if (body.category_id !== undefined) patch.category_id = body.category_id
  if (body.department !== undefined) patch.department = body.department
  if (body.tags !== undefined) {
    patch.tags =
      Array.isArray(body.tags) && body.tags.length > 0
        ? body.tags.map((t) => String(t).trim()).filter(Boolean)
        : null
  }
  if (typeof body.is_pinned === "boolean") patch.is_pinned = body.is_pinned

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("training_videos")
    .update(patch)
    .eq("id", id)
    .select("*, training_categories(id, name, color)")
    .single()

  if (error) {
    console.error("[training:update] supabase error", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ video: data })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await getAuthenticatedUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { error } = await supabase
    .from("training_videos")
    .delete()
    .eq("id", id)

  if (error) {
    console.error("[training:delete] supabase error", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
