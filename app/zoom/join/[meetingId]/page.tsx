"use client"

/**
 * /zoom/join/[meetingId]
 *
 * Joins a live Zoom meeting inside ALFRED Hub using the Meeting SDK for Web —
 * Client View (Zoom's full native meeting UI takes over the page).
 *
 * Flow:
 *   1. Fetch join-info (meeting number, passcode, display name) — auth-gated.
 *   2. Fetch a short-lived SDK signature — auth-gated; signed server-side.
 *   3. Dynamically import ZoomMtg (it touches `window`, so client-only),
 *      preLoadWasm → prepareWebSDK → init → join.
 *   4. On leave, Zoom redirects the browser to `leaveUrl` (back into the Hub).
 *
 * Until the two Meeting SDK env vars exist the signature endpoint returns 503
 * and we render a clear "not configured yet" state instead of failing opaquely.
 */

import { useEffect, useRef, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { Loader2, VideoOff, AlertTriangle, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

type Phase = "preparing" | "joining" | "in-meeting" | "not-configured" | "error"

export default function ZoomJoinPage() {
  const params = useParams<{ meetingId: string }>()
  const search = useSearchParams()
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>("preparing")
  const [message, setMessage] = useState<string>("Preparing the meeting…")
  const [topic, setTopic] = useState<string | null>(null)
  // Guard against React StrictMode double-invocation of the join effect.
  const startedRef = useRef(false)

  const meetingId = String(params?.meetingId ?? "").replace(/\D/g, "")
  // Where to send the user back to when they leave the meeting.
  const returnTo = search.get("return") || "/deals"

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    let cancelled = false

    async function start() {
      if (!meetingId) {
        setPhase("error")
        setMessage("This link is missing a valid Zoom meeting number.")
        return
      }

      try {
        // 1. Resolve meeting details (passcode stays server-side until here).
        const infoRes = await fetch(`/api/zoom/meetings/${meetingId}/join-info`, {
          cache: "no-store",
        })
        if (infoRes.status === 401) {
          setPhase("error")
          setMessage("Please sign in to ALFRED Hub to join this meeting.")
          return
        }
        const info = await infoRes.json()
        if (cancelled) return
        setTopic(info?.topic ?? null)

        // 2. Mint the SDK signature.
        const sigRes = await fetch("/api/zoom/meeting-sdk/signature", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingNumber: meetingId, role: 0 }),
        })
        if (sigRes.status === 503) {
          setPhase("not-configured")
          return
        }
        if (!sigRes.ok) {
          setPhase("error")
          setMessage("Could not authorize the meeting join. Please try again.")
          return
        }
        const { signature, sdkKey } = await sigRes.json()
        if (cancelled) return

        // 3. Load the Client View SDK (client-only — it references `window`).
        setPhase("joining")
        setMessage("Connecting to Zoom…")
        const { ZoomMtg } = await import("@zoom/meetingsdk")
        ZoomMtg.preLoadWasm()
        ZoomMtg.prepareWebSDK()

        const leaveUrl = `${window.location.origin}${returnTo}`

        ZoomMtg.init({
          leaveUrl,
          patchJsMedia: true,
          leaveOnPageUnload: true,
          success: () => {
            // Reveal Zoom's full-page UI (hidden by default).
            const root = document.getElementById("zmmtg-root")
            if (root) root.style.display = "block"

            ZoomMtg.join({
              signature,
              sdkKey,
              meetingNumber: meetingId,
              userName: info?.displayName || "ALFRED Hub",
              userEmail: "",
              passWord: info?.passcode || "",
              success: () => {
                if (!cancelled) setPhase("in-meeting")
              },
              error: (err: unknown) => {
                console.log("[v0] Zoom join error:", err)
                if (cancelled) return
                setPhase("error")
                setMessage("Zoom would not let us into this meeting. It may not have started yet.")
              },
            })
          },
          error: (err: unknown) => {
            console.log("[v0] Zoom init error:", err)
            if (cancelled) return
            setPhase("error")
            setMessage("Failed to initialize the Zoom meeting client.")
          },
        })
      } catch (err) {
        console.log("[v0] Zoom join setup failed:", err)
        if (cancelled) return
        setPhase("error")
        setMessage("Something went wrong getting the meeting ready.")
      }
    }

    void start()

    return () => {
      cancelled = true
    }
  }, [meetingId, returnTo])

  // Once Zoom's UI is up it owns the screen; render nothing over it.
  if (phase === "in-meeting") return null

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        {(phase === "preparing" || phase === "joining") && (
          <>
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
            </div>
            <h1 className="text-balance text-lg font-semibold text-card-foreground">
              {topic ? `Joining "${topic}"` : "Joining meeting"}
            </h1>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{message}</p>
          </>
        )}

        {phase === "not-configured" && (
          <>
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <VideoOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h1 className="text-balance text-lg font-semibold text-card-foreground">
              Meeting join isn&apos;t set up yet
            </h1>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
              In-Hub Zoom joining needs the Meeting SDK credentials
              {" "}
              (<code className="rounded bg-muted px-1 py-0.5 text-xs">ZOOM_MEETING_SDK_KEY</code> and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">ZOOM_MEETING_SDK_SECRET</code>). Once an admin
              adds them, this page goes live with no further changes.
            </p>
            <Button variant="outline" className="mt-6" onClick={() => router.push(returnTo)}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to the Hub
            </Button>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
            </div>
            <h1 className="text-balance text-lg font-semibold text-card-foreground">Couldn&apos;t join the meeting</h1>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{message}</p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="outline" onClick={() => router.push(returnTo)}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                Back
              </Button>
              <Button onClick={() => window.location.reload()}>Try again</Button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
