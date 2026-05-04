import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Per-event team comments. Mirrors the debrief_comments shape:
 *   • author_team_member_id is best-effort (set when the caller passes
 *     a team member id; nullable in the schema so login-less code paths
 *     don't blow up)
 *   • author_name is denormalized so deleting a teammate doesn't strand
 *     their historical comments with a "?" attribution
 *
 * GET    → returns comments for the event ordered oldest → newest
 * POST   → adds a comment, body { content, authorTeamMemberId, authorName, authorAvatarUrl }
 * DELETE → ?id=<comment id>
 */

async function resolveEventId(uuid: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("calendly_events")
    .select("id")
    .eq("calendly_uuid", uuid)
    .maybeSingle()
  return { supabase, eventId: data?.id ?? null }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params
  const { supabase, eventId } = await resolveEventId(uuid)
  if (!eventId) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const { data, error } = await supabase
    .from("calendly_event_comments")
    .select("*")
    .eq("calendly_event_id", eventId)
    .order("created_at", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ comments: data || [] })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params
  const { supabase, eventId } = await resolveEventId(uuid)
  if (!eventId) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const content: string = (body.content ?? "").toString().trim()
  if (!content) {
    return NextResponse.json({ error: "content required" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("calendly_event_comments")
    .insert({
      calendly_event_id: eventId,
      author_team_member_id: body.authorTeamMemberId ?? null,
      // We always require *some* author label so the UI never shows a
      // blank attribution. "Team member" is the last-resort fallback.
      author_name: (body.authorName ?? "Team member").toString(),
      author_avatar_url: body.authorAvatarUrl ?? null,
      content,
    })
    .select("*")
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ comment: data })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params
  const { supabase, eventId } = await resolveEventId(uuid)
  if (!eventId) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 })

  // Scope to this event so a leaked id from another event can't be deleted.
  const { error } = await supabase
    .from("calendly_event_comments")
    .delete()
    .eq("id", id)
    .eq("calendly_event_id", eventId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
