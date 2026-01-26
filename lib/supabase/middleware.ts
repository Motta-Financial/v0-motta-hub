import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  console.log('[middleware] Path:', request.nextUrl.pathname, '| Has env vars:', !!supabaseUrl && !!supabaseAnonKey)

  // If Supabase env vars are missing, allow access to login page only
  if (!supabaseUrl || !supabaseAnonKey) {
    console.log('[middleware] Missing env vars, redirecting to login')
    if (request.nextUrl.pathname === '/login') {
      return supabaseResponse
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

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

  // Paths that don't require auth
  const publicPaths = ['/login', '/auth', '/api/alfred', '/api/dashboard']
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path))

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data?.user
    console.log('[middleware] User check:', user ? `authenticated (${user.email})` : 'not authenticated', '| isPublicPath:', isPublicPath)
  } catch (error) {
    console.log('[middleware] Auth error:', error, '| isPublicPath:', isPublicPath)
    // Auth failed - allow public paths, redirect others to login
    if (isPublicPath) {
      return supabaseResponse
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (!user && !isPublicPath) {
    console.log('[middleware] No user, redirecting to login')
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect logged in users away from login
  if (user && request.nextUrl.pathname === '/login') {
    console.log('[middleware] User logged in, redirecting away from login')
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  console.log('[middleware] Allowing request through')
  return supabaseResponse
}
