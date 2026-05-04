"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  MessageSquare,
  Send,
  Smile,
  ImageIcon,
  MessageCircle,
  Pencil,
  Trash2,
  History,
  X,
  Check,
  Loader2,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useUser, useDisplayName, useUserInitials } from "@/contexts/user-context"

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
  updatedAt?: string | null
  reactions: { emoji: string; count: number }[]
  comments: Comment[]
  gifUrl?: string
}

interface EditHistoryEntry {
  id: string
  previousContent: string | null
  previousGifUrl: string | null
  editorName: string
  editorInitials: string | null
  editedAt: string
}

const COMMON_EMOJIS = ["👍", "❤️", "😊", "🎉", "🔥", "👏", "💯", "✨"]

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

  // Edit/delete state.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [historyForMessageId, setHistoryForMessageId] = useState<string | null>(null)
  const [history, setHistory] = useState<EditHistoryEntry[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { teamMember } = useUser()
  const displayName = useDisplayName()
  const userInitials = useUserInitials()

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: displayName,
          authorInitials: userInitials,
          teamMemberId: teamMember?.id,
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
      const response = await fetch(`/api/messages/${messageId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "react", emoji, teamMemberId: teamMember?.id }),
      })

      if (response.ok) {
        // Refetch the list to get updated aggregated counts.
        fetchMessages()
      }
    } catch (error) {
      console.error("Error adding reaction:", error)
    }
  }

  const handleAddComment = async (messageId: string) => {
    if (!commentText.trim()) return

    try {
      const response = await fetch(`/api/messages/${messageId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "comment",
          comment: { author: displayName, content: commentText.trim() },
        }),
      })

      if (response.ok) {
        const newComment = await response.json()
        setMessages(
          messages.map((msg) => (msg.id === messageId ? { ...msg, comments: [...msg.comments, newComment] } : msg)),
        )
        setCommentText("")
        setCommentingOnMessage(null)
      }
    } catch (error) {
      console.error("Error adding comment:", error)
    }
  }

  const startEdit = (message: Message) => {
    setEditingMessageId(message.id)
    setEditDraft(message.content || "")
  }

  const cancelEdit = () => {
    setEditingMessageId(null)
    setEditDraft("")
  }

  const handleSaveEdit = async (messageId: string) => {
    setIsSavingEdit(true)
    try {
      const response = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editDraft,
          editorName: displayName,
          editorInitials: userInitials,
          editorId: teamMember?.id ?? null,
        }),
      })

      if (response.ok) {
        const updated = await response.json()
        setMessages(messages.map((msg) => (msg.id === messageId ? { ...msg, ...updated } : msg)))
        setEditingMessageId(null)
        setEditDraft("")
      }
    } catch (error) {
      console.error("Error editing message:", error)
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deletingMessageId) return
    try {
      const response = await fetch(`/api/messages/${deletingMessageId}`, { method: "DELETE" })
      if (response.ok) {
        setMessages(messages.filter((m) => m.id !== deletingMessageId))
      }
    } catch (error) {
      console.error("Error deleting message:", error)
    } finally {
      setDeletingMessageId(null)
    }
  }

  const openHistory = async (messageId: string) => {
    setHistoryForMessageId(messageId)
    setIsLoadingHistory(true)
    setHistory([])
    try {
      const response = await fetch(`/api/messages/${messageId}`)
      if (response.ok) {
        const data = await response.json()
        setHistory(data)
      }
    } catch (error) {
      console.error("Error fetching edit history:", error)
    } finally {
      setIsLoadingHistory(false)
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

  const isEdited = (message: Message) => {
    if (!message.updatedAt) return false
    return new Date(message.updatedAt).getTime() - new Date(message.timestamp).getTime() > 1000
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
            <CardDescription>
              Share updates and communicate with your team. Anyone can edit or delete any message; all edits are logged.
            </CardDescription>
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
            messages.map((message) => {
              const editing = editingMessageId === message.id
              const edited = isEdited(message)
              return (
                <div
                  key={message.id}
                  className="group flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Avatar className="h-10 w-10 bg-blue-100">
                    <AvatarFallback className="text-blue-700 font-medium">{message.authorInitials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900">{message.author}</p>
                        <span className="text-xs text-gray-500">
                          {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
                        </span>
                        {edited && (
                          <button
                            onClick={() => openHistory(message.id)}
                            className="text-xs text-gray-400 hover:text-gray-600 italic underline-offset-2 hover:underline"
                            title="View edit history"
                          >
                            (edited)
                          </button>
                        )}
                      </div>

                      {!editing && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Edit message"
                            onClick={() => startEdit(message)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Delete message"
                            onClick={() => setDeletingMessageId(message.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          {edited && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="View edit history"
                              onClick={() => openHistory(message.id)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {editing ? (
                      <div className="mt-2 space-y-2">
                        <Textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          className="min-h-[80px] resize-none"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSaveEdit(message.id)}
                            disabled={isSavingEdit || editDraft === message.content}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            {isSavingEdit ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5 mr-1" />
                            )}
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={isSavingEdit}>
                            <X className="h-3.5 w-3.5 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {message.content && (
                          <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{message.content}</p>
                        )}

                        {message.gifUrl && (
                          <img
                            src={message.gifUrl || "/placeholder.svg"}
                            alt="GIF"
                            className="mt-2 rounded-lg max-w-xs"
                          />
                        )}
                      </>
                    )}

                    {!editing && (
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
                    )}

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
              )
            })
          )}
        </div>
      </CardContent>

      {/* Delete confirmation */}
      <Dialog open={deletingMessageId !== null} onOpenChange={(open) => !open && setDeletingMessageId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
            <DialogDescription>
              This permanently removes the message, its comments, and reactions for everyone. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingMessageId(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit history viewer */}
      <Dialog open={historyForMessageId !== null} onOpenChange={(open) => !open && setHistoryForMessageId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit history</DialogTitle>
            <DialogDescription>
              Every previous version of this message, ordered from most recent to oldest.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-3">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-6 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading history...
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No edit history yet.</p>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="rounded-md border border-gray-200 p-3 bg-gray-50">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span className="font-medium text-gray-700">{entry.editorName}</span>
                    <span>{formatDistanceToNow(new Date(entry.editedAt), { addSuffix: true })}</span>
                  </div>
                  {entry.previousContent ? (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{entry.previousContent}</p>
                  ) : (
                    <p className="text-sm italic text-gray-400">(no text content)</p>
                  )}
                  {entry.previousGifUrl && (
                    <img
                      src={entry.previousGifUrl || "/placeholder.svg"}
                      alt="Previous GIF"
                      className="mt-2 rounded-lg max-w-[160px]"
                    />
                  )}
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryForMessageId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
