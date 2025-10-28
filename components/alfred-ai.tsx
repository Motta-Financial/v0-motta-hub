"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Bot,
  Send,
  Lightbulb,
  TrendingUp,
  Calculator,
  FileText,
  Users,
  Clock,
  Sparkles,
  MessageSquare,
  Zap,
} from "lucide-react"

interface Message {
  id: string
  type: "user" | "assistant"
  content: string
  timestamp: Date
  suggestions?: string[]
}

interface AISuggestion {
  id: string
  title: string
  description: string
  category: "Tax" | "Financial" | "Client" | "Process"
  priority: "High" | "Medium" | "Low"
  action: string
}

export function AlfredAI() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content:
        "Hello! I'm ALFRED, your AI assistant for Motta Financial. I can help you with tax planning, client insights, document analysis, and workflow optimization. What would you like to explore today?",
      timestamp: new Date(),
      suggestions: [
        "Analyze client tax optimization opportunities",
        "Review upcoming deadlines",
        "Generate client reports",
        "Suggest workflow improvements",
      ],
    },
  ])
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)

  // Mock AI suggestions
  const aiSuggestions: AISuggestion[] = [
    {
      id: "1",
      title: "Tax Optimization Alert",
      description: "3 clients could benefit from SEP-IRA contributions before year-end",
      category: "Tax",
      priority: "High",
      action: "Review client portfolios",
    },
    {
      id: "2",
      title: "Client Follow-up Needed",
      description: "Johnson & Associates hasn't responded to document requests in 5 days",
      category: "Client",
      priority: "Medium",
      action: "Send follow-up email",
    },
    {
      id: "3",
      title: "Process Improvement",
      description: "Automate monthly bookkeeping reminders to reduce manual work by 40%",
      category: "Process",
      priority: "Medium",
      action: "Set up automation",
    },
    {
      id: "4",
      title: "Revenue Opportunity",
      description: "5 clients eligible for financial planning services based on recent tax filings",
      category: "Financial",
      priority: "High",
      action: "Schedule consultations",
    },
  ]

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputValue,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsTyping(true)

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: getAIResponse(inputValue),
        timestamp: new Date(),
        suggestions: getAISuggestions(inputValue),
      }
      setMessages((prev) => [...prev, aiResponse])
      setIsTyping(false)
    }, 1500)
  }

  const getAIResponse = (input: string): string => {
    const lowerInput = input.toLowerCase()
    if (lowerInput.includes("tax") || lowerInput.includes("deduction")) {
      return "Based on current tax regulations and your client portfolio, I've identified several optimization opportunities. Would you like me to generate a detailed analysis for specific clients or provide general tax planning strategies?"
    }
    if (lowerInput.includes("client") || lowerInput.includes("follow")) {
      return "I can help you prioritize client outreach based on engagement patterns, pending tasks, and revenue potential. Shall I create a prioritized follow-up list for this week?"
    }
    if (lowerInput.includes("report") || lowerInput.includes("analysis")) {
      return "I can generate comprehensive reports including client performance metrics, revenue analysis, and operational insights. What type of report would be most valuable for your current needs?"
    }
    return "I understand you're looking for assistance with that. Let me analyze your current workflow and client data to provide the most relevant recommendations. Could you provide more specific details about what you'd like to accomplish?"
  }

  const getAISuggestions = (input: string): string[] => {
    const lowerInput = input.toLowerCase()
    if (lowerInput.includes("tax")) {
      return [
        "Show tax optimization opportunities",
        "Generate tax planning reports",
        "Review upcoming tax deadlines",
        "Analyze deduction strategies",
      ]
    }
    if (lowerInput.includes("client")) {
      return [
        "Create client priority list",
        "Generate client health scores",
        "Schedule follow-up reminders",
        "Analyze client profitability",
      ]
    }
    return [
      "Show dashboard insights",
      "Generate weekly summary",
      "Optimize workflow processes",
      "Review team performance",
    ]
  }

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion)
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "Tax":
        return <Calculator className="h-4 w-4" />
      case "Financial":
        return <TrendingUp className="h-4 w-4" />
      case "Client":
        return <Users className="h-4 w-4" />
      case "Process":
        return <Zap className="h-4 w-4" />
      default:
        return <Lightbulb className="h-4 w-4" />
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "Tax":
        return "bg-blue-50 text-blue-700 border-blue-200"
      case "Financial":
        return "bg-emerald-50 text-emerald-700 border-emerald-200"
      case "Client":
        return "bg-purple-50 text-purple-700 border-purple-200"
      case "Process":
        return "bg-orange-50 text-orange-700 border-orange-200"
      default:
        return "bg-gray-50 text-gray-700 border-gray-200"
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "High":
        return "bg-red-100 text-red-700"
      case "Medium":
        return "bg-yellow-100 text-yellow-700"
      case "Low":
        return "bg-gray-100 text-gray-700"
      default:
        return "bg-gray-100 text-gray-700"
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-12 h-12 bg-emerald-100 rounded-xl">
            <Bot className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">ALFRED AI Assistant</h1>
            <p className="text-gray-600">Your intelligent financial workflow companion</p>
          </div>
        </div>
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
          <Sparkles className="h-3 w-3 mr-1" />
          AI Powered
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat Interface */}
        <div className="lg:col-span-2">
          <Card className="bg-white shadow-sm border-gray-200 h-[600px] flex flex-col">
            <CardHeader className="border-b border-gray-200">
              <CardTitle className="text-lg font-semibold text-gray-900 flex items-center">
                <MessageSquare className="h-5 w-5 mr-2 text-emerald-600" />
                Chat with ALFRED
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0">
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`flex items-start space-x-2 max-w-[80%]`}>
                        {message.type === "assistant" && (
                          <Avatar className="h-8 w-8 mt-1">
                            <AvatarFallback className="bg-emerald-100 text-emerald-700">
                              <Bot className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div
                          className={`rounded-lg px-4 py-2 ${
                            message.type === "user"
                              ? "bg-emerald-600 text-white"
                              : "bg-gray-100 text-gray-900 border border-gray-200"
                          }`}
                        >
                          <p className="text-sm">{message.content}</p>
                          <p className="text-xs mt-1 opacity-70">
                            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="flex items-start space-x-2">
                        <Avatar className="h-8 w-8 mt-1">
                          <AvatarFallback className="bg-emerald-100 text-emerald-700">
                            <Bot className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="bg-gray-100 text-gray-900 border border-gray-200 rounded-lg px-4 py-2">
                          <div className="flex space-x-1">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                            <div
                              className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.1s" }}
                            />
                            <div
                              className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.2s" }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Suggestions */}
              {messages.length > 0 && messages[messages.length - 1].suggestions && (
                <div className="border-t border-gray-200 p-4">
                  <p className="text-sm text-gray-600 mb-2">Suggested actions:</p>
                  <div className="flex flex-wrap gap-2">
                    {messages[messages.length - 1].suggestions?.map((suggestion, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        size="sm"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="text-xs"
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input */}
              <div className="border-t border-gray-200 p-4">
                <div className="flex space-x-2">
                  <Input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Ask ALFRED anything about your clients, taxes, or workflow..."
                    onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                    className="flex-1"
                  />
                  <Button onClick={handleSendMessage} className="bg-emerald-600 hover:bg-emerald-700">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Suggestions Panel */}
        <div className="space-y-6">
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-gray-900 flex items-center">
                <Lightbulb className="h-5 w-5 mr-2 text-emerald-600" />
                AI Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {aiSuggestions.map((suggestion) => (
                  <div key={suggestion.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <div className={`p-1 rounded ${getCategoryColor(suggestion.category)}`}>
                          {getCategoryIcon(suggestion.category)}
                        </div>
                        <Badge className={getPriorityColor(suggestion.priority)} variant="secondary">
                          {suggestion.priority}
                        </Badge>
                      </div>
                    </div>
                    <h4 className="font-medium text-gray-900 text-sm mb-1">{suggestion.title}</h4>
                    <p className="text-xs text-gray-600 mb-2">{suggestion.description}</p>
                    <Button size="sm" variant="outline" className="text-xs bg-transparent">
                      {suggestion.action}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-gray-900">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start text-sm bg-transparent"
                  onClick={() => handleSuggestionClick("Generate weekly client summary")}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Generate Weekly Summary
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start text-sm bg-transparent"
                  onClick={() => handleSuggestionClick("Show tax optimization opportunities")}
                >
                  <Calculator className="h-4 w-4 mr-2" />
                  Tax Optimization Analysis
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start text-sm bg-transparent"
                  onClick={() => handleSuggestionClick("Review upcoming deadlines")}
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Deadline Review
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start text-sm bg-transparent"
                  onClick={() => handleSuggestionClick("Analyze client profitability")}
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Client Profitability
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
