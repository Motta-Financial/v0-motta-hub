"use client"

/**
 * AlfredErrorCard — themed error UI used by every error boundary in the app
 * (app-level `error.tsx`, route-level boundaries, and inline error states
 * inside data-fetching components).
 *
 * The conceit: ALFRED, the firm's AI assistant, is the one reporting the
 * problem to the user. This is friendlier than a stock "Application error"
 * stack trace and gives the team a single, recognizable visual identity for
 * every failure mode (network errors, 404s, 5xx, unexpected client crashes).
 */

import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { ChevronDown, ChevronUp, Home, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface AlfredErrorCardProps {
  /**
   * One-line headline ALFRED says first. Defaults to a polite, generic
   * apology when omitted.
   */
  title?: string
  /**
   * Free-form follow-up sentence ALFRED uses to set context (what the user
   * was trying to do, what went wrong from a high level).
   */
  message?: string
  /**
   * Optional underlying error. The `message` field is shown in a collapsible
   * "Technical details" panel, and the `digest` (Next.js attaches one to
   * every Error in production) is shown as a copy-able support reference.
   */
  error?: Error & { digest?: string }
  /**
   * Called when the user clicks "Try again". Typically the `reset` callback
   * Next.js passes to error boundaries, but any retry handler works.
   */
  onRetry?: () => void
  /**
   * When true, render a Home button alongside Retry. Defaults to true; set
   * to false on top-level boundaries that don't have an obvious "home" link
   * (e.g. inside a modal or panel).
   */
  showHomeLink?: boolean
  /** Optional href for the home button (default: "/") */
  homeHref?: string
  /** Extra classes for the outermost Card */
  className?: string
}

export function AlfredErrorCard({
  title = "ALFRED here — something just went sideways.",
  message,
  error,
  onRetry,
  showHomeLink = true,
  homeHref = "/",
  className,
}: AlfredErrorCardProps) {
  const [showDetails, setShowDetails] = useState(false)
  const detailMessage = error?.message
  const digest = error?.digest

  return (
    <Card className={cn("max-w-2xl mx-auto", className)}>
      <CardContent className="flex flex-col items-center text-center gap-5 p-8 md:p-10">
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-24 w-24 md:h-28 md:w-28">
            <Image
              src="/images/alfred-logo.png"
              alt="ALFRED"
              fill
              priority
              sizes="(min-width: 768px) 7rem, 6rem"
              className="object-contain"
            />
          </div>
          <span className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-muted text-xs font-medium text-muted-foreground tracking-wide uppercase">
            From the desk of ALFRED
          </span>
        </div>

        <div className="flex flex-col gap-2 max-w-prose">
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-balance">
            {title}
          </h2>
          {message ? (
            <p className="text-sm md:text-base text-muted-foreground text-pretty leading-relaxed">
              {message}
            </p>
          ) : (
            <p className="text-sm md:text-base text-muted-foreground text-pretty leading-relaxed">
              I&apos;ve made a note of it. While I look into it, you can try the
              page again or head back to the dashboard.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button onClick={onRetry} size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try again
            </Button>
          ) : null}
          {showHomeLink ? (
            <Button asChild variant="outline" size="sm">
              <Link href={homeHref}>
                <Home className="h-4 w-4 mr-2" />
                Back to dashboard
              </Link>
            </Button>
          ) : null}
        </div>

        {detailMessage || digest ? (
          <div className="w-full mt-2">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetails ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showDetails ? "Hide" : "Show"} technical details
            </button>
            {showDetails ? (
              <div className="mt-3 rounded-md border bg-muted/40 p-3 text-left">
                {detailMessage ? (
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono">
                    {detailMessage}
                  </pre>
                ) : null}
                {digest ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Reference: <code className="font-mono">{digest}</code>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
