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
        // ALFRED mark remain legible. Subtle amber ring keeps the
        // existing brand accent without obscuring the logo.
        aria-label="Open ALFRED"
        className="h-14 w-14 rounded-full bg-white hover:bg-amber-50 ring-1 ring-amber-200 shadow-lg p-0 overflow-hidden"
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
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500"></span>
      </span>
    </div>
  )
}
