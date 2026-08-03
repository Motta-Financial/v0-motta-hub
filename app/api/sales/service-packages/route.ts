import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { listActivePackages } from "@/lib/payments/catalog"

export const runtime = "nodejs"

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data, error } = await getAuthenticatedUser(supabase)
    if (error || !data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const packages = await listActivePackages()
    return NextResponse.json({ packages })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
