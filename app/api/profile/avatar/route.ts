import { type NextRequest, NextResponse } from "next/server"
import { put } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = createAdminClient()
    const formData = await request.formData()
    const file = formData.get("file") as File
    const teamMemberId = formData.get("teamMemberId") as string

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!teamMemberId) {
      return NextResponse.json({ error: "Team member ID is required" }, { status: 400 })
    }

    // Upload to Vercel Blob
    const blob = await put(`avatars/${teamMemberId}-${Date.now()}.${file.name.split(".").pop()}`, file, {
      access: "public",
    })

    // Update team_members table with new avatar URL
    const { error } = await supabaseAdmin
      .from("team_members")
      .update({
        avatar_url: blob.url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", teamMemberId)

    if (error) {
      console.error("Error updating avatar:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, url: blob.url })
  } catch (error) {
    console.error("Avatar upload error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload avatar" },
      { status: 500 },
    )
  }
}
