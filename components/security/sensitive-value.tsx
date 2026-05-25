"use client"

import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

type SensitiveValueProps = {
  /** The raw, sensitive value (e.g. full Tax ID, SSN, account number). */
  value: string | null | undefined
  /**
   * What to show when hidden. Either:
   *  - "mask": render bullets that mirror the value's length (digits only).
   *  - "ssn": render `•••-••-••••`
   *  - "ein": render `••-•••••••`
   *  - "last4": render `•••-••-••••` but reveal last 4 chars even while hidden.
   *  - a custom string: render that exact string.
   * Defaults to "mask".
   */
  hiddenAs?: "mask" | "ssn" | "ein" | "last4" | string
  /** Optional label announced to screen readers, e.g. "Tax ID". */
  label?: string
  /** Auto-hide again after N ms once revealed. Defaults to 15000ms. Pass 0 to disable. */
  autoHideMs?: number
  /** Class applied to the value text. */
  className?: string
  /** Class applied to the wrapping container. */
  wrapperClassName?: string
  /** Size of the eye icon button. Defaults to "xs". */
  buttonSize?: "xs" | "sm"
}

function buildMask(value: string, mode: SensitiveValueProps["hiddenAs"]): string {
  if (mode === "ssn") return "•••-••-••••"
  if (mode === "ein") return "••-•••••••"
  if (mode === "last4") {
    const last4 = value.replace(/\D/g, "").slice(-4) || value.slice(-4)
    return `•••-••-${last4 || "••••"}`
  }
  if (typeof mode === "string" && mode !== "mask") return mode
  // mode === "mask" (default)
  // Mirror length, replace digits/letters with bullets, preserve separators.
  return value.replace(/[A-Za-z0-9]/g, "•")
}

/**
 * Renders sensitive values (Tax IDs, SSNs, EINs, account numbers, etc.) hidden
 * by default behind a mask, with a reveal toggle. Auto-hides after a short
 * delay so PII isn't left on screen.
 */
export function SensitiveValue({
  value,
  hiddenAs = "mask",
  label = "sensitive value",
  autoHideMs = 15000,
  className,
  wrapperClassName,
  buttonSize = "xs",
}: SensitiveValueProps) {
  const [revealed, setRevealed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!revealed || !autoHideMs) return
    timerRef.current = setTimeout(() => setRevealed(false), autoHideMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [revealed, autoHideMs])

  if (!value) return null

  const masked = buildMask(value, hiddenAs)
  const display = revealed ? value : masked

  const iconSize = buttonSize === "sm" ? "h-4 w-4" : "h-3 w-3"
  const buttonClasses =
    buttonSize === "sm"
      ? "h-6 w-6 p-1"
      : "h-5 w-5 p-0.5"

  return (
    <span className={cn("inline-flex items-center gap-1.5", wrapperClassName)}>
      <span
        className={cn("font-mono select-none", className)}
        aria-label={revealed ? `${label}: ${value}` : `${label} (hidden)`}
      >
        {display}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className={cn(
          "inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
          buttonClasses,
        )}
        aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
        aria-pressed={revealed}
        title={revealed ? `Hide ${label}` : `Reveal ${label}`}
      >
        {revealed ? <EyeOff className={iconSize} /> : <Eye className={iconSize} />}
      </button>
    </span>
  )
}
