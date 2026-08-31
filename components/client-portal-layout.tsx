"use client"

import type React from "react"
import { useState } from "react"
import { usePathname } from "next/navigation"
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
  FolderOpen,
  MessageSquare,
  Video,
  LogOut,
  Menu,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { clearUserCache } from "@/contexts/user-context"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH_PORTAL,
  useSidebarCollapsed,
} from "@/lib/hooks/use-sidebar-collapsed"

// ── Navigation items ──────────────────────────────────────────────────────────

const PORTAL_NAV = [
  { name: "Dashboard",    href: "/client-portal",             icon: LayoutDashboard },
  { name: "My Account",   href: "/client-portal/client-info", icon: UserCircle },
  { name: "Tax",          href: "/client-portal/tax",         icon: FileText },
  { name: "Documents",    href: "/client-portal/documents",   icon: FolderOpen },
  { name: "Meetings",     href: "/client-portal/meetings",    icon: Video },
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
  const { collapsed, toggleCollapsed, hydrated } = useSidebarCollapsed()

  // Only apply the collapsed width once we've synced with localStorage —
  // this avoids a server/client hydration mismatch (see the hook's docs).
  const sidebarWidth = hydrated && collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH_PORTAL

  return (
    <div className="min-h-screen" style={{ backgroundColor: HUB_BG }}>
      {/* Fixed top header */}
      <PortalHeader
        portalUser={portalUser}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      {/* Desktop sidebar — fixed below header. Width animates between the
          expanded and collapsed rail widths; mobile always uses the
          off-canvas Sheet below at full width regardless of this state. */}
      <div
        className="hidden md:fixed md:top-16 md:bottom-0 md:flex md:flex-col transition-[width] duration-200 ease-in-out"
        style={{ width: sidebarWidth }}
      >
        <PortalSidebar
          unreadCount={unreadCount}
          collapsed={hydrated && collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </div>

      {/* Content area — padded to clear the fixed header + sidebar. The
          padding-left only applies at the md breakpoint (mobile has no
          fixed sidebar to clear), and it animates in lockstep with the
          sidebar's width via a CSS variable so content reflows smoothly
          instead of jumping. */}
      <div
        className="pt-16 md:pl-[var(--portal-sidebar-w)] transition-[padding-left] duration-200 ease-in-out"
        style={{ "--portal-sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
      >
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
  async function handleSignOut() {
    clearUserCache()
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch (err) {
      // Even if the sign-out call itself fails (network hiccup, already
      // expired session, etc.), we still need to leave the portal — the
      // old bug here was that a rejected signOut() promise would throw
      // before ever reaching the redirect, so clicking "Sign out" appeared
      // to do nothing and the previous user's session stayed on screen.
      console.warn("[client-portal] sign-out request failed:", err)
    } finally {
      // A hard navigation (not router.push) so the browser drops every
      // cached RSC payload for the pages we just saw as the signed-in
      // user and re-runs the server auth check from a clean slate on the
      // next paint — a soft navigation can otherwise leave stale portal
      // content visible for a moment (or indefinitely) after sign-out.
      window.location.href = "/client-portal/login"
    }
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
              alt="ALFRED Hub"
              className="h-10 w-auto"
            />
            <div className="flex flex-col leading-tight">
              <span
                className="text-base font-bold tracking-wide"
                style={{ color: "#6B745D" }}
              >
                ALFRED HUB
              </span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                Client Portal
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
  collapsed,
}: {
  item: (typeof PORTAL_NAV)[number]
  isActive: boolean
  showBadge: boolean
  unreadCount: number
  collapsed: boolean
}) {
  const [hovered, setHovered] = useState(false)

  const style: React.CSSProperties = {
    backgroundColor: isActive ? NAV_ACTIVE_BG : hovered ? NAV_HOVER_BG : "transparent",
    color: isActive || hovered ? "#ffffff" : "#374151",
    // Slide right on hover, spring back on leave. Skipped when collapsed —
    // there's no room in a 56px rail for a horizontal slide.
    transform: hovered && !isActive && !collapsed ? "translateX(6px)" : "translateX(0px)",
    transition: [
      hovered
        ? "transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)"
        : "transform 0.22s ease-out",
      "background-color 0.15s ease",
      "color 0.15s ease",
    ].join(", "),
    cursor: "pointer",
  }

  const link = (
    <a
      href={item.href}
      style={style}
      className={cn(
        "flex items-center rounded-xl py-2.5 text-sm font-medium leading-6 select-none",
        collapsed ? "justify-center px-0" : "gap-x-3 px-3",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="relative shrink-0">
        <item.icon
          className="h-5 w-5 shrink-0 transition-colors duration-150"
          style={{ color: isActive || hovered ? "#ffffff" : "#9CA3AF" }}
          aria-hidden="true"
        />
        {collapsed && showBadge && (
          <span
            className="absolute -top-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ backgroundColor: "#B45309" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </span>
      {!collapsed && <span className="flex-1">{item.name}</span>}
      {!collapsed && showBadge && (
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: "#B45309" }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </a>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.name}</TooltipContent>
    </Tooltip>
  )
}

function PortalSidebar({
  unreadCount = 0,
  collapsed = false,
  onToggleCollapsed,
}: {
  unreadCount?: number
  /** Icon-only rail mode. Only meaningful on desktop — the mobile Sheet
   *  always renders this component with `collapsed` left at its default
   *  (false), so the drawer stays fully labeled. */
  collapsed?: boolean
  /** Omitted entirely inside the mobile Sheet, which hides the toggle. */
  onToggleCollapsed?: () => void
}) {
  const pathname = usePathname()

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          "flex grow flex-col overflow-y-auto bg-white pb-4 shadow-sm border-r",
          collapsed ? "px-1.5" : "px-2",
        )}
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
                        collapsed={collapsed}
                      />
                    </li>
                  )
                })}
              </ul>
            </li>
          </ul>

          {/* Footer note — hidden in the icon-only rail, there's no room
              for prose at 56px. */}
          {!collapsed && (
            <div className="px-2 pb-2 mt-auto">
              <p className="text-[10px] text-gray-400 leading-tight">
                {"Motta Financial \u2014 Client Portal"}
              </p>
            </div>
          )}

          {/* Collapse toggle — desktop only. The mobile Sheet renders this
              component without `onToggleCollapsed`, so the control simply
              doesn't render there. */}
          {onToggleCollapsed && (
            <div className={cn("pt-2", !collapsed && "border-t border-gray-100 mt-2")}>
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={cn(
                  "flex w-full items-center rounded-lg py-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900",
                  collapsed ? "justify-center px-0" : "justify-start gap-2 px-3",
                )}
              >
                {collapsed ? (
                  <ChevronsRight className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <>
                    <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                    <span className="text-xs font-medium">Collapse</span>
                  </>
                )}
              </button>
            </div>
          )}
        </nav>
      </div>
    </TooltipProvider>
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
