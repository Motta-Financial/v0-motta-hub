"use client"

import { useEffect, useMemo, useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { useUser, useDisplayName } from "@/hooks/use-user"
import { Megaphone, Send, Loader2, AlertTriangle, Users, Eye } from "lucide-react"
import { buildBroadcastHtml } from "@/lib/email-preview"

type Member = {
  id: string
  full_name: string
  email?: string | null
  role?: string | null
  is_active?: boolean
}

export default function BroadcastPage() {
  const { teamMember } = useUser()
  const senderName = useDisplayName()
  const { toast } = useToast()

  const [members, setMembers] = useState<Member[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [allSelected, setAllSelected] = useState(true)

  const [subject, setSubject] = useState("")
  const [bodyText, setBodyText] = useState("")
  const [force, setForce] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const [sending, setSending] = useState(false)
  const isPartner = teamMember?.role === "Partner" || teamMember?.role === "Admin"

  useEffect(() => {
    let cancelled = false
    setLoadingMembers(true)
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        const list: Member[] = (json.team_members || []).filter(
          (m: Member) => m.is_active !== false && m.email,
        )
        setMembers(list)
      })
      .catch((err) => {
        toast({
          title: "Failed to load team",
          description: err.message,
          variant: "destructive",
        })
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.full_name?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.role?.toLowerCase().includes(q),
    )
  }, [members, search])

  const recipientCount = allSelected ? members.length : selectedIds.size

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAllSelected(false)
  }

  // Convert plain text to safe HTML by escaping and converting newlines.
  const renderedHtml = useMemo(() => {
    const escaped = bodyText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>")
    return escaped
  }, [bodyText])

  const previewHtml = useMemo(
    () =>
      buildBroadcastHtml({
        subject: subject || "(subject)",
        bodyHtml: renderedHtml || "<em style='color:#999'>Your message will appear here</em>",
        fromName: senderName || "Motta Hub",
      }),
    [subject, renderedHtml, senderName],
  )

  const handleSend = async () => {
    if (!subject.trim() || !bodyText.trim()) {
      toast({
        title: "Missing fields",
        description: "Subject and body are required",
        variant: "destructive",
      })
      return
    }

    const recipientIds = allSelected ? undefined : Array.from(selectedIds)
    if (!allSelected && (recipientIds?.length ?? 0) === 0) {
      toast({
        title: "No recipients",
        description: "Select at least one team member or choose 'All active members'",
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
          subject,
          bodyHtml: renderedHtml,
          fromName: senderName || "Motta Hub",
          recipientIds,
          force,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Send failed")

      toast({
        title: "Broadcast sent",
        description: `Sent to ${json.sent} of ${json.attempted} recipients${json.skipped ? ` (${json.skipped} opted out)` : ""}.`,
      })
      setSubject("")
      setBodyText("")
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
              <Megaphone className="h-6 w-6 text-[#6B745D]" />
              Broadcast Email
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Send a custom email announcement to the team. Recipients who&apos;ve opted out of broadcasts will be
              skipped automatically unless you override.
            </p>
          </div>
          {isPartner === false && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              <AlertTriangle className="h-4 w-4" />
              Partner / Admin role required to send broadcasts
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Compose */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compose</CardTitle>
                <CardDescription>Plain text — line breaks will be preserved.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Important update from Motta Financial"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="body">Message</Label>
                  <Textarea
                    id="body"
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    rows={12}
                    placeholder="Write your announcement here..."
                  />
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Switch id="force" checked={force} onCheckedChange={setForce} />
                  <Label htmlFor="force" className="cursor-pointer">
                    Override opt-outs (use sparingly)
                  </Label>
                </div>
              </CardContent>
            </Card>

            {/* Recipients */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-[#6B745D]" />
                  Recipients
                  <Badge variant="secondary" className="ml-2 bg-[#EAE6E1] text-[#6B745D]">
                    {recipientCount}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 pb-2 border-b">
                  <Checkbox
                    id="all"
                    checked={allSelected}
                    onCheckedChange={(v) => {
                      setAllSelected(!!v)
                      if (v) setSelectedIds(new Set())
                    }}
                  />
                  <Label htmlFor="all" className="cursor-pointer font-medium">
                    All active team members ({members.length})
                  </Label>
                </div>

                {!allSelected && (
                  <>
                    <Input
                      placeholder="Search team..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                      {loadingMembers ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                        </div>
                      ) : filteredMembers.length === 0 ? (
                        <p className="text-sm text-gray-500 py-8 text-center">No matches</p>
                      ) : (
                        filteredMembers.map((m) => (
                          <label
                            key={m.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                          >
                            <Checkbox
                              checked={selectedIds.has(m.id)}
                              onCheckedChange={() => toggleMember(m.id)}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{m.full_name}</p>
                              <p className="text-xs text-gray-500 truncate">{m.email}</p>
                            </div>
                            {m.role && (
                              <Badge variant="outline" className="text-xs">
                                {m.role}
                              </Badge>
                            )}
                          </label>
                        ))
                      )}
                    </div>
                  </>
                )}
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
                disabled={sending || !isPartner}
                className="bg-[#6B745D] hover:bg-[#5a6350] text-white ml-auto"
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send to {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"}
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
                  Live Preview
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
