"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"

type Props = {
  /** Accessible label / toast text describing what was copied */
  label: string
  /** Whether to render as multi-line <pre> or single-line code */
  multiline?: boolean
  children: string
}

export function CopyBlock({ label, multiline = false, children }: Props) {
  const [copied, setCopied] = useState(false)

  const text = children.toString().trim()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("[v0] Clipboard write failed:", err)
    }
  }

  return (
    <div className="not-prose my-4 overflow-hidden rounded-lg border border-border bg-muted/40">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label} to clipboard`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          disabled={copied}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy
            </>
          )}
        </button>
      </div>
      {multiline ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground">
          {text}
        </pre>
      ) : (
        <div className="px-4 py-3 font-mono text-sm text-foreground">
          {text}
        </div>
      )}
    </div>
  )
}
