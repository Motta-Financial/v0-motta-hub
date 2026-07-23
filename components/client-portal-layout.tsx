"use client"

import type React from "react"
import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  LayoutDashboard,
  UserCircle,
  FileText,
  MessageSquare,
  LogOut,
  Menu,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { clearUserCache } from "@/contexts/user-context"

// ── Navigation items ──────────────────────────────────────────────────────────

const PORTAL_NAV = [
  { name: "Dashboard",    href: "/client-portal",             icon: LayoutDashboard },
  { name: "My Account",   href: "/client-portal/client-info", icon: UserCircle },
  { name: "Tax",          href: "/client-portal/tax",         icon: FileText },
  { name: "Messages",     href: "/client-portal/messages",    icon: MessageSquare },
] as const

// Exact palette from dashboard-layout.tsx — do not change independently
const NAV_ACTIVE_BG     = "#6B745D"
const NAV_HOVER_BG      = "#4A5240"  // darker green — clear contrast on white sidebar
const NAV_ACTIVE_BORDER = "#333333"
const SIDEBAR_BORDER    = "#8E9B79"
const HUB_BG            = "#EAE6E1"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PortalUserInfo {
  fullName: string | null
  email: string
  role: "client" | "client_contact"
}

interface ClientPortalLayoutProps {
  children: React.ReactNode
  portalUser: PortalUserInfo
  /** Unread message count — drives the badge on the Messages nav item */
  unreadCount?: number
}

// ── Layout root ───────────────────────────────────────────────────────────────

export function ClientPortalLayout({
  children,
  portalUser,
  unreadCount = 0,
}: ClientPortalLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen" style={{ backgroundColor: HUB_BG }}>
      {/* Fixed top header */}
      <PortalHeader
        portalUser={portalUser}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      {/* Desktop sidebar — fixed below header */}
      <div className="hidden md:fixed md:top-16 md:bottom-0 md:flex md:w-56 md:flex-col">
        <PortalSidebar unreadCount={unreadCount} />
      </div>

      {/* Content area — padded to clear the fixed header + sidebar */}
      <div className="pt-16 md:pl-56">
        <main className="py-6">
          <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

function PortalHeader({
  portalUser,
  mobileOpen,
  setMobileOpen,
}: {
  portalUser: PortalUserInfo
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
}) {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    clearUserCache()
    await supabase.auth.signOut()
    router.push("/client-portal/login")
  }

  const initials = getInitials(portalUser.fullName ?? portalUser.email)

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 h-16 bg-white border-b shadow-sm"
      style={{ borderColor: SIDEBAR_BORDER }}
    >
      <div className="flex h-full items-center justify-between px-4 md:px-6">
        {/* Left: mobile menu + logo */}
        <div className="flex items-center gap-3">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-56 p-0">
              <PortalSidebar />
            </SheetContent>
          </Sheet>

          <a href="/client-portal" className="flex items-center gap-3">
            <img
              src="/images/alfred-logo.png"
              alt="Motta Financial"
              className="h-10 w-auto"
            />
            <div className="flex flex-col leading-tight">
              <span
                className="text-base font-bold tracking-wide"
                style={{ color: "#6B745D" }}
              >
                CLIENT PORTAL
              </span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                A Motta Financial product
              </span>
            </div>
          </a>
        </div>

        {/* Right: user menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback
                  className="text-xs text-white"
                  style={{ backgroundColor: "#6B745D" }}
                >
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:block text-sm font-medium text-gray-700 max-w-[140px] truncate">
                {portalUser.fullName ?? portalUser.email}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium leading-none">
                {portalUser.fullName ?? "My Account"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {portalUser.email}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function NavItem({
  item,
  isActive,
  showBadge,
  unreadCount,
}: {
  item: (typeof PORTAL_NAV)[number]
  isActive: boolean
  showBadge: boolean
  unreadCount: number
}) {
  const [hovered, setHovered] = useState(false)

  const style: React.CSSProperties = {
    backgroundColor: isActive ? NAV_ACTIVE_BG : hovered ? NAV_HOVER_BG : "transparent",
    color: isActive || hovered ? "#ffffff" : "#374151",
    // Slide right on hover, spring back on leave
    transform: hovered && !isActive ? "translateX(6px)" : "translateX(0px)",
    transition: [
      hovered
        ? "transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)"
        : "transform 0.22s ease-out",
      "background-color 0.15s ease",
      "color 0.15s ease",
    ].join(", "),
    cursor: "pointer",
  }

  return (
    <a
      href={item.href}
      style={style}
      className="flex items-center gap-x-3 rounded-xl px-3 py-2.5 text-sm font-medium leading-6 select-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <item.icon
        className={cn(
          "h-5 w-5 shrink-0 transition-colors duration-150",
          isActive || hovered ? "text-white" : "text-gray-400",
        )}
        aria-hidden="true"
      />
      <span className="flex-1">{item.name}</span>
      {showBadge && (
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: "#B45309" }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </a>
  )
}

function PortalSidebar({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname()

  return (
    <div
      className="flex grow flex-col overflow-y-auto bg-white px-2 pb-4 shadow-sm border-r"
      style={{ borderColor: SIDEBAR_BORDER }}
    >
      <nav className="flex flex-1 flex-col pt-3">
        <ul role="list" className="flex flex-1 flex-col">
          <li>
            <ul role="list" className="space-y-0.5">
              {PORTAL_NAV.map((item) => {
                const isActive =
                  item.href === "/client-portal"
                    ? pathname === "/client-portal"
                    : pathname === item.href || pathname.startsWith(item.href + "/")

                return (
                  <li key={item.name}>
                    <NavItem
                      item={item}
                      isActive={isActive}
                      showBadge={item.name === "Messages" && unreadCount > 0}
                      unreadCount={unreadCount}
                    />
                  </li>
                )
              })}
            </ul>
          </li>
        </ul>

        {/* Footer note */}
        <div className="px-2 pb-2 mt-auto">
          <p className="text-[10px] text-gray-400 leading-tight">
            {"Motta Financial \u2014 Client Portal"}
          </p>
        </div>
      </nav>
    </div>
  )
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}
