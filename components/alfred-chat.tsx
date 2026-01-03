"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  Sparkles,
  Send,
  X,
  Minimize2,
  Loader2,
  User,
  Bot,
  Database,
  Search,
  Calendar,
  Users,
  FileText,
  DollarSign,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface AlfredChatProps {
  isOpen: boolean
  onClose: () => void
  onMinimize?: () => void
  isMinimized?: boolean
  className?: string
}

const suggestedQueries = [
  { icon: Users, text: "Show team workload", query: "What's the current workload for each team member?" },
  { icon: Calendar, text: "Upcoming deadlines", query: "What work items are due in the next 7 days?" },
  { icon: Search, text: "Find a client", query: "Search for client " },
  { icon: FileText, text: "Recent debriefs", query: "Show me recent client debriefs from this week" },
  { icon: DollarSign, text: "Financial summary", query: "What's our current financial summary?" },
  { icon: Database, text: "Work items by status", query: "Summarize work items by status" },
]

export function AlfredChat({ isOpen, onClose, onMinimize, isMinimized, className }: AlfredChatProps) {
  const [inputValue, setInputValue] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/alfred/chat" }),
  })

  const isLoading = status === "streaming" || status === "submitted"

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen, isMinimized])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || isLoading) return

    sendMessage({ text: inputValue })
    setInputValue("")
  }

  const handleSuggestionClick = (query: string) => {
    if (query.endsWith(" ")) {
      // This is a partial query, put it in the input
      setInputValue(query)
      inputRef.current?.focus()
    } else {
      // This is a complete query, send it
      sendMessage({ text: query })
    }
  }

  if (!isOpen) return null

  if (isMinimized) {
    return (
      <div className={cn("fixed bottom-4 right-4 z-50", className)}>
        <Button
          onClick={onMinimize}
          className="h-14 w-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 shadow-lg"
        >
          <Sparkles className="h-6 w-6 text-white" />
        </Button>
        {messages.length > 0 && (
          <Badge className="absolute -top-1 -right-1 bg-red-500 text-white text-xs">
            {messages.filter((m) => m.role === "assistant").length}
          </Badge>
        )}
      </div>
    )
  }

  return (
    <Card
      className={cn(
        "fixed bottom-4 right-4 z-50 w-[420px] h-[600px] flex flex-col shadow-2xl border-amber-200/50",
        className,
      )}
    >
      {/* Header */}
      <CardHeader className="flex flex-row items-center justify-between py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-t-lg">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">ALFRED AI</CardTitle>
            <p className="text-xs text-amber-100">Motta Hub Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={onMinimize}>
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="space-y-4">
              <div className="text-center py-6">
                <div className="h-16 w-16 mx-auto rounded-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center mb-4">
                  <Sparkles className="h-8 w-8 text-amber-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Hello! I'm ALFRED</h3>
                <p className="text-sm text-gray-500 mt-1">Your AI assistant with access to all Motta Hub data</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Try asking about:</p>
                <div className="grid grid-cols-2 gap-2">
                  {suggestedQueries.map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestionClick(suggestion.query)}
                      className="flex items-center gap-2 p-2 text-left text-sm rounded-lg border border-gray-200 hover:bg-amber-50 hover:border-amber-200 transition-colors"
                    >
                      <suggestion.icon className="h-4 w-4 text-amber-600 flex-shrink-0" />
                      <span className="text-gray-700 truncate">{suggestion.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}
                >
                  {message.role === "assistant" && (
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2",
                      message.role === "user" ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-900",
                    )}
                  >
                    {message.parts.map((part, index) => {
                      if (part.type === "text") {
                        return (
                          <div key={index} className="text-sm whitespace-pre-wrap">
                            {part.text}
                          </div>
                        )
                      }
                      // Handle tool calls
                      if (part.type && part.type.startsWith("tool-")) {
                        const toolName = part.type.replace("tool-", "")
                        return (
                          <div key={index} className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                            <Database className="h-3 w-3" />
                            <span>Querying {toolName}...</span>
                          </div>
                        )
                      }
                      return null
                    })}
                  </div>
                  {message.role === "user" && (
                    <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-gray-600" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3 justify-start">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="bg-gray-100 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                      <span className="text-sm text-gray-500">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
                  Error: {error.message || "Something went wrong"}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>

      {/* Input */}
      <div className="p-4 border-t">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask ALFRED anything..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || !inputValue.trim()} className="bg-amber-500 hover:bg-amber-600">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </Card>
  )
}
