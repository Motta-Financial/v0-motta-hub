"use client"

import { useState } from "react"
import { CheckCircle2, AlertTriangle, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/**
 * Human-friendly explanations for each error reason emitted by
 * /api/zoom/oauth/callback. When the callback redirects with
 * ?error=<key>, this map drives the banner copy. Anything not in
 * the map falls back to the raw reason so we still see *something*.
 */
const ERROR_COPY: Record<string, { title: string; body: string; nextStep?: string }> = {
  no_team_member_resolved: {
    title: "Couldn't identify your Motta Hub account",
    body:
      "Zoom returned the access code, but the Hub couldn't match the install to a team member. " +
      "This usually means you weren't signed in to motta.cpa in the same browser session " +
      "when you clicked Add to Zoom.",
    nextStep: "Sign in to motta.cpa first, then re-run Add to Zoom from the Marketplace.",
  },
  missing_code: {
    title: "Zoom didn't return an authorization code",
    body: "Zoom redirected back to the Hub without the expected `code` parameter.",
    nextStep: "Try Add to Zoom again from the Marketplace Local Test page.",
  },
  token_exchange_failed: {
    title: "Zoom rejected the token exchange",
    body:
      "Zoom returned an error when the Hub tried to swap the authorization code for an access " +
      "token. The most common causes are a mismatched OAuth Redirect URL, mismatched client " +
      "credentials, or scopes that aren't enabled on the Marketplace app.",
    nextStep: "Check the server log for the exact Zoom error response, then retry.",
  },
  user_info_failed: {
    title: "Zoom rejected the user lookup",
    body:
      "We got an access token but Zoom returned an error when we tried to read the user's profile. " +
      "Usually this means the `user:read:user` scope isn't enabled on the Marketplace app.",
  },
  save_failed: {
    title: "Couldn't save the Zoom connection",
    body: "The OAuth handshake succeeded, but writing the connection to the database failed.",
  },
  server_misconfigured: {
    title: "Server isn't configured for Zoom OAuth",
    body: "ZOOM_CLIENT_ID or ZOOM_CLIENT_SECRET is missing from the server environment.",
  },
  callback_failed: {
    title: "Unexpected error during Zoom install",
    body: "An unhandled exception was thrown inside the callback handler. Check the server log.",
  },
  access_denied: {
    title: "You declined the Zoom permissions request",
    body: "Zoom needs the requested scopes to sync your meetings, recordings, and transcripts.",
    nextStep: "Re-run Add to Zoom and click Allow on the consent screen.",
  },
}

export function ZoomConnectStatusBanner({
  status,
  reason,
}: {
  status: "success" | "error"
  reason?: string
}) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  if (status === "success") {
    return (
      <Alert className="mb-6 border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <AlertTitle className="text-emerald-900 dark:text-emerald-100">
              Zoom connected
            </AlertTitle>
            <AlertDescription className="text-emerald-800 dark:text-emerald-200">
              Your Zoom account is now linked to Motta Hub. Meetings, recordings, and transcripts
              will sync automatically.
            </AlertDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDismissed(true)}
            className="h-7 w-7 shrink-0 text-emerald-900 hover:bg-emerald-100 dark:text-emerald-100 dark:hover:bg-emerald-900"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </Alert>
    )
  }

  const reasonKey = reason ?? "callback_failed"
  const copy = ERROR_COPY[reasonKey] ?? {
    title: "Zoom install failed",
    body: `The callback returned an unrecognized error code: ${reasonKey}`,
  }

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangle className="h-4 w-4" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>{copy.body}</p>
            {copy.nextStep && (
              <p className="font-medium">Next step: {copy.nextStep}</p>
            )}
            <p className="font-mono text-xs opacity-70">error_code: {reasonKey}</p>
          </AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDismissed(true)}
          className="h-7 w-7 shrink-0"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Alert>
  )
}
