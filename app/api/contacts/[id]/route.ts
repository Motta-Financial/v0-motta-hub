import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Minimal contact-detail endpoint used by the prospect form's existing-client
// linker to prefill personal fields when a teammate attaches a prospect to a
// client already in the Hub. Read-only; returns null when not found.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, full_name, primary_email, phone_primary, city, state, zip_code")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ contact: data ?? null })
}
