"use client"

import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Video, Calendar, FileVideo, Sparkles, ArrowRight } from "lucide-react"

interface ZoomConnectPromptProps {
  /**
   * The team member id to associate the Zoom connection with.
   * If unavailable (e.g. session not loaded yet), the button is disabled.
   */
  teamMemberId: string | null | undefined
}

/**
 * Prominent CTA shown at the top of /zoom when the signed-in team member
 * has not yet authorized the Hub against their personal Zoom account.
 *
 * Once connected, the dashboard hides this card and renders the team
 * calendar, recordings, and call history pulled from the user's own Zoom
 * data via /api/zoom/oauth/authorize -> /api/zoom/oauth/callback.
 */
export function ZoomConnectPrompt({ teamMemberId }: ZoomConnectPromptProps) {
  const handleConnect = () => {
    if (!teamMemberId) return
    window.location.href = `/api/zoom/oauth/authorize?team_member_id=${teamMemberId}`
  }

  return (
    <Card className="overflow-hidden border-2">
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
        {/* Left: copy + CTA */}
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              One-time setup
            </span>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Connect your Zoom account
            </h2>
            <p className="text-pretty leading-relaxed text-muted-foreground">
              Link your personal Zoom account to Motta Hub so your meetings, recordings,
              and call history stay in sync alongside the rest of your work.
            </p>
          </div>

          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <Calendar className="h-4 w-4" />
              </span>
              <div>
                <p className="font-medium leading-tight">Team calendar in one place</p>
                <p className="leading-snug text-muted-foreground">
                  See every team member&apos;s scheduled meetings without switching tabs.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <FileVideo className="h-4 w-4" />
              </span>
              <div>
                <p className="font-medium leading-tight">Recordings & transcripts archived</p>
                <p className="leading-snug text-muted-foreground">
                  Cloud recordings appear in the Hub automatically after every call.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <Video className="h-4 w-4" />
              </span>
              <div>
                <p className="font-medium leading-tight">Read-only access</p>
                <p className="leading-snug text-muted-foreground">
                  The Hub never creates, edits, or deletes Zoom resources on your behalf.
                </p>
              </div>
            </li>
          </ul>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              size="lg"
              onClick={handleConnect}
              disabled={!teamMemberId}
              className="w-full sm:w-auto"
            >
              Connect Zoom
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full sm:w-auto">
              <Link href="/docs/zoom-integration">Learn how it works</Link>
            </Button>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            You&apos;ll be redirected to Zoom to authorize Motta Hub. By continuing you agree
            to the Hub&apos;s{" "}
            <Link href="/legal/terms" className="underline underline-offset-2 hover:text-foreground">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        {/* Right: visual sidebar */}
        <div
          aria-hidden="true"
          className="relative hidden border-l bg-muted/40 lg:flex lg:flex-col lg:justify-between lg:p-8"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Video className="h-6 w-6 text-primary" />
            </div>
            <div className="text-sm">
              <p className="font-semibold leading-tight">Zoom + Motta Hub</p>
              <p className="leading-tight text-muted-foreground">Read-only sync</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border bg-background p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Today</span>
                <span>9:30 AM</span>
              </div>
              <p className="text-sm font-medium leading-tight">Daily Huddle</p>
              <p className="text-xs leading-snug text-muted-foreground">1h · Hosted by you</p>
            </div>

            <div className="rounded-lg border bg-background p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Yesterday</span>
                <span>Recording</span>
              </div>
              <p className="text-sm font-medium leading-tight">Client Onboarding · Smith LLC</p>
              <p className="text-xs leading-snug text-muted-foreground">42m · Transcript ready</p>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Disconnect anytime from Zoom Settings or the Hub&apos;s settings menu.
          </p>
        </div>
      </div>
    </Card>
  )
}
