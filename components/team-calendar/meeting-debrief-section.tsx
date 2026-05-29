"use client"

/**
 * <MeetingDebriefSection>
 * ────────────────────────────────────────────────────────────────────────
 * Lives in the Overview tab of the meeting detail dialog (Calendly + Zoom).
 *
 *   • No debrief linked yet → "Start debrief" (opens the prefilled
 *     /debriefs/new form) + "Link existing debrief" (attach one already
 *     submitted for this client).
 *   • A debrief is linked → compact summary + "View" link.
 *
 * All reads/writes go through /api/debriefs/link. The prefill URL is built
 * with the shared helpers in lib/debriefs/meeting-link.ts so the form and
 * the post-meeting ALFRED email stay in sync.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, ClipboardList, ExternalLink, Link2, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  buildDebriefPrefillPath,
  resolveMeetingType,
  meetingTypeLabel,
  type MeetingSource,
} from "@/lib/debriefs/meeting-link"
import type { TeamCalendarEvent } from "./types"

interface LinkedDebrief {
  id: string
  debrief_date: string
  debrief_type: string | null
  status: string | null
  notes: string | null
  contact_full_name: string | null
  organization_name: string | null
  team_member_full_name: string | null
}

interface Props {
  event: TeamCalendarEvent
  currentUser: { id?: string | null; fullName?: string | null }
}

export function MeetingDebriefSection({ event, currentUser }: Props) {
  const source: MeetingSource = event.source === "zoom" ? "zoom" : "calendly"

  const [loading, setLoading] = useState(true)
  const [linked, setLinked] = useState<LinkedDebrief | null>(null)
  const [candidates, setCandidates] = useState<LinkedDebrief[]>([])
  const [linking, setLinking] = useState(false)
  const [selected, setSelected] = useState<string>("")

  const queryKey = source === "calendly" ? "calendly_event_id" : "zoom_meeting_id"

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/debriefs/link?${queryKey}=${encodeURIComponent(event.id)}`)
      const json = await res.json()
      if (res.ok) {
        setLinked(json.linked || null)
        setCandidates(json.candidates || [])
      }
    } catch {
      // Non-fatal — the section just shows the start/link affordances.
    } finally {
      setLoading(false)
    }
  }, [event.id, queryKey])

  useEffect(() => {
    void load()
  }, [load])

  // Build the prefilled /debriefs/new URL from the meeting's known details.
  const prefillPath = (() => {
    // First client tag, if any (works for both Calendly and the normalized
    // Zoom shape, which maps zoom_meeting_clients into calendly_event_clients).
    const tag = (event.calendly_event_clients || []).find((c) => c.contact_id || c.organization_id)
    const contactId = tag?.contact_id || tag?.organization_id || null
    const contactType = tag?.contact_id ? "contact" : tag?.organization_id ? "organization" : null
    const contactName = tag?.contact?.full_name || tag?.organization?.name || null
    const meetingDate = event.start_time ? event.start_time.slice(0, 10) : null

    return buildDebriefPrefillPath({
      source,
      meetingRowId: event.id,
      meetingDate,
      meetingTitle: event.name,
      meetingType: resolveMeetingType(source, event.location_type),
      // Prefill the host as the team member filing the debrief.
      teamMemberId: event.team_member_id || currentUser.id || null,
      teamMemberName: event.team_members?.full_name || currentUser.fullName || null,
      contactId,
      contactType,
      contactName,
    })
  })()

  async function linkExisting() {
    if (!selected) return
    setLinking(true)
    try {
      const res = await fetch("/api/debriefs/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debrief_id: selected, [queryKey]: event.id }),
      })
      if (res.ok) {
        setSelected("")
        await load()
      }
    } finally {
      setLinking(false)
    }
  }

  const typeLabel = meetingTypeLabel(resolveMeetingType(source, event.location_type))

  return (
    <div className="rounded-lg border bg-card p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <ClipboardList className="h-4 w-4" />
        Debrief
        <span className="ml-auto text-xs font-normal text-muted-foreground">{typeLabel}</span>
      </h4>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking debrief status…
        </div>
      ) : linked ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Debrief submitted
                {linked.team_member_full_name ? ` by ${linked.team_member_full_name}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(linked.debrief_date).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
                {linked.contact_full_name || linked.organization_name
                  ? ` · ${linked.contact_full_name || linked.organization_name}`
                  : ""}
              </p>
              {linked.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{linked.notes}</p>}
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="gap-2 bg-transparent">
            <Link href="/debriefs">
              View debrief
              <ExternalLink className="h-3 w-3 opacity-70" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No debrief yet. Start one for this meeting, or link a debrief that&apos;s already been submitted.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="gap-2">
              <Link href={prefillPath}>
                <Plus className="h-4 w-4" />
                Start debrief
              </Link>
            </Button>
          </div>

          {candidates.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                Link an existing debrief
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={selected} onValueChange={setSelected}>
                  <SelectTrigger className="h-9 w-full sm:w-[280px]">
                    <SelectValue placeholder="Select a debrief…" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {new Date(c.debrief_date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                        {" · "}
                        {c.contact_full_name || c.organization_name || "Untagged"}
                        {c.team_member_full_name ? ` · ${c.team_member_full_name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="secondary" disabled={!selected || linking} onClick={linkExisting} className="gap-2">
                  {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Link
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
