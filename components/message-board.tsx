"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MessageSquare, Send, Smile, ImageIcon, MessageCircle } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface Comment {
  id: string
  author: string
  authorInitials: string
  content: string
  timestamp: string
}

interface Message {
  id: string
  author: string
  authorInitials: string
  content: string
  timestamp: string
  reactions: { emoji: string; count: number }[]
  comments: Comment[]
  gifUrl?: string
}

const COMMON_EMOJIS = ["👍", "❤️", "😊", "🎉", "🔥", "👏", "💯", "✨"]

const GIPHY_API_KEY = "YOUR_GIPHY_API_KEY" // Replace with actual key or use env variable

export function MessageBoard() {
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isPosting, setIsPosting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [gifSearchQuery, setGifSearchQuery] = useState("")
  const [gifs, setGifs] = useState<any[]>([])
  const [commentingOnMessage, setCommentingOnMessage] = useState<string | null>(null)
  const [commentText, setCommentText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetchMessages()
  }, [])

  const fetchMessages = async () => {
    try {
      const response = await fetch("/api/messages")
      if (response.ok) {
        const data = await response.json()
        setMessages(data)
      }
    } catch (error) {
      console.error("Error fetching messages:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const searchGifs = async (query: string) => {
    if (!query.trim()) {
      setGifs([])
      return
    }

    try {
      // Using Tenor API (free, no key required for basic usage)
      const response = await fetch(
        `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&limit=12`,
      )
      const data = await response.json()
      setGifs(data.results || [])
    } catch (error) {
      console.error("Error fetching GIFs:", error)
    }
  }

  const handlePostMessage = async (gifUrl?: string) => {
    if (!newMessage.trim() && !gifUrl) return

    setIsPosting(true)
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          author: "Current User",
          content: newMessage.trim(),
          gifUrl,
        }),
      })

      if (response.ok) {
        const newMsg = await response.json()
        setMessages([newMsg, ...messages])
        setNewMessage("")
        setShowGifPicker(false)
        setGifSearchQuery("")
        setGifs([])
      }
    } catch (error) {
      console.error("Error posting message:", error)
    } finally {
      setIsPosting(false)
    }
  }

  const handleAddReaction = async (messageId: string, emoji: string) => {
    try {
      const response = await fetch("/api/messages/reactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageId, emoji }),
      })

      if (response.ok) {
        const updatedMessage = await response.json()
        setMessages(messages.map((msg) => (msg.id === messageId ? updatedMessage : msg)))
      }
    } catch (error) {
      console.error("Error adding reaction:", error)
    }
  }

  const handleAddComment = async (messageId: string) => {
    if (!commentText.trim()) return

    try {
      const response = await fetch("/api/messages/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageId,
          author: "Current User",
          content: commentText.trim(),
        }),
      })

      if (response.ok) {
        const updatedMessage = await response.json()
        setMessages(messages.map((msg) => (msg.id === messageId ? updatedMessage : msg)))
        setCommentText("")
        setCommentingOnMessage(null)
      }
    } catch (error) {
      console.error("Error adding comment:", error)
    }
  }

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const text = newMessage
      const before = text.substring(0, start)
      const after = text.substring(end)
      setNewMessage(before + emoji + after)

      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + emoji.length, start + emoji.length)
      }, 0)
    }
    setShowEmojiPicker(false)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handlePostMessage()
    }
  }

  return (
    <Card className="bg-white shadow-sm border-gray-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              Team Message Board
            </CardTitle>
            <CardDescription>Share updates and communicate with your team</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Post new message */}
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            placeholder="Share an update with your team..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            className="min-h-[80px] resize-none"
          />
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Smile className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2">
                  <div className="grid grid-cols-4 gap-2">
                    {COMMON_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => insertEmoji(emoji)}
                        className="text-2xl hover:bg-gray-100 rounded p-2 transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover open={showGifPicker} onOpenChange={setShowGifPicker}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3">
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Search GIFs..."
                      value={gifSearchQuery}
                      onChange={(e) => {
                        setGifSearchQuery(e.target.value)
                        searchGifs(e.target.value)
                      }}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                      {gifs.map((gif) => (
                        <button
                          key={gif.id}
                          onClick={() => handlePostMessage(gif.media_formats.tinygif.url)}
                          className="relative aspect-square rounded overflow-hidden hover:opacity-80 transition-opacity"
                        >
                          <img
                            src={gif.media_formats.tinygif.url || "/placeholder.svg"}
                            alt={gif.content_description}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <Button
              onClick={() => handlePostMessage()}
              disabled={!newMessage.trim() || isPosting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Send className="h-4 w-4 mr-2" />
              {isPosting ? "Posting..." : "Post"}
            </Button>
          </div>
        </div>

        {/* Messages list */}
        <div className="space-y-4 max-h-[600px] overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No messages yet. Be the first to post!</div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Avatar className="h-10 w-10 bg-blue-100">
                  <AvatarFallback className="text-blue-700 font-medium">{message.authorInitials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900">{message.author}</p>
                    <span className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
                    </span>
                  </div>

                  {message.content && (
                    <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{message.content}</p>
                  )}

                  {message.gifUrl && (
                    <img src={message.gifUrl || "/placeholder.svg"} alt="GIF" className="mt-2 rounded-lg max-w-xs" />
                  )}

                  <div className="flex items-center gap-3 mt-2">
                    {message.reactions.length > 0 && (
                      <div className="flex items-center gap-2">
                        {message.reactions.map((reaction, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleAddReaction(message.id, reaction.emoji)}
                            className="flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-xs transition-colors"
                          >
                            <span>{reaction.emoji}</span>
                            <span className="text-gray-600">{reaction.count}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-xs">
                          <Smile className="h-3 w-3 mr-1" />
                          React
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-2">
                        <div className="grid grid-cols-4 gap-1">
                          {COMMON_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => handleAddReaction(message.id, emoji)}
                              className="text-xl hover:bg-gray-100 rounded p-1 transition-colors"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setCommentingOnMessage(message.id)}
                    >
                      <MessageCircle className="h-3 w-3 mr-1" />
                      Comment {message.comments.length > 0 && `(${message.comments.length})`}
                    </Button>
                  </div>

                  {message.comments.length > 0 && (
                    <div className="mt-3 space-y-2 pl-4 border-l-2 border-gray-200">
                      {message.comments.map((comment) => (
                        <div key={comment.id} className="text-sm">
                          <span className="font-medium text-gray-900">{comment.author}</span>
                          <span className="text-gray-500 text-xs ml-2">
                            {formatDistanceToNow(new Date(comment.timestamp), { addSuffix: true })}
                          </span>
                          <p className="text-gray-700 mt-1">{comment.content}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {commentingOnMessage === message.id && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        placeholder="Write a comment..."
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAddComment(message.id)
                          }
                        }}
                        className="flex-1 px-3 py-2 border rounded-md text-sm"
                      />
                      <Button size="sm" onClick={() => handleAddComment(message.id)} disabled={!commentText.trim()}>
                        Post
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
