"use client"

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react"
import type { User, AuthChangeEvent } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"

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
  /** Clear the in-memory cache and refetch. Call this after login/logout
   *  so the context picks up the new session immediately. */
  clearCacheAndRefetch: () => Promise<void>
}

const UserContext = createContext<UserContextType>({
  user: null,
  teamMember: null,
  isLoading: true,
  error: null,
  refetch: async () => {},
  clearCacheAndRefetch: async () => {},
})

// Module-level cache — helps avoid redundant fetches during normal
// navigation, but must be cleared on auth state changes (login/logout).
let cachedUser: User | null = null
let cachedTeamMember: TeamMember | null = null
let hasFetched = false

/** Exported so login/logout can nuke the cache before navigating. */
export function clearUserCache() {
  cachedUser = null
  cachedTeamMember = null
  hasFetched = false
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cachedUser)
  const [teamMember, setTeamMember] = useState<TeamMember | null>(cachedTeamMember)
  const [isLoading, setIsLoading] = useState(!cachedUser && !cachedTeamMember)
  const [error, setError] = useState<string | null>(null)
  const isFetchingRef = useRef(false)

  const fetchUserData = useCallback(async (force = false) => {
    if (isFetchingRef.current) return

    // Return cached data if already fetched (unless forced)
    if (!force && hasFetched && cachedUser) {
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
        throw new Error("Failed to fetch user data")
      }

      const data = await response.json()

      cachedUser = data.user
      cachedTeamMember = data.teamMember
      hasFetched = true

      setUser(data.user)
      setTeamMember(data.teamMember)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user data")
      // Set defaults on error
      setUser(null)
      setTeamMember(null)
    } finally {
      setIsLoading(false)
      isFetchingRef.current = false
    }
  }, [])

  const clearCacheAndRefetch = useCallback(async () => {
    clearUserCache()
    await fetchUserData(true)
  }, [fetchUserData])

  useEffect(() => {
    fetchUserData()
  }, [fetchUserData])

  // Listen for Supabase auth state changes (SIGNED_IN, SIGNED_OUT, etc.)
  // so we automatically refetch when the user logs in or out from another
  // tab / component without having to call clearCacheAndRefetch manually.
  useEffect(() => {
    // createClient() will throw if the public Supabase env vars aren't
    // inlined into the browser bundle. Without this guard, that single
    // exception unmounts the entire React tree on EVERY route (login,
    // public pages, error overlays included) because UserProvider sits
    // at the very top of app/layout.tsx. We swallow the error here so
    // the rest of the app can still render -- the actual sign-in
    // handler in /login surfaces a clear error message to the user.
    let supabase
    try {
      supabase = createClient()
    } catch (e) {
      console.error("[v0] UserProvider: Supabase client unavailable -", e)
      return
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent) => {
        // Only refetch user data on REAL identity transitions:
        //   - SIGNED_IN  -> we have a new user, populate the cache
        //   - SIGNED_OUT -> user is gone, clear the cache
        //
        // We deliberately ignore TOKEN_REFRESHED and USER_UPDATED here.
        // Supabase fires TOKEN_REFRESHED roughly every 50 minutes per
        // open tab as part of normal session refresh -- the underlying
        // user identity hasn't changed, so refetching /api/auth/user
        // each time was a pure waste of a Postgres round-trip per tab
        // per hour. Multiply that by every team member with the Hub
        // open in the background and it was a non-trivial chunk of
        // the project's request budget.
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
          clearUserCache()
          fetchUserData(true)
        }
      },
    )
    return () => {
      subscription.unsubscribe()
    }
  }, [fetchUserData])

  return (
    <UserContext.Provider value={{ user, teamMember, isLoading, error, refetch: fetchUserData, clearCacheAndRefetch }}>
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
