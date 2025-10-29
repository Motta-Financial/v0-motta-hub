import { NextResponse } from "next/server"

// In-memory storage for messages (replace with database in production)
const messages: Array<{
  id: string
  author: string
  authorInitials: string
  content: string
  timestamp: string
  reactions: { emoji: string; count: number }[]
  comments: Array<{
    id: string
    author: string
    authorInitials: string
    content: string
    timestamp: string
  }>
  gifUrl?: string
}> = [
  {
    id: "1",
    author: "Sarah Johnson",
    authorInitials: "SJ",
    content: "Welcome to the team message board! Feel free to share updates, ask questions, or celebrate wins here.",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    reactions: [{ emoji: "👍", count: 5 }],
    comments: [],
  },
  {
    id: "2",
    author: "Mark Dwyer",
    authorInitials: "MD",
    content: "Great job everyone on closing out Q4! Let's keep the momentum going into the new year.",
    timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    reactions: [
      { emoji: "🎉", count: 3 },
      { emoji: "💪", count: 2 },
    ],
    comments: [],
  },
]

export async function GET() {
  try {
    const sortedMessages = [...messages].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )

    return NextResponse.json(sortedMessages)
  } catch (error) {
    console.error("Error fetching messages:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { author, content, gifUrl } = body

    if (!author || (!content && !gifUrl)) {
      return NextResponse.json({ error: "Author and content or GIF are required" }, { status: 400 })
    }

    const newMessage = {
      id: Date.now().toString(),
      author,
      authorInitials: author
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase(),
      content: content || "",
      timestamp: new Date().toISOString(),
      reactions: [],
      comments: [],
      ...(gifUrl && { gifUrl }),
    }

    messages.unshift(newMessage)

    return NextResponse.json(newMessage, { status: 201 })
  } catch (error) {
    console.error("Error creating message:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
