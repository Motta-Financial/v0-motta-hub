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

  // Supabase sends type=recovery in the query params for password reset
  if (type === "recovery") {
    if (code) {
      // Exchange the code first to establish session
      const supabase = await createClient()
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
      if (exchangeError) {
        return NextResponse.redirect(`${origin}/auth/reset-password?error=invalid_link`)
      }
    }
    return NextResponse.redirect(`${origin}/auth/reset-password`)
  }

  // If no code, redirect to reset-password page for hash-based handling
  if (!code) {
    return NextResponse.redirect(`${origin}/auth/reset-password`)
  }

  // Normal auth flow - exchange code for session
  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (!exchangeError) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
