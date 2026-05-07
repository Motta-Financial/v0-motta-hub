import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface PageProps {
  searchParams: Promise<{ reason?: string }>
}

const FRIENDLY_REASONS: Record<string, string> = {
  missing_params: "The reset link is incomplete. Please request a new one.",
  expired:
    "This reset link has expired. Reset links are valid for 1 hour for your security.",
  used: "This reset link has already been used. Please request a new one if you still need to reset your password.",
  invalid: "This reset link is invalid. Please request a new one.",
}

function humanize(raw?: string) {
  if (!raw) return "We couldn't verify your reset link. Please request a new one."
  const lower = raw.toLowerCase()
  if (lower.includes("expired")) return FRIENDLY_REASONS.expired
  if (lower.includes("used") || lower.includes("already")) return FRIENDLY_REASONS.used
  if (lower.includes("invalid") || lower.includes("not found")) return FRIENDLY_REASONS.invalid
  if (FRIENDLY_REASONS[raw]) return FRIENDLY_REASONS[raw]
  return raw
}

export default async function AuthCodeErrorPage({ searchParams }: PageProps) {
  const { reason } = await searchParams
  const message = humanize(reason)

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#EAE8E1] p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-orange-100 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-orange-600" />
            </div>
            <h1 className="text-2xl font-semibold text-[#2D2D2D]">Reset Link Issue</h1>
            <p className="text-[#5A5A5A] leading-relaxed">{message}</p>
            <div className="flex flex-col gap-2 w-full pt-2">
              <Button asChild className="w-full bg-[#6B745D] hover:bg-[#5a6350]">
                <Link href="/login">Request a New Reset Link</Link>
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link href="/login">Back to Sign In</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
