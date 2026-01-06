import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    // Fetch contacts
    const { data: contacts, error: contactsError } = await supabase
      .from("contacts")
      .select("id, full_name")
      .eq("status", "Active")
      .order("full_name")
      .limit(100)

    if (contactsError) {
      console.error("Error fetching contacts:", contactsError)
    }

    // Fetch organizations
    const { data: orgs, error: orgsError } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name")
      .limit(100)

    if (orgsError) {
      console.error("Error fetching organizations:", orgsError)
    }

    // Fetch active work items
    const { data: workItems, error: workItemsError } = await supabase
      .from("work_items")
      .select("id, title, karbon_work_item_key")
      .not("status", "eq", "Completed")
      .order("title")
      .limit(100)

    if (workItemsError) {
      console.error("Error fetching work items:", workItemsError)
    }

    const clients = [
      ...(contacts?.map((c) => ({ id: c.id, name: c.full_name || "Unknown", type: "contact" as const })) || []),
      ...(orgs?.map((o) => ({ id: o.id, name: o.name || "Unknown", type: "organization" as const })) || []),
    ].sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({
      clients,
      workItems: workItems || [],
    })
  } catch (error) {
    console.error("Error fetching clients and work items:", error)
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 })
  }
}
