"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Briefcase, Users } from "lucide-react"

interface TeamMember {
  id: string
  full_name: string
  email: string
  title?: string
  role?: string
  department?: string
  avatar_url?: string
  is_active: boolean
}

/**
 * Hierarchy tiers used to render the org chart, top -> bottom.
 *
 * The team_members table has a `manager_id` column for explicit reporting
 * lines, but it isn't yet populated. Until it is, we group people by their
 * `role` value (Partner / Director / Manager / etc.) and render each tier
 * as a horizontal row connected by a simple vertical line. Anything that
 * doesn't match a known tier falls into the catch-all "Team" bucket so it
 * still appears on the chart instead of silently disappearing.
 */
const TIERS: Array<{ label: string; matches: (m: TeamMember) => boolean }> = [
  { label: "Partners", matches: (m) => /partner/i.test(m.role || "") },
  { label: "Directors", matches: (m) => /director/i.test(m.role || "") },
  { label: "Managers", matches: (m) => /^manager$/i.test(m.role || "") },
  { label: "Senior Associates", matches: (m) => /senior\s*associate/i.test(m.role || "") },
  { label: "Associates", matches: (m) => /^associate$/i.test(m.role || "") },
  { label: "Interns", matches: (m) => /intern/i.test(m.role || "") },
  { label: "Support", matches: (m) => /assistant|support|admin/i.test(m.role || "") },
]

function bucketize(members: TeamMember[]) {
  const used = new Set<string>()
  const buckets = TIERS.map((tier) => {
    const people = members.filter((m) => {
      if (used.has(m.id)) return false
      if (!tier.matches(m)) return false
      used.add(m.id)
      return true
    })
    return { label: tier.label, people }
  })

  // Anything that didn't match a tier still shows up so the chart is
  // never lossy. Useful for one-off roles like "Bookkeeper" or "Advisor".
  const remaining = members.filter((m) => !used.has(m.id))
  if (remaining.length) buckets.push({ label: "Team", people: remaining })

  return buckets.filter((b) => b.people.length > 0)
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function PersonCard({ member }: { member: TeamMember }) {
  return (
    <Card className="flex w-56 flex-col items-center gap-2 p-4 text-center shadow-sm transition-shadow hover:shadow-md">
      <Avatar className="h-16 w-16">
        <AvatarImage src={member.avatar_url || "/placeholder.svg"} alt={member.full_name} />
        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-base text-white">
          {getInitials(member.full_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 w-full">
        <p className="truncate text-sm font-semibold text-foreground">{member.full_name}</p>
        {member.title ? (
          <p className="truncate text-xs text-muted-foreground" title={member.title}>
            {member.title}
          </p>
        ) : member.role ? (
          <p className="truncate text-xs text-muted-foreground">{member.role}</p>
        ) : null}
        {member.department && (
          <Badge variant="secondary" className="mt-2 max-w-full truncate font-normal">
            <Briefcase className="mr-1 h-3 w-3 flex-shrink-0" />
            <span className="truncate">{member.department}</span>
          </Badge>
        )}
      </div>
    </Card>
  )
}

export function OrgChart({ members }: { members: TeamMember[] }) {
  const tiers = bucketize(members.filter((m) => m.is_active))

  if (tiers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Users className="mb-4 h-12 w-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No active team members to display.</p>
      </div>
    )
  }

  return (
    // Horizontal scroll on small screens so the chart never wraps awkwardly
    // mid-tier when the firm is wide. The min-w pushes the inner stack out.
    <div className="overflow-x-auto pb-4">
      <div className="mx-auto flex min-w-max flex-col items-center gap-0 px-4">
        {tiers.map((tier, tierIdx) => (
          <div key={tier.label} className="flex flex-col items-center">
            {/* Connector from the previous tier */}
            {tierIdx > 0 && <div className="h-8 w-px bg-border" aria-hidden="true" />}

            {/* Tier label */}
            <div className="mb-3 flex items-center gap-2">
              <span className="h-px w-8 bg-border" aria-hidden="true" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {tier.label}
              </span>
              <span className="h-px w-8 bg-border" aria-hidden="true" />
            </div>

            {/* The cards plus a horizontal connector spanning them when there
                are multiple people in the tier. */}
            <div className="relative flex flex-wrap items-start justify-center gap-4">
              {tier.people.length > 1 && (
                <div
                  className="pointer-events-none absolute left-0 right-0 top-0 -mt-3 h-3 border-x border-t border-border"
                  aria-hidden="true"
                />
              )}
              {tier.people.map((member) => (
                <div key={member.id} className="flex flex-col items-center">
                  {tier.people.length > 1 && (
                    <div className="-mt-3 h-3 w-px bg-border" aria-hidden="true" />
                  )}
                  <PersonCard member={member} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
