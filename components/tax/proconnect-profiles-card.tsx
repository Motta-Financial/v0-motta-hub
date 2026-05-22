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
import { AlertCircle, CheckCircle2, Users } from "lucide-react"
import { toast } from "sonner"

type Profile = {
  profileId: string
  authId: string | null
  fullName: string | null
  email: string | null
  teamMemberId: string | null
  teamMemberRole: string | null
  engagementCount: number
  isActive: boolean
  notes: string | null
  updatedAt: string
}

type TeamMember = {
  id: string
  full_name: string
  email: string | null
  role: string | null
}

type Response = {
  profiles: Profile[]
  teamMembers: TeamMember[]
  unmappedCount: number
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
}: {
  profile: Profile
  teamMembers: TeamMember[]
  isSaving: boolean
  onAssign: (profileId: string, teamMemberId: string) => void
}) {
  const isMapped = !!profile.fullName

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {profile.fullName || (
              <span className="text-muted-foreground">Unmapped profile</span>
            )}
          </span>
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
                  <span>{tm.full_name}</span>
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
