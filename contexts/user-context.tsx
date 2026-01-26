"use client"

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import type { User } from "@supabase/supabase-js"

// Team member type based on Supabase schema
export interface TeamMember {
  id: string
  auth_user_id: string | null
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  title: string | null
  role: string | null
  department: string | null
  avatar_url: string | null
  phone_number: string | null
  mobile_number: string | null
  timezone: string | null
  is_active: boolean
  start_date: string | null
  manager_id: string | null
  karbon_user_key: string | null
  created_at: string
  updated_at: string
}

interface UserContextType {
  user: User | null
  teamMember: TeamMember | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

const UserContext = createContext<UserContextType>({
  user: null,
  teamMember: null,
  isLoading: true,
  error: null,
  refetch: async () => {},
})

// Module-level cache
let cachedUser: User | null = null
let cachedTeamMember: TeamMember | null = null

export function UserProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(cachedUser)
  const [teamMember, setTeamMember] = useState<TeamMember | null>(cachedTeamMember)
  const [isLoading, setIsLoading] = useState(!cachedUser && !cachedTeamMember)
  const [error, setError] = useState<string | null>(null)
  const isFetchingRef = useRef(false)
  const hasFetchedRef = useRef(false)
  
  // Don't fetch on login or auth pages (pathname can be null on initial render)
  const isAuthPage = !pathname || pathname === '/login' || pathname.startsWith('/auth')

  const fetchUserData = useCallback(async () => {
    // Skip fetching on auth pages
    if (isAuthPage) {
      setIsLoading(false)
      return
    }
    
    if (isFetchingRef.current) return

    // Return cached data if already fetched
    if (hasFetchedRef.current && cachedUser) {
      setUser(cachedUser)
      setTeamMember(cachedTeamMember)
      setIsLoading(false)
      return
    }

    isFetchingRef.current = true
    setIsLoading(true)
    setError(null)

    try {
      // Use API route for server-side auth (avoids client-side Supabase auth issues)
      const response = await fetch("/api/auth/user")

      if (!response.ok) {
        // Not authenticated - this is normal for login page
        hasFetchedRef.current = true
        setUser(null)
        setTeamMember(null)
        return
      }

      const data = await response.json()

      cachedUser = data.user
      cachedTeamMember = data.teamMember
      hasFetchedRef.current = true

      setUser(data.user)
      setTeamMember(data.teamMember)
    } catch {
      // Fetch failed (network error) - silently set to null, don't block app
      hasFetchedRef.current = true
      setUser(null)
      setTeamMember(null)
    } finally {
      setIsLoading(false)
      isFetchingRef.current = false
    }
  }, [isAuthPage])

  useEffect(() => {
    fetchUserData()
  }, [fetchUserData])

  return (
    <UserContext.Provider value={{ user, teamMember, isLoading, error, refetch: fetchUserData }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (!context) {
    throw new Error("useUser must be used within a UserProvider")
  }
  return context
}

// Helper hook to get display name
export function useDisplayName() {
  const { teamMember, user } = useUser()

  if (teamMember) {
    return teamMember.full_name || teamMember.first_name || teamMember.email
  }

  if (user) {
    return user.email?.split("@")[0] || "User"
  }

  return "Team Member"
}

// Helper hook to get user initials
export function useUserInitials() {
  const { teamMember, user } = useUser()

  if (teamMember) {
    if (teamMember.first_name && teamMember.last_name) {
      return `${teamMember.first_name[0]}${teamMember.last_name[0]}`.toUpperCase()
    }
    if (teamMember.full_name) {
      const parts = teamMember.full_name.split(" ")
      return parts
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    }
  }

  if (user?.email) {
    return user.email.slice(0, 2).toUpperCase()
  }

  return "TM"
}
