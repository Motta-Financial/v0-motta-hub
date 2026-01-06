import { createClient } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

function isTableNotFoundError(error: any): boolean {
  if (!error) return false

  // Check error code
  if (error.code === "PGRST205" || error.code === "42P01") return true

  // Check message
  const message = error.message?.toLowerCase() || ""
  if (
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("debrief_comments")
  ) {
    return true
  }

  // Check hint
  const hint = error.hint?.toLowerCase() || ""
  if (hint.includes("perhaps you meant")) return true

  return false
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const debriefIds = searchParams.get("debriefIds")?.split(",").filter(Boolean)

    if (!debriefIds?.length) {
      return NextResponse.json({ comments: [], tableExists: true })
    }

    const { data, error } = await supabase
      .from("debrief_comments")
      .select("*")
      .in("debrief_id", debriefIds)
      .order("created_at", { ascending: true })

    if (error) {
      console.log("[v0] Supabase error:", JSON.stringify(error, null, 2))
      if (isTableNotFoundError(error)) {
        return NextResponse.json({ comments: [], tableExists: false })
      }
      // For any other error, still return empty comments gracefully
      console.error("Error fetching debrief comments:", error)
      return NextResponse.json({ comments: [], error: error.message })
    }

    return NextResponse.json({ comments: data || [], tableExists: true })
  } catch (error: any) {
    console.log("[v0] Caught error:", error?.message, error?.code)
    if (isTableNotFoundError(error)) {
      return NextResponse.json({ comments: [], tableExists: false })
    }
    console.error("Error fetching debrief comments:", error)
    // Return empty comments instead of error to prevent UI from breaking
    return NextResponse.json({ comments: [], error: "Failed to fetch comments" })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { debrief_id, author_id, author_name, content } = body

    if (!debrief_id || !author_id || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("debrief_comments")
      .insert({
        debrief_id,
        author_id,
        author_name,
        content,
      })
      .select()
      .single()

    if (error) {
      if (isTableNotFoundError(error)) {
        return NextResponse.json(
          {
            error: "The debrief_comments table does not exist. Please run the migration script.",
          },
          { status: 404 },
        )
      }
      throw error
    }

    return NextResponse.json(data)
  } catch (error: any) {
    if (isTableNotFoundError(error)) {
      return NextResponse.json(
        {
          error: "The debrief_comments table does not exist. Please run the migration script.",
        },
        { status: 404 },
      )
    }
    console.error("Error creating debrief comment:", error)
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 })
  }
}
