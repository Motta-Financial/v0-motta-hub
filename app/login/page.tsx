"use client"

import type React from "react"

import { Suspense, useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react"

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
    const message = searchParams.get("message")
    if (message === "password_reset_success") {
      setSuccessMessage("Your password has been reset successfully. Please sign in with your new password.")
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setError(authError.message)
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

      router.push("/")
      router.refresh()
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("Unable to connect. Please check your internet connection.")
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
      const supabase = createClient()
      const redirectUrl = `${window.location.origin}/auth/callback?type=recovery`

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      })

      if (error) {
        setError(error.message)
      } else {
        setResetEmailSent(true)
      }
    } catch (err) {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (resetEmailSent) {
    return (
      <div className="min-h-screen bg-[#EAE8E1] flex items-center justify-center relative overflow-hidden">
        {/* Background gradients */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute top-1/4 -left-1/4 w-[600px] h-[600px] bg-gradient-to-r from-[#6B745D]/15 via-[#8E9B79]/10 to-[#6B745D]/15 rounded-full blur-3xl opacity-50"
            style={{ animation: "pulse 8s ease-in-out infinite" }}
          />
          <div
            className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-gradient-to-r from-[#8E9B79]/10 via-[#6B745D]/10 to-[#8E9B79]/10 rounded-full blur-3xl opacity-50"
            style={{ animation: "pulse 8s ease-in-out infinite 2s" }}
          />
        </div>

        <div className="relative z-10 w-full max-w-md mx-4">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] rounded-2xl blur opacity-10" />
          <div className="relative bg-white/80 backdrop-blur-xl border border-[#6B745D]/10 rounded-2xl p-8 shadow-xl text-center">
            <div className="h-16 w-16 rounded-full bg-[#8E9B79]/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="h-8 w-8 text-[#6B745D]" />
            </div>
            <h2 className="text-xl font-semibold text-[#2D2D2D] mb-2">Check Your Email</h2>
            <p className="text-[#5A5A5A] mb-6">
              {"We've sent a password reset link to "}<span className="text-[#2D2D2D] font-medium">{email}</span>
            </p>
            <p className="text-[#7A7A7A] text-sm mb-6">
              {"Click the link in the email to reset your password. If you don't see it, check your spam folder."}
            </p>
            <Button
              onClick={() => {
                setShowForgotPassword(false)
                setResetEmailSent(false)
                setEmail("")
              }}
              variant="outline"
              className="w-full bg-white border-[#6B745D]/20 text-[#2D2D2D] hover:bg-[#6B745D]/5"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Sign In
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (showForgotPassword) {
    return (
      <div className="min-h-screen bg-[#EAE8E1] flex items-center justify-center relative overflow-hidden">
        {/* Background gradients */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute top-1/4 -left-1/4 w-[600px] h-[600px] bg-gradient-to-r from-[#6B745D]/15 via-[#8E9B79]/10 to-[#6B745D]/15 rounded-full blur-3xl opacity-50"
            style={{ animation: "pulse 8s ease-in-out infinite" }}
          />
          <div
            className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-gradient-to-r from-[#8E9B79]/10 via-[#6B745D]/10 to-[#8E9B79]/10 rounded-full blur-3xl opacity-50"
            style={{ animation: "pulse 8s ease-in-out infinite 2s" }}
          />
        </div>

        <div className="relative z-10 w-full max-w-md mx-4">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] rounded-2xl blur opacity-10" />
          <div className="relative bg-white/80 backdrop-blur-xl border border-[#6B745D]/10 rounded-2xl p-8 shadow-xl">
            <div className="text-center mb-8">
              <div className="relative inline-flex items-center justify-center mb-6">
                <img src="/images/alfred-logo.png" alt="ALFRED AI" className="relative h-20 w-auto" />
              </div>
              <h1 className="text-xl font-bold text-[#2D2D2D] mb-2">Reset Password</h1>
              <p className="text-[#7A7A7A] text-sm">Enter your email to receive a reset link</p>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="reset-email" className="text-[#4A4A4A] text-sm font-medium">
                  Email Address
                </Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@motta.cpa"
                  required
                  className="bg-white border-[#6B745D]/20 text-[#2D2D2D] placeholder:text-[#AAAAAA] focus:border-[#6B745D]/50 focus:ring-[#6B745D]/20 h-11"
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] hover:from-[#5a6350] hover:via-[#7d8a6a] hover:to-[#5a6350] text-white font-medium rounded-lg transition-all duration-300"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </span>
                ) : (
                  "Send Reset Link"
                )}
              </Button>

              <Button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false)
                  setError(null)
                }}
                variant="ghost"
                className="w-full text-[#5A5A5A] hover:text-[#2D2D2D] hover:bg-[#6B745D]/5"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Sign In
              </Button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#EAE8E1] flex items-center justify-center relative overflow-hidden">
      {/* Subtle background gradients */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute top-1/4 -left-1/4 w-[600px] h-[600px] bg-gradient-to-r from-[#6B745D]/15 via-[#8E9B79]/10 to-[#6B745D]/15 rounded-full blur-3xl opacity-50"
          style={{ animation: "pulse 8s ease-in-out infinite" }}
        />
        <div
          className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-gradient-to-r from-[#8E9B79]/10 via-[#6B745D]/10 to-[#8E9B79]/10 rounded-full blur-3xl opacity-50"
          style={{ animation: "pulse 8s ease-in-out infinite 2s" }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-[#6B745D]/5 via-transparent to-[#8E9B79]/5 rounded-full blur-3xl" />
      </div>

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] rounded-2xl blur opacity-10" />

        <div className="relative bg-white/80 backdrop-blur-xl border border-[#6B745D]/10 rounded-2xl p-8 shadow-xl">
          <div className="text-center mb-8">
            <div className="relative inline-flex items-center justify-center mb-6">
              <div
                className="absolute inset-0 w-32 h-32 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] rounded-full blur-xl opacity-15"
                style={{ animation: "pulse 4s ease-in-out infinite" }}
              />
              <img src="/images/alfred-logo.png" alt="ALFRED AI" className="relative h-28 w-auto" />
            </div>

            {/* Title - updated branding */}
            <h1 className="text-2xl font-bold text-[#2D2D2D] mb-2">
              <span className="bg-gradient-to-r from-[#6B745D] via-[#4A4A4A] to-[#6B745D] bg-clip-text text-transparent">
                ALFRED AI
              </span>
            </h1>
            <p className="text-[#7A7A7A] text-sm">Motta Hub Portal</p>
          </div>

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-5">
            {successMessage && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-700 text-sm">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
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
                className="bg-white border-[#6B745D]/20 text-[#2D2D2D] placeholder:text-[#AAAAAA] focus:border-[#6B745D]/50 focus:ring-[#6B745D]/20 h-11"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[#4A4A4A] text-sm font-medium">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-xs text-[#6B745D] hover:text-[#8E9B79] transition-colors"
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
                  className="bg-white border-[#6B745D]/20 text-[#2D2D2D] placeholder:text-[#AAAAAA] focus:border-[#6B745D]/50 focus:ring-[#6B745D]/20 h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] hover:text-[#5A5A5A] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] hover:from-[#5a6350] hover:via-[#7d8a6a] hover:to-[#5a6350] text-white font-medium rounded-lg transition-all duration-300 shadow-lg shadow-[#6B745D]/20 hover:shadow-[#6B745D]/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-[#6B745D]/10 text-center">
            <p className="text-[#7A7A7A] text-xs">Motta Financial Group &copy; {new Date().getFullYear()}</p>
            <p className="text-[#AAAAAA] text-xs mt-1">Powered by ALFRED AI</p>
          </div>
        </div>
      </div>
    </div>
  )
}
