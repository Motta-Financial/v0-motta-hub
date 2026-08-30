"use client"

/**
 * PreviewFeature — wraps a page or panel that is built but not yet wired to
 * live data. Renders a dismissible, muted-amber notice above the content so
 * reviewers know what they're looking at is sample content, not their
 * account's real data.
 */

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

const BANNER_BG = "#FEF3C7"
const BANNER_BORDER = "#E9D28F"
const BANNER_ICON = "#8A6D1D"
const BANNER_TEXT = "#6B5716"

const DEFAULT_MESSAGE =
  "Preview — this section isn't connected to your account yet. What you see below is sample content."

interface PreviewFeatureProps {
  /** Stable key used to remember dismissal for this section (persisted in localStorage). */
  id: string
  /** Override the default banner copy. */
  message?: string
  /** Render the wrapped content dimmed and non-interactive (pointer events disabled). */
  disableInteraction?: boolean
  className?: string
  children: ReactNode
}

export function PreviewFeature({
  id,
  message = DEFAULT_MESSAGE,
  disableInteraction = false,
  className,
  children,
}: PreviewFeatureProps) {
  const storageKey = `preview-feature-dismissed:${id}`
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "1") {
        setDismissed(true)
      }
    } catch {
      // localStorage unavailable — banner just stays visible
    }
  }, [storageKey])

  function handleDismiss() {
    setDismissed(true)
    try {
      window.localStorage.setItem(storageKey, "1")
    } catch {
      // ignore
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      {!dismissed && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-sm"
          style={{ backgroundColor: BANNER_BG, borderColor: BANNER_BORDER }}
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: BANNER_ICON }}
            aria-hidden="true"
          />
          <p
            className="flex-1 text-sm leading-relaxed"
            style={{ color: BANNER_TEXT }}
          >
            {message}
          </p>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss preview notice"
            className="shrink-0 rounded-md p-1 transition-colors hover:bg-black/5"
            style={{ color: BANNER_ICON }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        className={disableInteraction ? "pointer-events-none opacity-50" : undefined}
        aria-hidden={disableInteraction || undefined}
      >
        {children}
      </div>
    </div>
  )
}
