"use client"

// "No access" screen — shown when Microsoft sign-in succeeds but the
// person isn't set up as a team_member yet. Authentication worked,
// authorization didn't, so the tone stays calm and welcoming (a new
// colleague, not an intruder): no red, no "denied" language.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Mail, UserCheck } from "lucide-react"

// The signed-in email is a prop in the underlying component below —
// mocked here since this route isn't wired to a session yet.
const MOCK_SIGNED_IN_EMAIL = "jordan.rivera@mottafinancial.com"

const ADMIN_EMAIL = "info@mottafinancial.com"

export default function NoAccessPage() {
  return <NoAccessContent email={MOCK_SIGNED_IN_EMAIL} />
}

function NoAccessContent({ email }: { email: string }) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  const mailtoHref = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(
    `Please add me to the Motta Hub (${email})`,
  )}`

  const handleSwitchAccount = async () => {
    setSigningOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } finally {
      router.push("/login")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#EAE6E1] p-4">
      <div className="w-full max-w-md flex flex-col items-center">
        <Card className="w-full shadow-sm border-0 rounded-xl">
          <CardContent className="pt-8 pb-8">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-[#B5BFA8]/40 flex items-center justify-center">
                <UserCheck className="h-8 w-8 text-[#4A5240]" />
              </div>

              <h1 className="text-2xl font-semibold text-[#2D2D2D] text-balance">
                You&apos;re signed in, but not set up yet
              </h1>

              <p className="text-[#5A5A5A] leading-relaxed text-pretty">
                Your Microsoft account worked fine — an administrator just needs to add you to
                the team before you can use the Hub.
              </p>

              <div className="w-full rounded-lg bg-[#EAE6E1] px-4 py-3">
                <p className="text-xs text-[#6B745D] mb-1">Signed in as</p>
                <p className="font-mono text-sm text-[#4A5240] break-all">{email}</p>
              </div>

              <div className="flex flex-col gap-2 w-full pt-2">
                <Button asChild className="w-full bg-[#6B745D] hover:bg-[#5a6350]">
                  <a href={mailtoHref}>
                    <Mail className="h-4 w-4" />
                    Email an administrator
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-[#6B745D] hover:text-[#4A5240] hover:bg-[#8E9B79]/10"
                  onClick={handleSwitchAccount}
                  disabled={signingOut}
                >
                  {signingOut ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing out...
                    </>
                  ) : (
                    "Sign in with a different account"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-[#8A8A8A] text-center mt-4 text-pretty">
          Think this is a mistake? The fastest fix is asking whoever set up your email.
        </p>
      </div>
    </div>
  )
}
