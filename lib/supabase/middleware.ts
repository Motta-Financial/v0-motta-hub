import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const isLoginPath = request.nextUrl.pathname === '/login'

  // If Supabase env vars are missing, just show login page for everything
  // This prevents redirect loops when Supabase isn't configured
  if (!supabaseUrl || !supabaseAnonKey) {
    // Always allow the login page
    if (isLoginPath) {
      return response
    }
    // For all other paths, redirect to login once
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Paths that don't require auth
  const publicPaths = ['/login', '/auth', '/api/alfred', '/api/dashboard']
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path))

  // Always allow public paths without checking auth
  if (isPublicPath) {
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
  } catch {
    // Auth failed - redirect to login
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If no user, redirect to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
