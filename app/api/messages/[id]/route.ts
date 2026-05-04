import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// Add reaction to message
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()
    const { action, emoji, teamMemberId, comment } = body

    if (action === "react") {
      // Check if reaction already exists
      const { data: existing } = await supabase
        .from("message_reactions")
        .select("id")
        .eq("message_id", id)
        .eq("emoji", emoji)
        .eq("team_member_id", teamMemberId)
        .single()

      if (existing) {
        // Remove reaction (toggle)
        await supabase.from("message_reactions").delete().eq("id", existing.id)
      } else {
        // Add reaction
        await supabase.from("message_reactions").insert({
          message_id: id,
          emoji,
          team_member_id: teamMemberId,
        })
      }

      return NextResponse.json({ success: true })
    }

    if (action === "comment") {
      const { data: newComment, error } = await supabase
        .from("message_comments")
        .insert({
          message_id: id,
          author_name: comment.author,
          author_initials: comment.author
            .split(" ")
            .map((n: string) => n[0])
            .join("")
            .toUpperCase(),
          content: comment.content,
        })
        .select()
        .single()

      if (error) throw error

      return NextResponse.json({
        id: newComment.id,
        author: newComment.author_name,
        authorInitials: newComment.author_initials,
        content: newComment.content,
        timestamp: newComment.created_at,
      })
    }

    if (action === "pin") {
      const { error } = await supabase.from("messages").update({ is_pinned: body.isPinned }).eq("id", id)

      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Error updating message:", error)
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 })
  }
}

// Edit message content. Anyone can edit any message — every edit is recorded
// in `message_edit_history` so we have a full audit trail of what changed,
// who changed it, and when.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()
    const { content, gifUrl, editorName, editorInitials, editorId } = body

    if (typeof content !== "string" && typeof gifUrl !== "string" && gifUrl !== null) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }
    if (!editorName || typeof editorName !== "string") {
      return NextResponse.json({ error: "editorName is required" }, { status: 400 })
    }

    // Snapshot the previous values BEFORE the update so the audit row reflects
    // exactly what was overwritten.
    const { data: existing, error: fetchError } = await supabase
      .from("messages")
      .select("id, content, gif_url")
      .eq("id", id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof content === "string") updates.content = content
    if (gifUrl === null || typeof gifUrl === "string") updates.gif_url = gifUrl

    const { data: updated, error: updateError } = await supabase
      .from("messages")
      .update(updates)
      .eq("id", id)
      .select(`
        id,
        author_name,
        author_initials,
        author_id,
        content,
        gif_url,
        is_pinned,
        created_at,
        updated_at,
        message_reactions ( id, emoji, team_member_id ),
        message_comments ( id, author_name, author_initials, author_id, content, created_at )
      `)
      .single()

    if (updateError) throw updateError

    // Log the audit row only if the content or gif actually changed.
    const contentChanged = typeof content === "string" && content !== existing.content
    const gifChanged =
      (gifUrl === null || typeof gifUrl === "string") && gifUrl !== existing.gif_url
    if (contentChanged || gifChanged) {
      await supabase.from("message_edit_history").insert({
        message_id: id,
        previous_content: existing.content,
        previous_gif_url: existing.gif_url,
        edited_by_id: editorId ?? null,
        edited_by_name: editorName,
        edited_by_initials: editorInitials ?? null,
      })
    }

    const reactionCounts: Record<string, number> = {}
    for (const r of (updated.message_reactions ?? []) as Array<{ emoji: string }>) {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1
    }

    return NextResponse.json({
      id: updated.id,
      author: updated.author_name,
      authorInitials: updated.author_initials,
      teamMemberId: updated.author_id,
      content: updated.content,
      gifUrl: updated.gif_url,
      isPinned: updated.is_pinned,
      timestamp: updated.created_at,
      updatedAt: updated.updated_at,
      reactions: Object.entries(reactionCounts).map(([emoji, count]) => ({ emoji, count })),
      comments: (updated.message_comments ?? []).map((c: any) => ({
        id: c.id,
        author: c.author_name,
        authorInitials: c.author_initials,
        teamMemberId: c.author_id,
        content: c.content,
        timestamp: c.created_at,
      })),
    })
  } catch (error) {
    console.error("Error editing message:", error)
    return NextResponse.json({ error: "Failed to edit message" }, { status: 500 })
  }
}

// Read the audit trail of edits for a message. Used by the message board UI
// to show the "edited" history popover.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createAdminClient()
    const { id } = await params

    const { data, error } = await supabase
      .from("message_edit_history")
      .select("id, previous_content, previous_gif_url, edited_by_name, edited_by_initials, edited_at")
      .eq("message_id", id)
      .order("edited_at", { ascending: false })

    if (error) throw error

    return NextResponse.json(
      (data ?? []).map((row) => ({
        id: row.id,
        previousContent: row.previous_content,
        previousGifUrl: row.previous_gif_url,
        editorName: row.edited_by_name,
        editorInitials: row.edited_by_initials,
        editedAt: row.edited_at,
      })),
    )
  } catch (error) {
    console.error("Error fetching message edit history:", error)
    return NextResponse.json({ error: "Failed to fetch edit history" }, { status: 500 })
  }
}

// Delete message
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createAdminClient()
    const { id } = await params

    const { error } = await supabase.from("messages").delete().eq("id", id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting message:", error)
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 })
  }
}
