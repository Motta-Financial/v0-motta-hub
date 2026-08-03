"use client"

import { useState } from "react"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { AlfredChat } from "./alfred-chat"

export function AlfredChatTrigger() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const pathname = usePathname()

  const handleOpen = () => {
    setIsOpen(true)
    setIsMinimized(false)
  }

  const handleClose = () => {
    setIsOpen(false)
    setIsMinimized(false)
    setIsExpanded(false)
  }

  const handleMinimize = () => {
    setIsMinimized(!isMinimized)
  }

  // Pop the conversation out into a dedicated, resizable browser window
  // pointed at the standalone /alfred route. We close the inline widget
  // so the user isn't talking to two ALFRED surfaces at once.
  const handleOpenInNewWindow = () => {
    window.open(
      "/alfred",
      "alfred-chat",
      "width=480,height=720,menubar=no,toolbar=no,location=no,status=no",
    )
    handleClose()
  }

  // The standalone /alfred page already renders a full-page chat, so the
  // global floating launcher would be redundant (and would overlap the
  // pop-out window's own UI). Hide it there.
  if (pathname === "/alfred") return null

  if (isOpen) {
    return (
      <AlfredChat
        isOpen={isOpen}
        onClose={handleClose}
        onMinimize={handleMinimize}
        isMinimized={isMinimized}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded((v) => !v)}
        onOpenInNewWindow={handleOpenInNewWindow}
      />
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Button
        onClick={handleOpen}
        // Cream-white pill that hosts the ALFRED mark. The breathing
        // olive halo behind the logo (alfred-halo keyframe) gives the
        // launcher its "Ai is awake" vibe — same motion vocabulary as
        // the in-chat orb so the two surfaces read as one product.
        aria-label="Open ALFRED"
        className="h-14 w-14 rounded-full bg-white hover:bg-[#F5F6E8] ring-1 ring-[#C4CB8B] shadow-lg p-0 overflow-hidden relative"
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-full animate-alfred-halo"
          style={{
            background:
              "radial-gradient(circle at 50% 45%, rgba(156,167,87,0.45) 0%, rgba(196,203,139,0) 65%)",
          }}
        />
        <Image
          src="/images/alfred-logo.png"
          alt=""
          width={48}
          height={48}
          priority
          className="object-contain relative z-10"
        />
      </Button>
      <span className="absolute -top-1 -right-1 flex h-4 w-4 pointer-events-none">
        {/* Pulsing presence dot uses the exact olive of the brand
            sphere; the inner solid is shifted darker so it stays
            visible at the tail end of the ping animation when the
            outer is fading. */}
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#9CA757] opacity-75"></span>
        <span className="relative inline-flex rounded-full h-4 w-4 bg-[#7E8845]"></span>
      </span>
    </div>
  )
}
