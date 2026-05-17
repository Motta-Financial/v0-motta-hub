"use client"

// Branding: MOTTA HUB headline + Motta lotus logo, "Powered by ALFRED AI"
// as the secondary tagline; footer is "Motta Financial © 2023". This
// replaced the prior ALFRED-led branding.

import type React from "react"

import { Suspense, useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { clearUserCache } from "@/contexts/user-context"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react"

/**
 * Brand panel used on the left half of the login, forgot-password, and
 * reset-confirmation screens (desktop only — hidden below lg). All three
 * screens share this so the auth flow feels like one continuous surface
 * with only the right-hand form swapping in and out.
 *
 * Visuals:
 *   - Dark olive vertical gradient using the brand's primary (#6B745D)
 *     anchored by a slightly darker shade so the white logo + headline
 *     read with confident contrast.
 *   - A very low-opacity radial dot pattern provides texture without
 *     being noisy (the prior design relied on four bright blurry blobs
 *     that fought with the form for attention).
 *   - Two soft sage glows in opposite corners that breathe slowly via
 *     the existing `pulse` keyframes. Modern auth screens use one or
 *     two of these, far apart, slow-moving — not a busy lava-lamp wall.
 */
function BrandPanel() {
  return (
    <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-[#6B745D] via-[#5a6350] to-[#454d3c]">
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div
        className="absolute -top-40 -left-40 w-[520px] h-[520px] bg-[#8E9B79]/25 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "pulse 10s ease-in-out infinite" }}
      />
      <div
        className="absolute -bottom-40 -right-40 w-[480px] h-[480px] bg-[#8E9B79]/15 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "pulse 10s ease-in-out infinite 3s" }}
      />

      <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full text-white">
        {/* Top: the Motta logo, inverted to pure white so the lotus
            silhouette stays legible against the dark olive backdrop. */}
        <div className="flex items-center gap-3">
          <img
            src="/images/motta-logo.png"
            alt="Motta"
            className="h-14 w-auto brightness-0 invert opacity-90"
            suppressHydrationWarning
          />
        </div>

        {/* Middle: confident statement headline + secondary line. The
            cream-tinted highlight on "Motta Financial" mirrors the page
            background and ties the two halves of the screen together. */}
        <div className="space-y-5 max-w-md">
          <h2 className="text-4xl xl:text-5xl font-semibold tracking-tight leading-[1.1] text-balance">
            The operating system for{" "}
            <span className="text-[#D4D9C9]">Motta Financial</span>.
          </h2>
          <p className="text-base text-white/70 leading-relaxed text-pretty">
            One place for clients, work, and the team. Powered by ALFRED AI.
          </p>
        </div>

        {/* Bottom: brand footer + internal-use marker. */}
        <div className="flex items-center justify-between text-xs text-white/50">
          <span suppressHydrationWarning>Motta Financial &copy; 2023</span>
          <span>Internal use only</span>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#EAE8E1] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#6B745D]" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetEmailSent, setResetEmailSent] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Recovery / invite hash-fragment forwarder.
    //
    // When an admin clicks "Send password recovery" inside Supabase Studio
    // (or anywhere else that uses Supabase's built-in email pipeline), the
    // emailed link sends the user back to the project's configured Site URL
    // with a `#access_token=...&type=recovery` hash fragment.
    //
    // Hash fragments aren't sent to the server, so our middleware sees no
    // session cookie on the request, redirects to /login, and the user is
    // stranded with their recovery tokens parked in the URL fragment of the
    // login page. We rescue them here by forwarding to /auth/reset-password
    // with the fragment intact -- that page knows how to call setSession()
    // from a hash and then prompt for a new password.
    if (typeof window !== "undefined" && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const hashType = hashParams.get("type")
      const accessToken = hashParams.get("access_token")
      if (accessToken && (hashType === "recovery" || hashType === "invite")) {
        window.location.replace(`/auth/reset-password${window.location.hash}`)
        return
      }
    }

    // Purge any stale Supabase session state BEFORE the GoTrue client
    // gets a chance to act on it.
    //
    // Why this exists at all:
    //   Users who reach /login almost always have a broken auth state
    //   to clean up -- session expired, kicked by deactivation, came
    //   from a crashed tab, etc. If we don't clean it up here, the
    //   stale state causes two distinct failure modes:
    //
    //   1. The signed-out user lands on /login with leftover tokens
    //      in their browser. The GoTrue client mounts, sees them, and
    //      fires POST /token grant_type=refresh_token. With invalid
    //      tokens that returns 400, which the client retries on a
    //      backoff -- pegging the per-IP rate-limit bucket and
    //      blocking other users on the same NAT from signing in.
    //
    //   2. The "Signing in..." spinner hangs forever. @supabase/ssr's
    //      auth client uses the Web Locks API to serialize concurrent
    //      auth operations across tabs/workers. If a prior tab
    //      crashed mid-operation (or the dashboard force-terminated a
    //      session) the lock can be left in a "held but unreleasable"
    //      state for this origin. The next signInWithPassword() then
    //      awaits a lock that will never resolve and the UI freezes.
    //      Incognito doesn't share locks/cookies with the main
    //      profile, which is exactly why incognito sign-in works
    //      when the regular browser doesn't.
    //
    // What to clean up:
    //   @supabase/ssr v0.8 stores the session in COOKIES on the
    //   document (key: sb-<project-ref>-auth-token, plus chunked
    //   `.0` / `.1` variants for large JWTs). It may *also* mirror
    //   into localStorage. So we have to wipe both. Cookies are the
    //   important one -- localStorage alone is not enough, and that
    //   was the bug in the prior version of this purge.
    if (typeof window !== "undefined") {
      try {
        // 1. Wipe matching localStorage keys.
        const lsKeys: string[] = []
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i)
          if (key && key.startsWith("sb-") && key.includes("-auth-token")) {
            lsKeys.push(key)
          }
        }
        lsKeys.forEach((k) => window.localStorage.removeItem(k))

        // 2. Wipe matching sessionStorage keys (some @supabase/ssr
        //    builds and PKCE flows park transient state here).
        try {
          const ssKeys: string[] = []
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const key = window.sessionStorage.key(i)
            if (key && key.startsWith("sb-")) {
              ssKeys.push(key)
            }
          }
          ssKeys.forEach((k) => window.sessionStorage.removeItem(k))
        } catch {
          // ignore
        }

        // 3. Wipe sb-* cookies on the current origin. THIS is the one
        //    that actually unsticks the spinner-hang case.
        //
        //    document.cookie can only see/clear cookies that match
        //    the current path+domain visibility, but @supabase/ssr
        //    writes its cookies at Path=/ with no special Domain, so
        //    a same-origin overwrite to expire=Thu, 01 Jan 1970 is
        //    sufficient. We also clear at a couple of common
        //    Domain= scopings in case Vercel preview/prod set them
        //    on the apex.
        const expire = "; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"
        const host = window.location.hostname
        const apex = host.split(".").slice(-2).join(".") // e.g. mottafinancial.com
        document.cookie.split(";").forEach((rawCookie) => {
          const eq = rawCookie.indexOf("=")
          const name = (eq > -1 ? rawCookie.substring(0, eq) : rawCookie).trim()
          if (!name.startsWith("sb-")) return
          // No domain (default — what @supabase/ssr writes)
          document.cookie = `${name}=${expire}`
          // Current host
          document.cookie = `${name}=${expire}; domain=${host}`
          // Apex (covers cases where the cookie was written with a
          // leading-dot apex domain by another auth helper)
          if (apex && apex !== host) {
            document.cookie = `${name}=${expire}; domain=.${apex}`
          }
        })
      } catch {
        // Storage may be unavailable (private mode, disabled cookies,
        // odd extension sandbox). Not fatal -- the user can still
        // attempt sign-in; if it hangs, the safety timeout in
        // handleLogin will surface a clear error.
      }
    }

    const message = searchParams.get("message")
    if (message === "password_reset_success") {
      setSuccessMessage("Your password has been reset successfully. Please sign in with your new password.")
    } else if (message === "password_changed") {
      // Set by /settings/profile after a successful in-app password
      // change. The profile route signs the user out server-side and
      // sends them here so the post-update flow is one clean sign-in
      // instead of a cascade of stale-token refreshes.
      setSuccessMessage("Your password has been updated. Please sign in again with your new password.")
    }

    // Set by middleware when an active session belongs to a team_member that
    // has been marked is_active=false (e.g. an alum whose session cookie is
    // still valid). The middleware already calls supabase.auth.signOut() and
    // redirects here, so we just need to surface the reason.
    const reason = searchParams.get("reason")
    if (reason === "deactivated") {
      setError("Your account has been deactivated. Please contact an administrator.")
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // Safety timeout. @supabase/ssr uses the Web Locks API to
      // serialize auth operations across tabs. If a prior tab left a
      // lock in a non-releasable state, signInWithPassword() can hang
      // forever awaiting it -- the user just sees "Signing in..."
      // spin indefinitely with no error to act on. We race the
      // sign-in against a 15s timeout so the failure surfaces as a
      // recoverable error message with a clear recovery hint
      // ("clear site data" or "try incognito"). 15s is comfortably
      // above any real-world signInWithPassword latency (<2s).
      const TIMEOUT_MS = 15_000
      const signInPromise = supabase.auth.signInWithPassword({ email, password })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Sign-in timed out. This usually means your browser has stale session data. Please open Developer Tools → Application → Clear site data, or try an incognito window.",
              ),
            ),
          TIMEOUT_MS,
        ),
      )
      const { data: authData, error: authError } = (await Promise.race([
        signInPromise,
        timeoutPromise,
      ])) as Awaited<typeof signInPromise>

      if (authError) {
        // GoTrue's per-IP request limiter fires when an IP makes too
        // many auth requests in a short window (Supabase Cloud default
        // is ~30 requests / 5 min). When several team members share an
        // office NAT or someone is mashing the sign-in button, the
        // raw "Request rate limit reached" message reads like a bug.
        // Surface a friendlier explanation + cooldown instead.
        const msg = authError.message || ""
        const isRateLimit =
          /rate limit/i.test(msg) ||
          (authError as { status?: number }).status === 429
        if (isRateLimit) {
          setError(
            "Too many sign-in attempts from this network. Please wait a few minutes and try again. If this keeps happening, contact an administrator.",
          )
        } else {
          setError(msg)
        }
        setIsLoading(false)
        return
      }

      const { data: teamMember, error: teamError } = await supabase
        .from("team_members")
        .select("id, full_name, is_active, auth_user_id")
        .eq("auth_user_id", authData.user.id)
        .single()

      if (teamError || !teamMember) {
        await supabase.auth.signOut()
        setError("Access denied. You are not registered as a Motta team member.")
        setIsLoading(false)
        return
      }

      if (!teamMember.is_active) {
        await supabase.auth.signOut()
        setError("Your account has been deactivated. Please contact an administrator.")
        setIsLoading(false)
        return
      }

      // Clear the UserContext cache before navigating so the dashboard
      // picks up the new session immediately. The onAuthStateChange
      // listener in UserProvider will also fire SIGNED_IN, which
      // triggers its own refetch — so by the time we land on "/", the
      // user data is already on its way.
      //
      // We deliberately do NOT call router.refresh() after the push.
      // In App Router, router.push() to a different route ALREADY does
      // a fresh server render of the destination with the latest
      // cookies. Adding refresh() forces the same SSR work to happen a
      // second time and BLOCKS the UI transition while it runs — that
      // single line was adding ~500ms–2s to perceived sign-in time,
      // which is exactly what users were reporting as "slow login".
      clearUserCache()

      // Honor a ?redirect= param when it points to a trusted motta.cpa
      // host. This is what alfred.motta.cpa relies on to bounce users
      // back after sign-in, since auth cookies are scoped to the apex
      // domain. Anything off-host (or malformed) silently falls back
      // to "/" so this can't be abused as an open redirect.
      const redirectParam = searchParams.get("redirect")
      let safeRedirect: string | null = null
      if (redirectParam) {
        try {
          const candidate = new URL(redirectParam)
          const host = candidate.hostname.toLowerCase()
          if (
            candidate.protocol === "https:" &&
            (host === "motta.cpa" || host.endsWith(".motta.cpa"))
          ) {
            safeRedirect = candidate.toString()
          }
        } catch {
          // Invalid URL -- ignore and use the default below.
        }
      }
      if (safeRedirect) {
        // Use a full-page navigation so the destination origin
        // (e.g. alfred.motta.cpa) re-runs its middleware against the
        // freshly-set, .motta.cpa-scoped auth cookies.
        window.location.assign(safeRedirect)
      } else {
        router.push("/")
      }
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("Unable to connect. Please check your internet connection.")
      } else if (err instanceof Error && err.message.startsWith("Sign-in timed out")) {
        // Surface the timeout message verbatim -- it contains the
        // actionable recovery hint (clear site data / incognito).
        setError(err.message)
      } else {
        setError("An unexpected error occurred. Please try again.")
      }
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (!email) {
      setError("Please enter your email address")
      setIsLoading(false)
      return
    }

    try {
      // Hit our server-side endpoint instead of supabase.auth.resetPasswordForEmail.
      // The server uses Resend + admin.generateLink so the email is delivered
      // reliably and the recovery link uses our own /auth/confirm verifier
      // (no PKCE code-verifier dependency, works across devices).
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data?.error || "Unable to send reset link. Please try again.")
        return
      }

      setResetEmailSent(true)
    } catch (err) {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (resetEmailSent) {
    return (
      <div className="min-h-screen flex bg-[#EAE8E1]" suppressHydrationWarning>
        <BrandPanel />

        <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12 relative overflow-hidden">
          {/* Mobile-only ambient glow -- desktop hands all atmospheric
              color over to the brand panel so the form side stays calm. */}
          <div className="lg:hidden absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-[#8E9B79]/20 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-sm relative z-10 text-center">
            <div className="h-14 w-14 rounded-full bg-[#8E9B79]/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="h-7 w-7 text-[#6B745D]" />
            </div>
            <h1 className="text-2xl font-semibold text-[#2D2D2D] tracking-tight mb-2">
              Check your email
            </h1>
            <p className="text-sm text-[#5A5A5A] mb-2">
              {"We've sent a password reset link to"}
            </p>
            <p className="text-sm text-[#2D2D2D] font-medium mb-6 break-all">
              {email}
            </p>
            <p className="text-xs text-[#7A7A7A] mb-8 leading-relaxed">
              {"Click the link in the email to reset your password. If you don't see it, check your spam folder."}
            </p>
            <Button
              onClick={() => {
                setShowForgotPassword(false)
                setResetEmailSent(false)
                setEmail("")
              }}
              variant="outline"
              className="w-full h-11 bg-white border-[#6B745D]/20 text-[#2D2D2D] hover:bg-[#6B745D]/5 rounded-lg"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to sign in
            </Button>

            <p className="lg:hidden text-center text-xs text-[#AAAAAA] mt-10" suppressHydrationWarning>
              Motta Financial &copy; 2023
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (showForgotPassword) {
    return (
      <div className="min-h-screen flex bg-[#EAE8E1]" suppressHydrationWarning>
        <BrandPanel />

        <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12 relative overflow-hidden">
          <div className="lg:hidden absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-[#8E9B79]/20 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-sm relative z-10">
            {/* Mobile-only logo -- desktop already shows it in BrandPanel. */}
            <div className="lg:hidden flex justify-center mb-10">
              <img
                src="/images/motta-logo.png"
                alt="Motta"
                className="h-16 w-auto"
                suppressHydrationWarning
              />
            </div>

            <div className="mb-8">
              <h1 className="text-2xl font-semibold text-[#2D2D2D] tracking-tight">
                Reset your password
              </h1>
              <p className="text-sm text-[#7A7A7A] mt-2">
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-5">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-lg text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="reset-email" className="text-[#4A4A4A] text-sm font-medium">
                  Email address
                </Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@motta.cpa"
                  required
                  className="bg-white border-[#6B745D]/15 text-[#2D2D2D] placeholder:text-[#AAAAAA] focus-visible:border-[#6B745D] focus-visible:ring-2 focus-visible:ring-[#6B745D]/15 h-11 rounded-lg transition-colors"
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-[#6B745D] hover:bg-[#5a6350] text-white font-medium rounded-lg transition-all shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </span>
                ) : (
                  "Send reset link"
                )}
              </Button>

              <Button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false)
                  setError(null)
                }}
                variant="ghost"
                className="w-full h-10 text-[#5A5A5A] hover:text-[#2D2D2D] hover:bg-[#6B745D]/5 rounded-lg"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to sign in
              </Button>
            </form>

            <p className="lg:hidden text-center text-xs text-[#AAAAAA] mt-10" suppressHydrationWarning>
              Motta Financial &copy; 2023
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-[#EAE8E1]" suppressHydrationWarning>
      <BrandPanel />

      {/* Form panel -- on desktop this is the right half; on mobile it
          spans the full screen and gets its own subtle ambient color
          since the brand panel is hidden. */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12 relative overflow-hidden">
        <div className="lg:hidden absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-[#8E9B79]/20 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-sm relative z-10">
          {/* Mobile-only logo. On desktop the brand panel already
              shows the wordmark so a second copy on the form side
              would compete with the headline. */}
          <div className="lg:hidden flex justify-center mb-10">
            <img
              src="/images/motta-logo.png"
              alt="Motta"
              className="h-20 w-auto"
              suppressHydrationWarning
            />
          </div>

          {/* Left-aligned heading -- modern auth forms drop the
              centered-title-and-tagline stack in favor of a confident
              left-aligned greeting that sits flush with the inputs. */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-[#2D2D2D] tracking-tight">
              Sign in to <span suppressHydrationWarning>Motta Hub</span>
            </h1>
            <p className="text-sm text-[#7A7A7A] mt-2" suppressHydrationWarning>
              Welcome back. Powered by ALFRED AI.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {successMessage && (
              <div className="flex items-start gap-2 p-3 bg-[#8E9B79]/10 border border-[#8E9B79]/30 rounded-lg text-[#4d5544] text-sm">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{successMessage}</span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-lg text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[#4A4A4A] text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@motta.cpa"
                required
                className="bg-white border-[#6B745D]/15 text-[#2D2D2D] placeholder:text-[#AAAAAA] focus-visible:border-[#6B745D] focus-visible:ring-2 focus-visible:ring-[#6B745D]/15 h-11 rounded-lg transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[#4A4A4A] text-sm font-medium">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-xs font-medium text-[#6B745D] hover:text-[#8E9B79] transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="bg-white border-[#6B745D]/15 text-[#2D2D2D] placeholder:text-[#AAAAAA] focus-visible:border-[#6B745D] focus-visible:ring-2 focus-visible:ring-[#6B745D]/15 h-11 rounded-lg pr-10 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] hover:text-[#5A5A5A] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Flat solid-olive button -- the gradient-on-gradient stack
                of the old design (gradient text, gradient blur halo,
                gradient button background) is exactly the kind of
                "everything is shiny" treatment that dates a UI. A flat
                brand-color button with a tight hover state reads as
                modern and lets the headline carry the brand color. */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-[#6B745D] hover:bg-[#5a6350] text-white font-medium rounded-lg transition-all shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          {/* Mobile footer -- desktop pins this to the bottom of the
              brand panel instead. */}
          <p className="lg:hidden text-center text-xs text-[#AAAAAA] mt-10" suppressHydrationWarning>
            Motta Financial &copy; 2023
          </p>
        </div>
      </div>
    </div>
  )
}
