import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const isLoginPath = request.nextUrl.pathname === '/login'
  const pathname = request.nextUrl.pathname

  console.log("[v0] Middleware running for:", pathname, "| hasSupabaseEnv:", !!supabaseUrl && !!supabaseAnonKey)

  // If Supabase env vars are missing, just pass through - let pages handle auth state
  if (!supabaseUrl || !supabaseAnonKey) {
    console.log("[v0] Supabase env vars missing, passing through")
    return response
  }

  // Paths that don't require auth
  const publicPaths = ['/login', '/auth', '/api/alfred', '/api/dashboard']
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path))

  // Always allow public paths without checking auth
  if (isPublicPath) {
    console.log("[v0] Public path, passing through:", pathname)
    return response
  }

  let supabaseResponse = response
  
  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data?.user
    console.log("[v0] Auth check result - hasUser:", !!user, "path:", pathname)
  } catch (err) {
    // Auth failed - redirect to login
    console.log("[v0] Auth error, redirecting to login:", err)
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If no user, redirect to login
  if (!user) {
    console.log("[v0] No user, redirecting to login from:", pathname)
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  console.log("[v0] User authenticated, allowing access to:", pathname)
  return supabaseResponse
}
