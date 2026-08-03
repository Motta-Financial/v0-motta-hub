"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, CheckCircle2, Sparkles, Users, Wand2 } from "lucide-react"
import { toast } from "sonner"

type MatchCandidate = {
  teamMemberId: string
  fullName: string
  email: string | null
  role: string | null
  isActive: boolean
  score: number
  matchedOn: string[]
}

type Profile = {
  profileId: string
  authId: string | null
  fullName: string | null
  email: string | null
  teamMemberId: string | null
  teamMemberRole: string | null
  teamMemberIsActive: boolean | null
  engagementCount: number
  isActive: boolean
  notes: string | null
  updatedAt: string
  candidates: MatchCandidate[]
  autolinkSuggestion: MatchCandidate | null
}

type TeamMember = {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: string | null
  is_active: boolean
}

type Response = {
  profiles: Profile[]
  teamMembers: TeamMember[]
  unmappedCount: number
  autolinkableCount: number
}

const UNLINKED_VALUE = "__unlinked__"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function ProconnectProfilesCard() {
  const { data, error, isLoading, mutate } = useSWR<Response>(
    "/api/tax/proconnect-profiles",
    fetcher,
    { refreshInterval: 0 }
  )
  const [savingId, setSavingId] = useState<string | null>(null)
  const [autoLinking, setAutoLinking] = useState(false)

  async function handleAutoLink() {
    setAutoLinking(true)
    try {
      const res = await fetch("/api/tax/proconnect-profiles/auto-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`Auto-link failed: ${body.error || res.status}`)
        return
      }
      if ((body.applied ?? 0) === 0) {
        toast.info("No high-confidence matches available right now.")
      } else {
        toast.success(`Auto-linked ${body.applied} profile(s).`)
      }
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-link failed")
    } finally {
      setAutoLinking(false)
    }
  }

  async function handleAssign(profileId: string, teamMemberId: string) {
    const newTmId = teamMemberId === UNLINKED_VALUE ? null : teamMemberId
    setSavingId(profileId)
    try {
      const res = await fetch("/api/tax/proconnect-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, teamMemberId: newTmId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(`Failed to update: ${body.error || res.status}`)
        return
      }
      toast.success(newTmId ? "Profile linked" : "Profile unlinked")
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed")
    } finally {
      setSavingId(null)
    }
  }

  /**
   * Save a name/email seed onto an unmapped profile row. The matcher
   * relies on this to find candidate team members — ProConnect's API
   * doesn't expose user metadata, so the operator types at least one of
   * (full_name, email) per row to bootstrap matching.
   */
  async function handleSaveSeed(
    profileId: string,
    seed: { fullName?: string; email?: string },
  ) {
    setSavingId(profileId)
    try {
      const payload: Record<string, string | null> = { profileId }
      if (seed.fullName !== undefined)
        payload.fullName = seed.fullName.trim() || null
      if (seed.email !== undefined) payload.email = seed.email.trim() || null
      const res = await fetch("/api/tax/proconnect-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(`Failed to save: ${body.error || res.status}`)
        return
      }
      toast.success("Seed saved")
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSavingId(null)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Preparer Mapping
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Preparer Mapping
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Failed to load profile data.
          </div>
        </CardContent>
      </Card>
    )
  }

  // Sort: unmapped first, then by engagement count desc
  const sorted = [...data.profiles].sort((a, b) => {
    const aMapped = !!a.fullName
    const bMapped = !!b.fullName
    if (aMapped !== bMapped) return aMapped ? 1 : -1
    return b.engagementCount - a.engagementCount
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Preparer Mapping
            </CardTitle>
            <CardDescription className="mt-1">
              Map ProConnect profile IDs to your team members so the Tax dashboard
              can render preparer names instead of GUIDs.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            {data.autolinkableCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAutoLink}
                disabled={autoLinking}
                className="gap-1"
                title="Apply all high-confidence (>= 0.85, clear winner) matches at once"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Auto-link {data.autolinkableCount}
              </Button>
            )}
            {data.unmappedCount === 0 ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                All mapped
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" />
                {data.unmappedCount} unmapped
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map((profile) => (
            <ProfileRow
              key={profile.profileId}
              profile={profile}
              teamMembers={data.teamMembers}
              isSaving={savingId === profile.profileId}
              onAssign={handleAssign}
              onSaveSeed={handleSaveSeed}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ProfileRow({
  profile,
  teamMembers,
  isSaving,
  onAssign,
  onSaveSeed,
}: {
  profile: Profile
  teamMembers: TeamMember[]
  isSaving: boolean
  onAssign: (profileId: string, teamMemberId: string) => void
  onSaveSeed: (
    profileId: string,
    seed: { fullName?: string; email?: string },
  ) => void
}) {
  const isMapped = !!profile.fullName
  const topSuggestion = profile.candidates[0]
  const showSuggestionStrip =
    !profile.teamMemberId &&
    !!topSuggestion &&
    profile.candidates.length > 0
  const needsSeed =
    !profile.teamMemberId && !profile.fullName && !profile.email
  const [seedFullName, setSeedFullName] = useState(profile.fullName || "")
  const [seedEmail, setSeedEmail] = useState(profile.email || "")

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">
            {profile.fullName || (
              <span className="text-muted-foreground">Unmapped profile</span>
            )}
          </span>
          {profile.teamMemberId && profile.teamMemberIsActive === false && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Inactive
            </Badge>
          )}
          {profile.teamMemberRole && (
            <Badge variant="outline" className="text-xs">
              {profile.teamMemberRole}
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs">
            {profile.engagementCount.toLocaleString()} engagements
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <code className="font-mono">{profile.profileId}</code>
          {profile.authId && (
            <span>
              auth: <code className="font-mono">{profile.authId}</code>
            </span>
          )}
          {profile.email && <span>{profile.email}</span>}
        </div>
        {needsSeed && (
          <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground sm:w-16">
              Seed
            </span>
            <input
              value={seedFullName}
              onChange={(e) => setSeedFullName(e.target.value)}
              placeholder="Full name (e.g. Tom Motta)"
              className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
              disabled={isSaving}
            />
            <input
              value={seedEmail}
              onChange={(e) => setSeedEmail(e.target.value)}
              placeholder="Email (optional)"
              className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
              disabled={isSaving}
              type="email"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={
                isSaving ||
                (!seedFullName.trim() && !seedEmail.trim()) ||
                (seedFullName === (profile.fullName || "") &&
                  seedEmail === (profile.email || ""))
              }
              onClick={() =>
                onSaveSeed(profile.profileId, {
                  fullName: seedFullName,
                  email: seedEmail,
                })
              }
              className="h-8 px-2 text-xs"
            >
              Find matches
            </Button>
          </div>
        )}
        {showSuggestionStrip && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              Suggested:
            </span>
            {profile.candidates.slice(0, 3).map((c) => (
              <button
                key={c.teamMemberId}
                type="button"
                disabled={isSaving}
                onClick={() => onAssign(profile.profileId, c.teamMemberId)}
                title={`Score ${c.score} \u00b7 matched on ${c.matchedOn.join(", ") || "n/a"}`}
                className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-stone-50 px-2 py-0.5 text-[11px] hover:bg-stone-100 disabled:opacity-50"
              >
                <span>{c.fullName || "(unnamed)"}</span>
                {!c.isActive && (
                  <span className="text-[9px] uppercase tracking-wider text-stone-500">
                    inactive
                  </span>
                )}
                <span className="tabular-nums text-stone-500">{c.score}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 sm:w-72">
        <Select
          value={profile.teamMemberId || UNLINKED_VALUE}
          disabled={isSaving}
          onValueChange={(v) => onAssign(profile.profileId, v)}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Assign team member..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNLINKED_VALUE}>
              <span className="text-muted-foreground">Unlinked</span>
            </SelectItem>
            {teamMembers.map((tm) => (
              <SelectItem key={tm.id} value={tm.id}>
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5">
                    {tm.full_name}
                    {!tm.is_active && (
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                        inactive
                      </span>
                    )}
                  </span>
                  {tm.role && (
                    <span className="text-xs text-muted-foreground">
                      {tm.role}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isMapped ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
        )}
      </div>
    </div>
  )
}
