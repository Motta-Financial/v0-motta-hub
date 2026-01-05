import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET() {
  try {
    // Fetch messages with reactions and comments
    const { data: messages, error } = await supabase
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
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })

    if (error) throw error

    // Transform to match frontend expected format
    const formattedMessages = (messages || []).map((msg) => ({
      id: msg.id,
      author: msg.author_name,
      authorInitials: msg.author_initials,
      teamMemberId: msg.author_id,
      content: msg.content,
      timestamp: msg.created_at,
      gifUrl: msg.gif_url,
      isPinned: msg.is_pinned,
      reactions: aggregateReactions(msg.message_reactions || []),
      comments: (msg.message_comments || []).map((c: any) => ({
        id: c.id,
        author: c.author_name,
        authorInitials: c.author_initials,
        teamMemberId: c.author_id,
        content: c.content,
        timestamp: c.created_at,
      })),
    }))

    return NextResponse.json(formattedMessages)
  } catch (error) {
    console.error("Error fetching messages:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

// Helper to aggregate reactions by emoji
function aggregateReactions(reactions: any[]) {
  const counts: Record<string, number> = {}
  reactions.forEach((r) => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1
  })
  return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }))
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { author, authorInitials, teamMemberId, content, gifUrl } = body

    if (!author || (!content && !gifUrl)) {
      return NextResponse.json({ error: "Author and content or GIF are required" }, { status: 400 })
    }

    const initials =
      authorInitials ||
      author
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()

    const { data: newMessage, error } = await supabase
      .from("messages")
      .insert({
        author_name: author,
        author_initials: initials,
        author_id: teamMemberId || null,
        content: content || "",
        gif_url: gifUrl || null,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(
      {
        id: newMessage.id,
        author: newMessage.author_name,
        authorInitials: newMessage.author_initials,
        teamMemberId: newMessage.author_id,
        content: newMessage.content,
        timestamp: newMessage.created_at,
        gifUrl: newMessage.gif_url,
        reactions: [],
        comments: [],
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("Error creating message:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
