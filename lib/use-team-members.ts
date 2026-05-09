"use client"

import useSWR from "swr"
import type { MentionMember } from "@/lib/mentions"

/**
 * Lightweight SWR hook that returns the active team-members directory
 * shaped for the @mentions system. Used everywhere a `<MentionTextarea>`
 * or `<MentionText>` lives so we share one cached fetch across the
 * page (message board + debriefs comments + debrief form would otherwise
 * each fire `/api/team-members` independently).
 */

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ApiTeamMember {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  is_active?: boolean | null
}

export function useTeamMembers(): {
  members: MentionMember[]
  isLoading: boolean
} {
  const { data, isLoading } = useSWR<{ team_members: ApiTeamMember[] }>(
    "/api/team-members",
    fetcher,
    {
      // The directory rarely changes mid-session — avoid noisy refetches
      // every time the user clicks back into the tab.
      revalidateOnFocus: false,
      // Keep the previous list while revalidating so the picker doesn't
      // briefly empty out.
      keepPreviousData: true,
    },
  )

  const members: MentionMember[] = (data?.team_members || [])
    .filter((m) => !!m.full_name)
    .map((m) => ({
      id: m.id,
      full_name: m.full_name as string,
      first_name: m.first_name,
      last_name: m.last_name,
      email: m.email,
    }))

  return { members, isLoading }
}
