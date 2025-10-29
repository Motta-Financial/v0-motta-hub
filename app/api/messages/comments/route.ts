import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { messageId, author, content } = body

    if (!messageId || !author || !content) {
      return NextResponse.json({ error: "Message ID, author, and content are required" }, { status: 400 })
    }

    // This is a simplified version - in production, use shared storage
    // For now, this demonstrates the API structure
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error("Error adding comment:", error)
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 })
  }
}
