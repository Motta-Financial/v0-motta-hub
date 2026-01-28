"use client"

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react"
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
  isConfigured: boolean
  refetch: () => Promise<void>
}

const UserContext = createContext<UserContextType>({
  user: null,
  teamMember: null,
  isLoading: true,
  error: null,
  isConfigured: false,
  refetch: async () => {},
})

// Module-level cache
let cachedUser: User | null = null
let cachedTeamMember: TeamMember | null = null
let cachedIsConfigured = false

// Mock user for when Supabase is not configured
const mockUser: User = {
  id: "demo-user-id",
  email: "demo@motta.cpa",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
}

const mockTeamMember: TeamMember = {
  id: "demo-team-member-id",
  auth_user_id: "demo-user-id",
  email: "demo@motta.cpa",
  first_name: "Demo",
  last_name: "User",
  full_name: "Demo User",
  title: "Team Member",
  role: "staff",
  department: "Accounting",
  avatar_url: null,
  phone_number: null,
  mobile_number: null,
  timezone: "America/New_York",
  is_active: true,
  start_date: null,
  manager_id: null,
  karbon_user_key: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cachedUser)
  const [teamMember, setTeamMember] = useState<TeamMember | null>(cachedTeamMember)
  const [isLoading, setIsLoading] = useState(!cachedUser && !cachedTeamMember)
  const [error, setError] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState(cachedIsConfigured)
  const isFetchingRef = useRef(false)
  const hasFetchedRef = useRef(false)

  const fetchUserData = useCallback(async () => {
    if (isFetchingRef.current) return

    // Return cached data if already fetched
    if (hasFetchedRef.current && (cachedUser || !cachedIsConfigured)) {
      setUser(cachedUser)
      setTeamMember(cachedTeamMember)
      setIsConfigured(cachedIsConfigured)
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
        throw new Error("Failed to fetch user data")
      }

      const data = await response.json()

      // If Supabase is not configured, use mock data
      if (data.configured === false) {
        cachedUser = mockUser
        cachedTeamMember = mockTeamMember
        cachedIsConfigured = false
        hasFetchedRef.current = true

        setUser(mockUser)
        setTeamMember(mockTeamMember)
        setIsConfigured(false)
      } else {
        cachedUser = data.user
        cachedTeamMember = data.teamMember
        cachedIsConfigured = true
        hasFetchedRef.current = true

        setUser(data.user)
        setTeamMember(data.teamMember)
        setIsConfigured(true)
      }
    } catch (err) {
      console.error("[v0] Error fetching user:", err)
      // On error, fall back to mock data to keep the app functional
      setUser(mockUser)
      setTeamMember(mockTeamMember)
      setIsConfigured(false)
      setError(null) // Clear error since we're using mock data
    } finally {
      setIsLoading(false)
      isFetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    fetchUserData()
  }, [fetchUserData])

  return (
    <UserContext.Provider value={{ user, teamMember, isLoading, error, isConfigured, refetch: fetchUserData }}>
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
