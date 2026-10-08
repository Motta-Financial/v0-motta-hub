"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, AlertCircle } from "lucide-react"

export default function PortalLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogleSignIn() {
    setError(null)
    setIsGoogleLoading(true)

    try {
      const supabase = createClient()
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/client-portal`,
        },
      })

      if (oauthError) {
        setError(oauthError.message)
        setIsGoogleLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Google sign-in. Please try again.")
      setIsGoogleLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError("Invalid email or password. Please try again.")
        return
      }

      // Verify they have a portal_users row (not just any Supabase user)
      const { data: portalUser, error: portalError } = await supabase
        .from("portal_users")
        .select("id, is_active")
        .eq("email", email)
        .maybeSingle()

      if (portalError || !portalUser) {
        await supabase.auth.signOut()
        setError("This account does not have client portal access. Please contact your Motta Financial advisor.")
        return
      }

      if (!portalUser.is_active) {
        await supabase.auth.signOut()
        setError("Your portal access has been deactivated. Please contact your Motta Financial advisor.")
        return
      }

      router.push("/client-portal")
      router.refresh()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "#EAE6E1" }}
    >
      <div className="w-full max-w-md">
        {/* Logo / branding */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <img
            src="/images/alfred-logo.png"
            alt="Motta Financial"
            className="h-14 w-auto"
          />
          <div className="text-center">
            <p className="text-lg font-bold tracking-wide" style={{ color: "#6B745D" }}>
              CLIENT PORTAL
            </p>
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              Motta Financial
            </p>
          </div>
        </div>

        <Card className="shadow-sm border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>
              Access your tax documents, work status, and team messages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              className="w-full bg-white"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
            >
              {isGoogleLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening Google…
                </>
              ) : (
                <>
                  <svg
                    className="mr-2 h-4 w-4"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  Continue with Google
                </>
              )}
            </Button>

            <div className="my-5 flex items-center gap-3" role="separator" aria-label="or use a password">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs uppercase tracking-wider text-gray-500">or use a password</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={isLoading}
                />
              </div>

              <Button
                type="submit"
                className="w-full text-white"
                style={{ backgroundColor: "#6B745D" }}
                disabled={isLoading || isGoogleLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-gray-500 leading-relaxed">
              Don&apos;t have access?{" "}
              <a
                href="mailto:info@mottafinancial.com"
                className="underline underline-offset-2"
                style={{ color: "#6B745D" }}
              >
                Contact your advisor
              </a>{" "}
              to request an invitation.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
