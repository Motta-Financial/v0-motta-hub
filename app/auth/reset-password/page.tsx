"use client"

import type React from "react"
import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import Image from "next/image"

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#EAE8E1] p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-[#6B745D]" />
                <p className="text-muted-foreground">Loading...</p>
              </div>
            </CardContent>
          </Card>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}

function ResetPasswordContent() {
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

  // Verify the user actually has a recovery-authenticated session.
  // Three legitimate ways to land here:
  //   1. /auth/confirm or /auth/callback already verified the token_hash and
  //      set a session cookie (modern + recommended path) -> getUser() works.
  //   2. A legacy implicit-flow email put the session in a hash fragment
  //      (#access_token=...&type=recovery) -> we have to call setSession()
  //      ourselves before getUser() will succeed.
  //   3. The user is already signed in and just reusing this page from
  //      account settings (uncommon, but supported).
  useEffect(() => {
    let cancelled = false

    async function verify() {
      const supabase = createClient()

      // Path 2: legacy hash fragment.
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
          // Strip the tokens from the URL regardless of result so they don't
          // linger in browser history.
          window.history.replaceState(null, "", window.location.pathname + window.location.search)
          if (cancelled) return
          if (setErr) {
            setError("Your reset link is invalid or has expired. Please request a new one.")
            setIsVerifying(false)
            return
          }
          setSessionReady(true)
          setIsVerifying(false)
          return
        }
      }

      // Path 1 / 3: cookie-based session (set by /auth/confirm or already logged in).
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (cancelled) return

      if (user) {
        setSessionReady(true)
        setIsVerifying(false)
        return
      }

      setError("Your reset link is invalid or has expired. Please request a new one.")
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

  async function handleResetPassword(e: React.FormEvent) {
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
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        setError(error.message)
      } else {
        setSuccess(true)
        // Sign out so the recovery session doesn't leak into a normal session,
        // then send the user to /login to sign in with their new password.
        await supabase.auth.signOut()
        setTimeout(() => {
          router.push("/login?message=password_reset_success")
          router.refresh()
        }, 1500)
      }
    } catch (err) {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#EAE8E1] p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-[#6B745D]" />
              <p className="text-muted-foreground">Verifying your reset link...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!sessionReady && error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#EAE8E1] p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-orange-100 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-orange-600" />
              </div>
              <h2 className="text-2xl font-semibold">Reset Link Invalid</h2>
              <p className="text-muted-foreground">{error}</p>
              <div className="flex flex-col gap-2 w-full pt-2">
                <Button onClick={() => router.push("/login")} className="w-full bg-[#6B745D] hover:bg-[#5a6350]">
                  Request a New Reset Link
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#EAE8E1] p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-semibold">Password Reset Successful</h2>
              <p className="text-muted-foreground">
                Your password has been updated. Redirecting you to sign in...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#EAE8E1] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <Image
              src="/images/alfred-logo.png"
              alt="ALFRED AI Logo"
              width={80}
              height={80}
              className="object-contain"
            />
          </div>
          <div>
            <CardTitle className="text-2xl">{isInvited ? "Welcome to Motta Hub" : "Reset Your Password"}</CardTitle>
            <CardDescription className="mt-2">
              {isInvited
                ? "You've been invited to join Motta Hub. Set your password to get started."
                : "Enter a new password for your Motta Hub account"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="pl-10 pr-10"
                  required
                  autoComplete="new-password"
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

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="pl-10 pr-10"
                  required
                  autoComplete="new-password"
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

            <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
              <p className="text-sm font-medium">Password Requirements:</p>
              <ul className="space-y-1">
                {passwordRequirements.map((req, index) => (
                  <li key={index} className="flex items-center gap-2 text-sm">
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
                  <span className={passwordsMatch ? "text-foreground" : "text-muted-foreground"}>Passwords match</span>
                </li>
              </ul>
            </div>

            <Button
              type="submit"
              className="w-full bg-[#6B745D] hover:bg-[#5a6350]"
              disabled={isLoading || !allRequirementsMet || !passwordsMatch}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating Password...
                </span>
              ) : isInvited ? (
                "Set Password & Get Started"
              ) : (
                "Reset Password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
