"use client"

import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
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

let cachedUser: User | null = null
let cachedTeamMember: TeamMember | null = null
let lastFetchTime = 0
const CACHE_DURATION = 30000 // 30 seconds cache

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cachedUser)
  const [teamMember, setTeamMember] = useState<TeamMember | null>(cachedTeamMember)
  const [isLoading, setIsLoading] = useState(!cachedUser)
  const [error, setError] = useState<string | null>(null)
  const isFetchingRef = useRef(false)
  const mountedRef = useRef(true)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)

  const getSupabase = () => {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient()
    }
    return supabaseRef.current
  }

  const fetchUserData = async (force = false) => {
    const now = Date.now()
    if (!force && cachedUser && now - lastFetchTime < CACHE_DURATION) {
      setUser(cachedUser)
      setTeamMember(cachedTeamMember)
      setIsLoading(false)
      return
    }

    if (isFetchingRef.current) return
    isFetchingRef.current = true

    try {
      setIsLoading(true)
      setError(null)

      const supabase = getSupabase()

      // Get authenticated user
      let authUser: User | null = null
      try {
        const { data, error: authError } = await supabase.auth.getUser()
        if (authError) {
          // Don't treat "not authenticated" as an error
          if (!authError.message.includes("session") && !authError.message.includes("Auth")) {
            console.error("[v0] Auth error:", authError.message)
          }
        } else {
          authUser = data.user
        }
      } catch (authErr: unknown) {
        const errorMessage = authErr instanceof Error ? authErr.message : String(authErr)
        if (errorMessage.includes("Too Many") || errorMessage.includes("rate")) {
          console.warn("[v0] Rate limited, using cached data")
          setIsLoading(false)
          isFetchingRef.current = false
          return
        }
        console.error("[v0] Auth fetch failed:", authErr)
      }

      if (!mountedRef.current) return

      if (!authUser) {
        cachedUser = null
        cachedTeamMember = null
        setUser(null)
        setTeamMember(null)
        setIsLoading(false)
        isFetchingRef.current = false
        return
      }

      cachedUser = authUser
      lastFetchTime = Date.now()
      setUser(authUser)

      // Fetch team member
      try {
        const { data: teamMemberData } = await supabase
          .from("team_members")
          .select("*")
          .or(`auth_user_id.eq.${authUser.id},email.eq.${authUser.email}`)
          .single()

        if (!mountedRef.current) return

        if (teamMemberData) {
          cachedTeamMember = teamMemberData
          setTeamMember(teamMemberData)

          // Link auth_user_id if not already linked
          if (!teamMemberData.auth_user_id && teamMemberData.email === authUser.email) {
            supabase.from("team_members").update({ auth_user_id: authUser.id }).eq("id", teamMemberData.id)
          }
        }
      } catch (teamErr) {
        console.warn("[v0] Team member fetch skipped:", teamErr)
      }
    } catch (err) {
      if (!mountedRef.current) return
      console.error("[v0] Error fetching user data:", err)
      setError(err instanceof Error ? err.message : "Failed to load user data")
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
      isFetchingRef.current = false
    }
  }

  useEffect(() => {
    mountedRef.current = true

    const now = Date.now()
    if (!cachedUser || now - lastFetchTime >= CACHE_DURATION) {
      const timer = setTimeout(() => {
        if (mountedRef.current) {
          fetchUserData()
        }
      }, 100)
      return () => {
        clearTimeout(timer)
        mountedRef.current = false
      }
    } else {
      setIsLoading(false)
    }

    // Listen for auth state changes
    const supabase = getSupabase()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        if (cachedUser?.id !== session.user.id) {
          cachedUser = null
          cachedTeamMember = null
          fetchUserData(true)
        }
      } else {
        cachedUser = null
        cachedTeamMember = null
        setUser(null)
        setTeamMember(null)
      }
    })

    return () => {
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, [])

  return (
    <UserContext.Provider value={{ user, teamMember, isLoading, error, refetch: () => fetchUserData(true) }}>
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

  return "Team"
}

// Helper hook to get user initials
export function useUserInitials() {
  const { teamMember, user } = useUser()

  if (teamMember) {
    if (teamMember.first_name && teamMember.last_name) {
      return `${teamMember.first_name[0]}${teamMember.last_name[0]}`
    }
    if (teamMember.full_name) {
      const parts = teamMember.full_name.split(" ")
      return parts
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
    }
  }

  if (user?.email) {
    return user.email.slice(0, 2).toUpperCase()
  }

  return "TM"
}
