"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Send, X, Minimize2, Sparkles, Lightbulb, TrendingUp } from "lucide-react"
import Image from "next/image"

interface Message {
  id: string
  type: "user" | "assistant"
  content: string
  timestamp: Date
  suggestions?: string[]
}

const quickActions = [
  { label: "Client Summary", icon: TrendingUp },
  { label: "Task Insights", icon: Lightbulb },
  { label: "Schedule Review", icon: Sparkles },
]

export function AlfredChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content:
        "Hello! I'm ALFRED, your AI assistant. I can help you with client insights, task automation, scheduling, and workflow optimization. What would you like to work on today?",
      timestamp: new Date(),
      suggestions: ["Show client priorities", "Review pending tasks", "Optimize my schedule"],
    },
  ])
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)

  const handleSendMessage = async (message?: string) => {
    const messageText = message || inputValue
    if (!messageText.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: messageText,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsTyping(true)

    // Simulate AI response with contextual suggestions
    setTimeout(() => {
      const responses = [
        {
          content:
            "I've analyzed your current workload. Here are some insights: You have 3 high-priority clients requiring attention this week, and I've identified 2 workflow optimizations that could save you 4 hours.",
          suggestions: ["View client details", "Apply optimizations", "Schedule follow-ups"],
        },
        {
          content:
            "Based on your recent activity, I recommend prioritizing the Johnson account review and scheduling the Miller consultation. Would you like me to block time on your calendar?",
          suggestions: ["Block calendar time", "Send client reminders", "Prepare meeting notes"],
        },
        {
          content:
            "I notice you have several pending document reviews. I can help prioritize them by deadline and client importance. Shall I create an action plan?",
          suggestions: ["Create action plan", "Set reminders", "Delegate tasks"],
        },
      ]

      const randomResponse = responses[Math.floor(Math.random() * responses.length)]
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: randomResponse.content,
        timestamp: new Date(),
        suggestions: randomResponse.suggestions,
      }
      setMessages((prev) => [...prev, aiResponse])
      setIsTyping(false)
    }, 1500)
  }

  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
          <Button
            onClick={() => setIsOpen(true)}
            className="h-16 w-16 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            style={{ backgroundColor: "#6B745D" }}
          >
            <Image
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ALFRED%20Ai-vu0KAQ4ZR1fBs564bL8SLnRp5atDeW.png"
              alt="ALFRED AI"
              width={32}
              height={32}
              className="h-8 w-8"
            />
          </Button>
          <Badge className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs px-2 py-1 animate-pulse">
            23
          </Badge>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Card
        className={`bg-white shadow-2xl transition-all duration-300 ${isMinimized ? "h-16" : "h-[500px] w-96"}`}
        style={{ borderColor: "#8E9B79" }}
      >
        <CardHeader
          className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 py-3 border-b"
          style={{ borderColor: "#8E9B79", backgroundColor: "#6B745D" }}
        >
          <CardTitle className="text-sm font-semibold text-white flex items-center">
            <Image
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ALFRED%20Ai-vu0KAQ4ZR1fBs564bL8SLnRp5atDeW.png"
              alt="ALFRED AI"
              width={24}
              height={24}
              className="h-6 w-6 mr-2"
            />
            ALFRED AI Assistant
          </CardTitle>
          <div className="flex items-center space-x-1">
            <Badge className="bg-green-100 text-green-700 text-xs px-2 py-1">Online</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMinimized(!isMinimized)}
              className="h-6 w-6 p-0 text-white hover:bg-white/20"
            >
              <Minimize2 className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="h-6 w-6 p-0 text-white hover:bg-white/20"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>

        {!isMinimized && (
          <CardContent className="flex flex-col h-[440px] p-0">
            <div className="p-3 border-b" style={{ borderColor: "#8E9B79", backgroundColor: "#EAE6E1" }}>
              <div className="flex gap-2">
                {quickActions.map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    className="text-xs flex items-center gap-1 bg-transparent"
                    onClick={() => handleSendMessage(action.label)}
                    style={{ borderColor: "#8E9B79", color: "#333333" }}
                  >
                    <action.icon className="h-3 w-3" />
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>

            <ScrollArea className="flex-1 p-3">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`flex items-start space-x-2 max-w-[85%]`}>
                      {message.type === "assistant" && (
                        <Avatar className="h-8 w-8 mt-1">
                          <AvatarFallback style={{ backgroundColor: "#6B745D" }}>
                            <Image
                              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ALFRED%20Ai-vu0KAQ4ZR1fBs564bL8SLnRp5atDeW.png"
                              alt="ALFRED"
                              width={16}
                              height={16}
                              className="h-4 w-4"
                            />
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="space-y-2">
                        <div
                          className={`rounded-lg px-3 py-2 text-sm ${
                            message.type === "user" ? "text-white" : "bg-gray-50 text-gray-900"
                          }`}
                          style={{
                            backgroundColor: message.type === "user" ? "#6B745D" : "#EAE6E1",
                          }}
                        >
                          <p>{message.content}</p>
                        </div>
                        {message.suggestions && (
                          <div className="flex flex-wrap gap-1">
                            {message.suggestions.map((suggestion, index) => (
                              <Button
                                key={index}
                                variant="outline"
                                size="sm"
                                className="text-xs h-6 px-2 bg-transparent"
                                onClick={() => handleSendMessage(suggestion)}
                                style={{ borderColor: "#8E9B79", color: "#333333" }}
                              >
                                {suggestion}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="flex items-start space-x-2">
                      <Avatar className="h-8 w-8 mt-1">
                        <AvatarFallback style={{ backgroundColor: "#6B745D" }}>
                          <Image
                            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ALFRED%20Ai-vu0KAQ4ZR1fBs564bL8SLnRp5atDeW.png"
                            alt="ALFRED"
                            width={16}
                            height={16}
                            className="h-4 w-4"
                          />
                        </AvatarFallback>
                      </Avatar>
                      <div className="rounded-lg px-3 py-2" style={{ backgroundColor: "#EAE6E1" }}>
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "#6B745D" }} />
                          <div
                            className="w-2 h-2 rounded-full animate-bounce"
                            style={{ backgroundColor: "#6B745D", animationDelay: "0.1s" }}
                          />
                          <div
                            className="w-2 h-2 rounded-full animate-bounce"
                            style={{ backgroundColor: "#6B745D", animationDelay: "0.2s" }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="border-t p-3" style={{ borderColor: "#8E9B79" }}>
              <div className="flex space-x-2">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Ask ALFRED anything..."
                  onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                  className="flex-1 text-sm"
                  style={{ borderColor: "#8E9B79" }}
                />
                <Button
                  onClick={() => handleSendMessage()}
                  size="sm"
                  className="text-white"
                  style={{ backgroundColor: "#6B745D" }}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
