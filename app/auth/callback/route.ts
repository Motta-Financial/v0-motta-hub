import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/"
  const type = searchParams.get("type")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  // Handle error from Supabase
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorDescription || error)}`)
  }

  // If this is a recovery/reset password link (comes with hash fragment, not code)
  // Supabase sends: /auth/callback#access_token=...&type=recovery
  // The hash is not accessible server-side, so we redirect to reset-password page
  // which will handle it client-side
  if (!code) {
    // No code means this might be a hash-based redirect (recovery, etc.)
    // Redirect to reset-password page which will check for hash fragments
    return NextResponse.redirect(`${origin}/auth/reset-password`)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/auth/reset-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
