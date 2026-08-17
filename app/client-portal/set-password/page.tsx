"use client"

import type React from "react"
import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"

/**
 * Client-portal equivalent of /auth/reset-password. Deliberately a separate
 * page (not the Hub's) because Hub staff and portal clients are different
 * Supabase auth users living in the same project — sending a client here
 * keeps the "Motta Hub" staff branding out of a client-facing screen and
 * lets us route the final redirect at /client-portal instead of /login.
 *
 * Reached from the invite email link: /auth/confirm verifies the token_hash
 * and sets a session cookie, then redirects to
 * /client-portal/set-password?invited=true. This route lives OUTSIDE the
 * (portal) route group's guarded layout — landing here happens BEFORE the
 * portal_users row necessarily has a usable password, so it must not be
 * gated by requirePortalAuth().
 */
export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#EAE6E1" }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#6B745D" }} />
        </div>
      }
    >
      <SetPasswordContent />
    </Suspense>
  )
}

function SetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isInvited = searchParams.get("invited") === "true"

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isVerifying, setIsVerifying] = useState(true)
  const [sessionReady, setSessionReady] = useState(false)

  // Same three legitimate arrival paths as the Hub's reset-password page:
  // cookie session from /auth/confirm, legacy hash-fragment tokens, or an
  // already-signed-in client revisiting this page.
  useEffect(() => {
    let cancelled = false

    async function verify() {
      const supabase = createClient()

      if (typeof window !== "undefined" && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const accessToken = hashParams.get("access_token")
        const refreshToken = hashParams.get("refresh_token")
        const hashType = hashParams.get("type")

        if (accessToken && (hashType === "recovery" || hashType === "invite")) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || "",
          })
          window.history.replaceState(null, "", window.location.pathname + window.location.search)
          if (cancelled) return
          if (setErr) {
            setError("Your invite link is invalid or has expired. Please contact your Motta Financial advisor.")
            setIsVerifying(false)
            return
          }
          setSessionReady(true)
          setIsVerifying(false)
          return
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (cancelled) return

      if (user) {
        setSessionReady(true)
        setIsVerifying(false)
        return
      }

      setError("Your invite link is invalid or has expired. Please contact your Motta Financial advisor.")
      setIsVerifying(false)
    }

    verify()
    return () => {
      cancelled = true
    }
  }, [])

  const passwordRequirements = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "Contains uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Contains lowercase letter", met: /[a-z]/.test(password) },
    { label: "Contains a number", met: /[0-9]/.test(password) },
  ]

  const allRequirementsMet = passwordRequirements.every((req) => req.met)
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!allRequirementsMet) {
      setError("Please meet all password requirements")
      return
    }
    if (!passwordsMatch) {
      setError("Passwords do not match")
      return
    }

    setIsLoading(true)
    try {
      const supabase = createClient()
      const { error: updateErr } = await supabase.auth.updateUser({ password })

      if (updateErr) {
        setError(updateErr.message)
        return
      }

      setSuccess(true)
      // Unlike the Hub flow, keep the session — the portal has no separate
      // "log back in" step, so send them straight into the portal.
      setTimeout(() => {
        router.push("/client-portal")
        router.refresh()
      }, 1200)
    } catch {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#EAE6E1" }}>
        <Card className="w-full max-w-md shadow-sm border-0">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#6B745D" }} />
              <p className="text-muted-foreground">Verifying your invite link...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!sessionReady && error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#EAE6E1" }}>
        <Card className="w-full max-w-md shadow-sm border-0">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="h-16 w-16 rounded-full bg-orange-100 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-orange-600" />
              </div>
              <h2 className="text-2xl font-semibold">Invite Link Invalid</h2>
              <p className="text-muted-foreground">{error}</p>
              <Button
                onClick={() => router.push("/client-portal/login")}
                className="w-full text-white"
                style={{ backgroundColor: "#6B745D" }}
              >
                Go to Sign In
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#EAE6E1" }}>
        <Card className="w-full max-w-md shadow-sm border-0">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-semibold">You&apos;re All Set</h2>
              <p className="text-muted-foreground">Taking you to your client portal...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#EAE6E1" }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 gap-3">
          <img src="/images/alfred-logo.png" alt="Motta Financial" className="h-14 w-auto" />
          <div className="text-center">
            <p className="text-lg font-bold tracking-wide" style={{ color: "#6B745D" }}>
              CLIENT PORTAL
            </p>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Motta Financial</p>
          </div>
        </div>

        <Card className="shadow-sm border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">{isInvited ? "Welcome" : "Set Your Password"}</CardTitle>
            <CardDescription>
              {isInvited
                ? "You've been invited to the Motta Financial client portal. Set a password to get started."
                : "Choose a new password for your client portal account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSetPassword} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter a password"
                    className="pl-10 pr-10"
                    required
                    autoComplete="new-password"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    className="pl-10 pr-10"
                    required
                    autoComplete="new-password"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2 p-3 rounded-lg" style={{ backgroundColor: "#F4F2EE" }}>
                <p className="text-sm font-medium">Password requirements:</p>
                <ul className="space-y-1">
                  {passwordRequirements.map((req) => (
                    <li key={req.label} className="flex items-center gap-2 text-sm">
                      <div
                        className={`h-4 w-4 rounded-full flex items-center justify-center ${
                          req.met ? "bg-green-500" : "bg-muted-foreground/30"
                        }`}
                      >
                        {req.met && <CheckCircle2 className="h-3 w-3 text-white" />}
                      </div>
                      <span className={req.met ? "text-foreground" : "text-muted-foreground"}>{req.label}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 text-sm">
                    <div
                      className={`h-4 w-4 rounded-full flex items-center justify-center ${
                        passwordsMatch ? "bg-green-500" : "bg-muted-foreground/30"
                      }`}
                    >
                      {passwordsMatch && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </div>
                    <span className={passwordsMatch ? "text-foreground" : "text-muted-foreground"}>
                      Passwords match
                    </span>
                  </li>
                </ul>
              </div>

              <Button
                type="submit"
                className="w-full text-white"
                style={{ backgroundColor: "#6B745D" }}
                disabled={isLoading || !allRequirementsMet || !passwordsMatch}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting password…
                  </>
                ) : isInvited ? (
                  "Set Password & Get Started"
                ) : (
                  "Set Password"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
