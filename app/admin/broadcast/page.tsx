"use client"

import { useMemo, useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { useUser, useDisplayName } from "@/hooks/use-user"
import { Megaphone, Send, Loader2, Eye, Inbox, Mail } from "lucide-react"
import { buildAnnouncementHtml } from "@/lib/email-preview"

export default function BroadcastPage() {
  const { teamMember } = useUser()
  const senderName = useDisplayName()
  const { toast } = useToast()

  const [topic, setTopic] = useState("")
  const [announcement, setAnnouncement] = useState("")
  const [actionItems, setActionItems] = useState("")
  const [force, setForce] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [sending, setSending] = useState(false)

  const previewHtml = useMemo(
    () =>
      buildAnnouncementHtml({
        topic: topic || "(your topic)",
        announcement,
        actionItems,
        fromName: senderName || "ALFRED Ai",
      }),
    [topic, announcement, actionItems, senderName],
  )

  const handleSend = async () => {
    if (!topic.trim() || !announcement.trim()) {
      toast({
        title: "Missing fields",
        description: "Topic and Announcement are required.",
        variant: "destructive",
      })
      return
    }

    setSending(true)
    try {
      const res = await fetch("/api/email/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          announcement: announcement.trim(),
          actionItems: actionItems.trim() || undefined,
          createdById: teamMember?.id,
          createdByName: senderName || undefined,
          force,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Send failed")

      toast({
        title: "Announcement published",
        description: `Posted to everyone's triage and emailed ${json.sent} of ${json.attempted} teammates${
          json.skipped ? ` (${json.skipped} opted out)` : ""
        }.`,
      })
      setTopic("")
      setAnnouncement("")
      setActionItems("")
    } catch (err) {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Megaphone className="h-6 w-6 text-[#C97B3F]" />
              Firm Announcement
            </h1>
            <p className="mt-1 text-sm text-gray-500 max-w-2xl">
              Post a firm-wide announcement. It lands in everyone&apos;s Triage feed and is emailed
              to the team from ALFRED with the subject{" "}
              <span className="font-medium text-gray-700">&ldquo;BREAKING NEWS: &lt;Topic&gt;&rdquo;</span>.
              Anyone on the team can post.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Compose */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compose</CardTitle>
                <CardDescription>Line breaks are preserved in both the email and triage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic</Label>
                  <Input
                    id="topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Office closed Friday for the holiday"
                  />
                  <p className="text-xs text-gray-500">
                    Becomes the email subject: <span className="font-medium">BREAKING NEWS: {topic || "…"}</span>
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="announcement">Announcement</Label>
                  <Textarea
                    id="announcement"
                    value={announcement}
                    onChange={(e) => setAnnouncement(e.target.value)}
                    rows={10}
                    placeholder="Write the announcement here…"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="actionItems">Action Items (if any)</Label>
                  <Textarea
                    id="actionItems"
                    value={actionItems}
                    onChange={(e) => setActionItems(e.target.value)}
                    rows={4}
                    placeholder="Optional — anything the team needs to do."
                  />
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Switch id="force" checked={force} onCheckedChange={setForce} />
                  <Label htmlFor="force" className="cursor-pointer">
                    Override email opt-outs (use sparingly)
                  </Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Inbox className="h-4 w-4 text-[#6B745D]" />
                    Everyone&apos;s Triage
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-[#6B745D]" />
                    All active team members
                  </span>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPreview((v) => !v)}
                className="lg:hidden"
              >
                <Eye className="mr-2 h-4 w-4" />
                {showPreview ? "Hide preview" : "Show preview"}
              </Button>
              <Button
                onClick={handleSend}
                disabled={sending}
                className="bg-[#C97B3F] hover:bg-[#b06a33] text-white ml-auto"
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Publish announcement
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Preview */}
          <div className={showPreview ? "block" : "hidden lg:block"}>
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[#6B745D]" />
                  Email Preview
                </CardTitle>
                <CardDescription>Approximation of what recipients will see.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden bg-[#f5f5f5]">
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    className="w-full h-[600px] border-0 bg-white"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
