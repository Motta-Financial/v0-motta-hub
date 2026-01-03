"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
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
        className="h-14 w-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 shadow-lg"
      >
        <Sparkles className="h-6 w-6 text-white" />
      </Button>
      <span className="absolute -top-1 -right-1 flex h-4 w-4">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500"></span>
      </span>
    </div>
  )
}
