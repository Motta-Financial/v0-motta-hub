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
  const [error, setError] = useState<string | null>(null)

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
                disabled={isLoading}
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
