import { NextResponse } from "next/server"

// Import the messages array from the main route (in production, use a database)
const messages: Array<{
  id: string
  author: string
  authorInitials: string
  content: string
  timestamp: string
  reactions: { emoji: string; count: number }[]
  comments: any[]
  gifUrl?: string
}> = []

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { messageId, emoji } = body

    if (!messageId || !emoji) {
      return NextResponse.json({ error: "Message ID and emoji are required" }, { status: 400 })
    }

    // This is a simplified version - in production, import from shared storage
    // For now, this demonstrates the API structure
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error("Error adding reaction:", error)
    return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 })
  }
}
