import { createClient } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const { debriefId, contactId, organizationId, workItemId } = await request.json()

    if (!debriefId) {
      return NextResponse.json({ error: "Debrief ID is required" }, { status: 400 })
    }

    const updateData: Record<string, string | null> = {}

    if (contactId !== undefined) {
      updateData.contact_id = contactId || null
    }

    if (organizationId !== undefined) {
      updateData.organization_id = organizationId || null
    }

    if (workItemId !== undefined) {
      updateData.work_item_id = workItemId || null
    }

    const { error } = await supabase.from("debriefs").update(updateData).eq("id", debriefId)

    if (error) {
      console.error("Error tagging debrief:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error tagging debrief:", error)
    return NextResponse.json({ error: "Failed to tag debrief" }, { status: 500 })
  }
}
