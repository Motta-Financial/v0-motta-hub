import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createAdminClient()
    const { id } = params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // "contact" or "organization"

    let client = null

    // Try to find as contact first
    if (!type || type === "contact") {
      const { data: contact } = await supabase
        .from("contacts")
        .select("*")
        .or(`id.eq.${id},karbon_contact_key.eq.${id}`)
        .single()

      if (contact) {
        // Fetch related work items
        const { data: workItems } = await supabase
          .from("work_items")
          .select("*")
          .eq("contact_id", contact.id)
          .order("due_date", { ascending: true })
          .limit(20)

        client = {
          ...contact,
          type: "Contact",
          work_items: workItems || [],
        }
      }
    }

    // Try to find as organization if not found or type is organization
    if (!client && (!type || type === "organization")) {
      const { data: org } = await supabase
        .from("organizations")
        .select("*")
        .or(`id.eq.${id},karbon_organization_key.eq.${id}`)
        .single()

      if (org) {
        // Fetch related work items
        const { data: workItems } = await supabase
          .from("work_items")
          .select("*")
          .eq("organization_id", org.id)
          .order("due_date", { ascending: true })
          .limit(20)

        client = {
          ...org,
          type: "Organization",
          work_items: workItems || [],
        }
      }
    }

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    return NextResponse.json({ client })
  } catch (error) {
    console.error("Error fetching client:", error)
    return NextResponse.json({ error: "Failed to fetch client" }, { status: 500 })
  }
}
