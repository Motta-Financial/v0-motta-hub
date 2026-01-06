"use client"

// Re-export user hooks from the user context for convenience
// This provides a cleaner import path: @/hooks/use-user

export { useUser, useDisplayName, useUserInitials, UserProvider } from "@/contexts/user-context"
export type { TeamMember } from "@/contexts/user-context"
