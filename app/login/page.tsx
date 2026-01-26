"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react"

// Detect v0 preview environment - check multiple patterns
const isV0Preview = () => {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  return hostname.includes('vusercontent.net') || 
         hostname.includes('v0.dev') ||
         hostname.includes('vercel.app') ||
         hostname === 'localhost' ||
         hostname.includes('lite.local') ||
         hostname.includes('lite.vusercontent') ||
         hostname.includes('preview')
}

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetEmailSent, setResetEmailSent] = useState(false)
  const [isPreview, setIsPreview] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const preview = isV0Preview()
    setIsPreview(preview)
    const message = searchParams.get("message")
    if (message === "password_reset_success") {
      setSuccessMessage("Your password has been reset successfully. Please sign in with your new password.")
    }
    // In preview mode, show a message that login requires Supabase
    if (preview) {
      setError("Preview mode: Login requires Supabase configuration. Connect Supabase integration to test authentication.")
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

      console.log("[v0] Password reset redirect URL:", redirectUrl)

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
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center relative overflow-hidden">
        {/* Background gradients */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute top-1/4 -left-1/4 w-[600px] h-[600px] bg-gradient-to-r from-[#6B745D]/30 via-[#8E9B79]/20 to-[#6B745D]/30 rounded-full blur-3xl opacity-50"
            style={{ animation: "pulse 8s ease-in-out infinite" }}
          />
          <div
            className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-gradient-to-r from-[#8E9B79]/20 via-[#6B745D]/15 to-[#8E9B79]/20 rounded-full blur-3xl opacity-50"
            style={{ animation: "pulse 8s ease-in-out infinite 2s" }}
          />
        </div>

        <div className="relative z-10 w-full max-w-md mx-4">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] rounded-2xl blur opacity-20" />
          <div className="relative bg-[#12121a]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl text-center">
            <div className="h-16 w-16 rounded-full bg-[#8E9B79]/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="h-8 w-8 text-[#8E9B79]" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Check Your Email</h2>
            <p className="text-gray-400 mb-6">
              We've sent a password reset link to <span className="text-white font-medium">{email}</span>
            </p>
            <p className="text-gray-500 text-sm mb-6">
              Click the link in the email to reset your password. If you don't see it, check your spam folder.
            </p>
            <Button
              onClick={() => {
                setShowForgotPassword(false)
                setResetEmailSent(false)
                setEmail("")
              }}
              variant="outline"
              className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10"
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
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center relative overflow-hidden">
        {/* Background gradients */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute top-1/4 -left-1/4 w-[600px] h-[600px] bg-gradient-to-r from-[#6B745D]/30 via-[#8E9B79]/20 to-[#6B745D]/30 rounded-full blur-3xl opacity-50"
            style={{ animation: "pulse 8s ease-in-out infinite" }}
          />
          <div
            className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-gradient-to-r from-[#8E9B79]/20 via-[#6B745D]/15 to-[#8E9B79]/20 rounded-full blur-3xl opacity-50"
            style={{ animation: "pulse 8s ease-in-out infinite 2s" }}
          />
        </div>

        <div className="relative z-10 w-full max-w-md mx-4">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] rounded-2xl blur opacity-20" />
          <div className="relative bg-[#12121a]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
            <div className="text-center mb-8">
              <div className="relative inline-flex items-center justify-center mb-6">
                <img src="/images/alfred-logo.png" alt="ALFRED AI" className="relative h-20 w-auto" />
              </div>
              <h1 className="text-xl font-bold text-white mb-2">Reset Password</h1>
              <p className="text-gray-400 text-sm">Enter your email to receive a reset link</p>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="reset-email" className="text-gray-300 text-sm font-medium">
                  Email Address
                </Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@motta.cpa"
                  required
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-[#8E9B79]/50 focus:ring-[#8E9B79]/20 h-11"
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
                className="w-full text-gray-400 hover:text-white hover:bg-white/5"
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
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center relative overflow-hidden">
      {/* Animated background gradients - reduced animation intensity */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute top-1/4 -left-1/4 w-[600px] h-[600px] bg-gradient-to-r from-[#6B745D]/30 via-[#8E9B79]/20 to-[#6B745D]/30 rounded-full blur-3xl opacity-50"
          style={{ animation: "pulse 8s ease-in-out infinite" }}
        />
        <div
          className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-gradient-to-r from-[#8E9B79]/20 via-[#6B745D]/15 to-[#8E9B79]/20 rounded-full blur-3xl opacity-50"
          style={{ animation: "pulse 8s ease-in-out infinite 2s" }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-[#6B745D]/10 via-transparent to-[#8E9B79]/10 rounded-full blur-3xl" />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: "50px 50px",
          }}
        />
      </div>

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] rounded-2xl blur opacity-20" />

        <div className="relative bg-[#12121a]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="relative inline-flex items-center justify-center mb-6">
              <div
                className="absolute inset-0 w-32 h-32 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] rounded-full blur-xl opacity-30"
                style={{ animation: "pulse 4s ease-in-out infinite" }}
              />
              <img src="/images/alfred-logo.png" alt="ALFRED AI" className="relative h-28 w-auto" />
            </div>

            {/* Title - updated branding */}
            <h1 className="text-2xl font-bold text-white mb-2">
              <span className="bg-gradient-to-r from-[#8E9B79] via-white to-[#8E9B79] bg-clip-text text-transparent">
                ALFRED AI
              </span>
            </h1>
            <p className="text-gray-400 text-sm">Motta Hub Portal</p>
          </div>

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-5">
            {successMessage && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300 text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@motta.cpa"
                required
                className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-[#8E9B79]/50 focus:ring-[#8E9B79]/20 h-11"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-gray-300 text-sm font-medium">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-xs text-[#8E9B79] hover:text-[#a8b596] transition-colors"
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
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-[#8E9B79]/50 focus:ring-[#8E9B79]/20 h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-gradient-to-r from-[#6B745D] via-[#8E9B79] to-[#6B745D] hover:from-[#5a6350] hover:via-[#7d8a6a] hover:to-[#5a6350] text-white font-medium rounded-lg transition-all duration-300 shadow-lg shadow-[#6B745D]/25 hover:shadow-[#6B745D]/40 disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="mt-8 pt-6 border-t border-white/10 text-center">
            <p className="text-gray-500 text-xs">Motta Financial Group &copy; {new Date().getFullYear()}</p>
            <p className="text-gray-600 text-xs mt-1">Powered by ALFRED AI</p>
          </div>
        </div>
      </div>
    </div>
  )
}
