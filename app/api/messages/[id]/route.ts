import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// Add reaction to message
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createAdminClient()
    const { id } = params
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

// Delete message
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    const { error } = await supabase.from("messages").delete().eq("id", id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting message:", error)
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 })
  }
}
