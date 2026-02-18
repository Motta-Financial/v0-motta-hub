import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { messageId, author, authorInitials, teamMemberId, content } = body

    if (!messageId || !author || !content) {
      return NextResponse.json({ error: "Message ID, author, and content are required" }, { status: 400 })
    }

    const initials =
      authorInitials ||
      author
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()

    const { data: newComment, error: commentError } = await supabase
      .from("message_comments")
      .insert({
        message_id: messageId,
        author_name: author,
        author_initials: initials,
        author_id: teamMemberId || null,
        content: content,
      })
      .select()
      .single()

    if (commentError) throw commentError

    const { data: updatedMessage, error: fetchError } = await supabase
      .from("messages")
      .select(`
        id,
        author_name,
        author_initials,
        author_id,
        content,
        gif_url,
        is_pinned,
        created_at,
        message_reactions (
          id,
          emoji,
          team_member_id
        ),
        message_comments (
          id,
          author_name,
          author_initials,
          author_id,
          content,
          created_at
        )
      `)
      .eq("id", messageId)
      .single()

    if (fetchError) throw fetchError

    const formattedMessage = {
      id: updatedMessage.id,
      author: updatedMessage.author_name,
      authorInitials: updatedMessage.author_initials,
      teamMemberId: updatedMessage.author_id,
      content: updatedMessage.content,
      timestamp: updatedMessage.created_at,
      gifUrl: updatedMessage.gif_url,
      isPinned: updatedMessage.is_pinned,
      reactions: aggregateReactions(updatedMessage.message_reactions || []),
      comments: (updatedMessage.message_comments || []).map((c: any) => ({
        id: c.id,
        author: c.author_name,
        authorInitials: c.author_initials,
        teamMemberId: c.author_id,
        content: c.content,
        timestamp: c.created_at,
      })),
    }

    return NextResponse.json(formattedMessage, { status: 200 })
  } catch (error) {
    console.error("Error adding comment:", error)
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 })
  }
}

function aggregateReactions(reactions: any[]) {
  const counts: Record<string, number> = {}
  reactions.forEach((r) => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1
  })
  return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }))
}
