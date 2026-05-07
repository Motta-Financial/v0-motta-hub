"use client"

import { useEffect } from "react"

/**
 * Global handler for Supabase auth-callback URLs that land on the wrong page.
 *
 * Background: when an admin clicks "Send password recovery" inside Supabase
 * Studio (or any flow that goes through Supabase's built-in email pipeline),
 * the email's confirmation link sends the user back to the project's
 * configured **Site URL**. Depending on the project's auth-flow type:
 *
 *   • Implicit grant -> URL ends with `#access_token=...&type=recovery&...`
 *   • PKCE grant     -> URL ends with `?code=...`
 *
 * If the project's Site URL is set to the bare domain (e.g.
 * `https://mottahub.com`) instead of `https://mottahub.com/auth/callback`,
 * the user lands at `/` (or, if signed-out, gets bounced to `/login`) and
 * the auth tokens are silently ignored. They appear stranded on the login
 * page even though their reset link was technically valid.
 *
 * This component runs on every route and forwards either format to the
 * correct handler:
 *
 *   • `#type=recovery` / `#type=invite` -> /auth/reset-password (preserves
 *     hash so the page can call `setSession()` from the tokens)
 *   • `?code=...`                       -> /auth/callback (server-side
 *     `exchangeCodeForSession()`)
 *
 * Recommended fix on the Supabase side: set Site URL to
 * `https://<your-domain>/auth/callback` so users land on the right route
 * to begin with. This component is the safety net that makes the app work
 * even when Site URL is misconfigured.
 *
 * Mounted in the root layout so it covers every page (logged in or out).
 */
export function AuthHashForwarder() {
  useEffect(() => {
    if (typeof window === "undefined") return

    const { pathname, hash, search } = window.location

    // Don't forward if we're already on a route that handles auth callbacks.
    // Without this guard, /auth/callback?code=... would re-enter itself and
    // /auth/reset-password#type=recovery would bounce in a loop.
    const isAuthRoute =
      pathname === "/auth/callback" ||
      pathname === "/auth/confirm" ||
      pathname === "/auth/reset-password" ||
      pathname === "/auth/auth-code-error"
    if (isAuthRoute) return

    // 1) Implicit-flow recovery / invite hash fragment.
    if (hash) {
      const hashParams = new URLSearchParams(hash.substring(1))
      const type = hashParams.get("type")
      const accessToken = hashParams.get("access_token")
      if (accessToken && (type === "recovery" || type === "invite")) {
        // Use replace() so the original (now-noise) URL doesn't pollute
        // history -- the back button shouldn't return the user to a page
        // with raw auth tokens in the URL.
        window.location.replace(`/auth/reset-password${hash}`)
        return
      }
    }

    // 2) PKCE-flow code in the query string. Only forward if `code` is the
    //    only signal -- we deliberately don't try to introspect what the
    //    code is for (Supabase doesn't tell us in the URL). If the code
    //    turns out to be invalid or expired, /auth/callback will land the
    //    user on /auth/auth-code-error with a real explanation.
    if (search) {
      const queryParams = new URLSearchParams(search)
      const code = queryParams.get("code")
      // Heuristic: only forward when there's no other auth-relevant query
      // already (e.g. `error`, `error_description`) -- the dedicated
      // /auth/callback already handles those if it sees them.
      if (code && !queryParams.get("error")) {
        const fwd = new URL("/auth/callback", window.location.origin)
        // Preserve the full query string verbatim.
        fwd.search = search
        window.location.replace(fwd.toString())
        return
      }
    }
  }, [])

  return null
}
