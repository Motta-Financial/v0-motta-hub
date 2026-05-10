"use client"

import { useState } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { AlfredChat } from "./alfred-chat"

export function AlfredChatTrigger() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)

  const handleOpen = () => {
    setIsOpen(true)
    setIsMinimized(false)
  }

  const handleClose = () => {
    setIsOpen(false)
    setIsMinimized(false)
  }

  const handleMinimize = () => {
    setIsMinimized(!isMinimized)
  }

  if (isOpen) {
    return <AlfredChat isOpen={isOpen} onClose={handleClose} onMinimize={handleMinimize} isMinimized={isMinimized} />
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Button
        onClick={handleOpen}
        // Cream-white pill so the dark "ai" + green sphere of the new
        // ALFRED mark remain legible. The ring + hover tint pull from
        // the olive-green of the sphere so the launcher reads as part
        // of the same brand system instead of a generic amber accent.
        aria-label="Open ALFRED"
        className="h-14 w-14 rounded-full bg-white hover:bg-[#F5F6E8] ring-1 ring-[#C4CB8B] shadow-lg p-0 overflow-hidden"
      >
        <Image
          src="/images/alfred-logo.png"
          alt=""
          width={48}
          height={48}
          priority
          className="object-contain"
        />
      </Button>
      <span className="absolute -top-1 -right-1 flex h-4 w-4">
        {/* Pulsing dot uses the exact olive of the brand sphere; the
            inner solid is shifted darker so it stays visible at the
            tail end of the ping animation when the outer is fading. */}
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#9CA757] opacity-75"></span>
        <span className="relative inline-flex rounded-full h-4 w-4 bg-[#7E8845]"></span>
      </span>
    </div>
  )
}
