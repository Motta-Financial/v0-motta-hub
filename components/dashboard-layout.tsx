"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useUser, useDisplayName, useUserInitials } from "@/contexts/user-context"
import {
  LayoutDashboard,
  Users,
  Calendar,
  Settings,
  Menu,
  Inbox,
  CheckSquare,
  UserCircle,
  Database,
  ArrowRightLeft,
  Trophy,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  ListChecks,
  ShieldCheck,
  CreditCard,
  LogOut,
  ClipboardList,
  Calculator,
  FileText,
  Flame,
  DollarSign,
  Workflow,
  BarChart3,
  Video,
  Bell,
  Radio,
  RefreshCw,
  FileSpreadsheet,
  AlertTriangle,
  TrendingUp,
  Lightbulb,
  UserPlus,
  NotebookPen,
  Receipt,
  Briefcase,
  Repeat,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { WorkItemSearchTrigger } from "@/components/work-item-search"

// Top-level sections are organised by *function*, not by team. The five
// daily-driver pages (Triage, Work Items, Clients, Calendar, Debriefs) all
// live under "Home" so the root of the app stays the launchpad. "Sales"
// owns everything that touches a proposal-to-payment lifecycle, including
// Payments and the Ignition admin. "Talent" is the people side of the
// firm (directory + recognition). "Departments" is the operational
// pipeline taxonomy (Tax / Accounting / Special Teams). "Settings"
// absorbs both the legacy "Karbon Data" page and the engineer-facing
// "Admin" tools so non-admins see a single configuration entry-point.
const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard, alfredSuggestions: 3 },
  { name: "Triage", href: "/triage", icon: Inbox, alfredSuggestions: 12 },
  { name: "Work Items", href: "/work-items", icon: CheckSquare, alfredSuggestions: 7 },
  { name: "Clients", href: "/clients", icon: Users, alfredSuggestions: 5 },
  { name: "Debriefs", href: "/debriefs", icon: MessageSquare },
  { name: "Teammates", href: "/teammates", icon: UserCircle },
  { name: "Tommy Awards", href: "/tommy-awards", icon: Trophy },
  {
    name: "Home",
    href: "/",
    icon: LayoutDashboard,
    children: [
      { name: "Triage", href: "/triage", icon: Inbox },
      { name: "Work Items", href: "/work-items", icon: CheckSquare },
      { name: "Clients", href: "/clients", icon: Users },
      {
        name: "Calendar",
        href: "/calendar",
        icon: Calendar,
        children: [
          { name: "Calendly Admin", href: "/calendly", icon: Settings },
          { name: "Zoom", href: "/zoom", icon: Video },
        ],
      },
      {
        name: "Debriefs",
        href: "/debriefs",
        icon: MessageSquare,
        children: [
          { name: "New Debrief", href: "/debriefs/new", icon: NotebookPen },
        ],
      },
    ],
  },
  // Sales is the proposal-to-payment lifecycle hub. Payments and the
  // Ignition admin queue moved here from the now-retired "Client Services"
  // section because they're the natural follow-on to a signed proposal.
  {
    name: "Sales",
    href: "/sales",
    icon: BarChart3,
    children: [
      { name: "Sales Dashboard", href: "/sales/dashboard", icon: TrendingUp },
      { name: "Proposals", href: "/sales/proposals", icon: FileText },
      { name: "Invoices", href: "/sales/invoices", icon: Receipt },
      { name: "Services", href: "/sales/services", icon: Briefcase },
      {
        name: "Recurring Revenue",
        href: "/sales/recurring-revenue",
        icon: Repeat,
      },
      { name: "Payments", href: "/payments", icon: CreditCard },
      // Ignition admin lives at /admin/ignition (mirrors /admin/karbon-sync);
      // surfacing it under Sales keeps the mapping queue + Zap setup near
      // the Proposals/Invoices it produces.
      { name: "Ignition", href: "/admin/ignition", icon: Workflow },
    ],
  },
  // "Talent" replaces the former "Teammates" page — same directory, more
  // accurate label now that Tommy Awards lives underneath it.
  {
    name: "Talent",
    href: "/teammates",
    icon: UserCircle,
    children: [
      { name: "Tommy Awards", href: "/tommy-awards", icon: Trophy },
    ],
  },
  // "Departments" replaces the former "Service Pipelines" name. Onboarding
  // moved under Accounting because it's the kickoff step for every new
  // bookkeeping engagement.
  {
    name: "Departments",
    href: "/pipelines",
    icon: ClipboardList,
    children: [
      {
        name: "Accounting",
        href: "/accounting",
        icon: Calculator,
        children: [{ name: "Bookkeeping", href: "/accounting/bookkeeping", icon: DollarSign }],
        children: [
          { name: "Bookkeeping", href: "/accounting/bookkeeping", icon: DollarSign },
          { name: "Onboarding", href: "/onboarding", icon: UserPlus },
        ],
      },
      {
        name: "Tax",
        href: "/tax",
        icon: FileText,
        children: [{ name: "Busy Season", href: "/tax/busy-season", icon: FileText }],
        children: [
          { name: "Busy Season", href: "/tax/busy-season", icon: FileText },
          { name: "Tax Planning", href: "/tax/planning", icon: Lightbulb },
          { name: "Estimates", href: "/tax/estimates", icon: FileSpreadsheet },
          { name: "IRS Notices", href: "/tax/irs-notices", icon: AlertTriangle },
          { name: "Advisory", href: "/tax/advisory", icon: TrendingUp },
        ],
      },
      { name: "Special Teams", href: "/special-teams", icon: Flame },
    ],
  },
  {
    name: "Client Services",
    href: "/client-services",
    icon: Headphones,
    children: [{ name: "Payments", href: "/payments", icon: CreditCard }],
  },
  { name: "Calendar", href: "/calendar", icon: Calendar, alfredSuggestions: 2 },
  { name: "Karbon Data", href: "/karbon-data", icon: Database },
  // Settings absorbed Karbon Data and the Admin sub-tree — non-admins
  // shouldn't have those at top level.
  {
    name: "Settings",
    href: "/settings",
    icon: Settings,
    children: [
      { name: "Profile", href: "/settings/profile", icon: UserCircle },
      { name: "Notifications", href: "/settings/notifications", icon: Bell },
      { name: "Users", href: "/settings/users", icon: ShieldCheck },
      { name: "Work Statuses", href: "/settings/work-statuses", icon: ListChecks },
      { name: "Migration", href: "/settings/migration", icon: ArrowRightLeft },
      { name: "Webhooks", href: "/settings/webhooks", icon: ArrowRightLeft },
      { name: "Karbon Data", href: "/karbon-data", icon: Database },
      {
        name: "Admin",
        href: "/admin/karbon-sync",
        icon: ShieldCheck,
        children: [
          { name: "Karbon Sync", href: "/admin/karbon-sync", icon: RefreshCw },
          { name: "Broadcast", href: "/admin/broadcast", icon: Radio },
          { name: "Migrate Orgs", href: "/admin/migrate-orgs", icon: ArrowRightLeft },
          { name: "Work Statuses", href: "/admin/work-statuses", icon: ListChecks },
        ],
      },
    ],
  },
]

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#EAE6E1" }}>
      {/* Top header banner - always visible */}
      <HubHeader sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* Desktop sidebar - positioned below the header */}
      <div className="hidden md:fixed md:top-16 md:bottom-0 md:flex md:w-64 md:flex-col">
        <Sidebar />
      </div>

      {/* Main content. The sidebar is fixed-position 16rem wide, so the
          content area only needs ONE `md:pl-64` to clear it. The previous
          version stacked two of these, pushing content 32rem past the left
          edge and overflowing the viewport on the right. */}
      <div className="pt-16 md:pl-64">
        {/* Sticky topbar — gives every page a global Cmd+K work-item search.
            Lives outside <main> so its sticky behavior survives any page that
            applies its own positioning context. */}
        <div className="sticky top-0 z-30 border-b border-stone-200/70 bg-[#EAE6E1]/85 backdrop-blur supports-[backdrop-filter]:bg-[#EAE6E1]/60">
          <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 pl-14 sm:px-6 lg:px-8 md:pl-6">
            <div className="flex-1 max-w-xl">
              <WorkItemSearchTrigger />
            </div>
          </div>
        </div>
        <main className="py-6">
          {/* Bumped from `max-w-7xl` (1280px) to 1600px so wide-screen
              monitors actually use the available width instead of leaving a
              huge dead zone on the right of every dashboard. */}
          <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}

function HubHeader({
  sidebarOpen,
  setSidebarOpen,
}: {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}) {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 h-16 bg-white border-b shadow-sm"
      style={{ borderColor: "#8E9B79" }}
    >
      <div className="flex h-full items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          {/* Mobile menu trigger */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <Sidebar />
            </SheetContent>
          </Sheet>
          <a href="/" className="flex items-center gap-3">
            <img src="/images/alfred-logo.png" alt="Motta Hub" className="h-10 w-auto" />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-wide" style={{ color: "#6B745D" }}>
                MOTTA HUB
              </span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Powered by ALFRED AI</span>
            </div>
          </a>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5 text-gray-600" />
          </Button>
          <HeaderUserMenu />
        </div>
      </div>
    </header>
  )
}

// Does pathname match this node, or any descendant of it? Used both for
// auto-expansion and for parent-active highlighting. Recurses through the
// whole subtree so a deep grandchild match (e.g. /calendly while we're
// inside Home → Calendar → Calendly Admin) still bubbles up to mark every
// ancestor as active and expanded.
function branchContainsActive(node: any, pathname: string): boolean {
  if (
    node.href &&
    node.href !== "/" &&
    (pathname === node.href || pathname.startsWith(node.href + "/"))
  ) {
    return true
  }
  if (node.children?.length) {
    return node.children.some((child: any) => branchContainsActive(child, pathname))
  }
  // Special-case the root: only mark Home as active when we're literally
  // on "/", not on every page (every pathname starts with "/").
  return node.href === "/" && pathname === "/"
}

// Walk the navigation tree and pre-expand every ancestor of the active
// route. Everything else stays collapsed so the sidebar is calm by default.
function buildInitialExpandedState(
  items: typeof navigation,
  pathname: string,
): Record<string, boolean> {
  const expanded: Record<string, boolean> = {}
  const walk = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.children?.length) {
        const hasActive = node.children.some((child: any) =>
          branchContainsActive(child, pathname),
        )
        if (hasActive) expanded[node.name] = true
        walk(node.children)
      }
    }
  }
  walk(items as any[])
  return expanded
}

function HeaderUserMenu() {
  const { teamMember, user } = useUser()
  const displayName = useDisplayName()
  const initials = useUserInitials()
  const router = useRouter()

  const handleLogout = async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" })
    if (response.ok) {
      router.push("/login")
    }
  }

  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-gray-900">{displayName}</span>
            <span className="text-xs text-gray-500">{teamMember?.title || teamMember?.role || "Team Member"}</span>
          </div>
          <Avatar className="h-9 w-9">
            <AvatarImage src={teamMember?.avatar_url || undefined} alt={displayName} />
            <AvatarFallback className="bg-[#6B745D] text-white text-sm">{initials}</AvatarFallback>
          </Avatar>
          <ChevronDown className="h-4 w-4 text-gray-400 hidden sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span>{displayName}</span>
            <span className="text-xs font-normal text-gray-500">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
          <UserCircle className="mr-2 h-4 w-4" />
          My Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/settings")}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-red-600">
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const toggleSection = (name: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [name]: !prev[name],
    }))
  }

  // Recurses through the entire subtree so a parent like Home stays
  // highlighted even when the active route is a grandchild (e.g.
  // /calendly under Home → Calendar → Calendly Admin).
  const hasActiveChild = (children?: any[]) => {
    if (!children?.length) return false
    return children.some((child: any) => branchContainsActive(child, pathname))
  }

  return (
    <div
      className="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4 shadow-sm border-r"
      style={{ borderColor: "#8E9B79" }}
    >
      <nav className="flex flex-1 flex-col pt-6">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          <li>
            <ul role="list" className="-mx-2 space-y-1">
              {navigation.map((item) => {
                const hasChildren = item.children && item.children.length > 0
                const isExpanded = expandedSections[item.name] || false
                const isParentActive = hasActiveChild(item.children)
                const isCurrent =
                  pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href) && !hasChildren)

                return (
                  <li key={item.name}>
                    <div className="flex items-center">
                      <a
                        href={item.href}
                        className={cn(
                          isCurrent || isParentActive
                            ? "text-white border-r-2"
                            : "text-gray-700 hover:text-white hover:bg-opacity-80",
                          "pl-2 group flex flex-1 gap-x-3 rounded-l-md py-2 pr-3 leading-6 font-medium transition-colors relative",
                        )}
                        style={{
                          backgroundColor: isCurrent || isParentActive ? "#6B745D" : "transparent",
                          borderColor: isCurrent || isParentActive ? "#333333" : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (!isCurrent && !isParentActive) {
                            e.currentTarget.style.backgroundColor = "#8E9B79"
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isCurrent && !isParentActive) {
                            e.currentTarget.style.backgroundColor = "transparent"
                          }
                        }}
                      >
                        <item.icon
                          className={cn(
                            isCurrent || isParentActive ? "text-white" : "text-gray-400 group-hover:text-white",
                            "h-5 w-5 shrink-0",
                          )}
                          aria-hidden="true"
                        />
                        <span className="flex-1">{item.name}</span>
                      </a>
                      {hasChildren && (
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            toggleSection(item.name)
                          }}
                          className={cn(
                            "p-1 rounded hover:bg-gray-100 transition-colors mr-1",
                            isCurrent || isParentActive ? "text-gray-600" : "text-gray-400",
                          )}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      )}
                    </div>

                    {hasChildren && isExpanded && (
                      <ul className="mt-1 space-y-1">
                        {item.children!.map((child) => {
                          const isChildCurrent = pathname === child.href || pathname.startsWith(child.href + "/")
                          const hasGrandchildren = child.children && child.children.length > 0
                          const isChildExpanded = expandedSections[child.name] || false
                          const hasActiveGrandchild =
                            hasGrandchildren &&
                            child.children!.some(
                              (gc: any) => pathname === gc.href || pathname.startsWith(gc.href + "/"),
                            )

                          return (
                            <li key={child.name}>
                              <div className="flex items-center">
                                <a
                                  href={child.href}
                                  className={cn(
                                    isChildCurrent || hasActiveGrandchild
                                      ? "text-white border-r-2"
                                      : "text-gray-700 hover:text-white hover:bg-opacity-80",
                                    "pl-8 text-sm group flex flex-1 gap-x-3 rounded-l-md py-2 pr-3 leading-6 font-medium transition-colors relative",
                                  )}
                                  style={{
                                    backgroundColor: isChildCurrent || hasActiveGrandchild ? "#6B745D" : "transparent",
                                    borderColor: isChildCurrent || hasActiveGrandchild ? "#333333" : "transparent",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isChildCurrent && !hasActiveGrandchild) {
                                      e.currentTarget.style.backgroundColor = "#8E9B79"
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isChildCurrent && !hasActiveGrandchild) {
                                      e.currentTarget.style.backgroundColor = "transparent"
                                    }
                                  }}
                                >
                                  <child.icon
                                    className={cn(
                                      isChildCurrent || hasActiveGrandchild
                                        ? "text-white"
                                        : "text-gray-400 group-hover:text-white",
                                      "h-4 w-4 shrink-0",
                                    )}
                                    aria-hidden="true"
                                  />
                                  <span className="flex-1">{child.name}</span>
                                </a>
                                {hasGrandchildren && (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault()
                                      toggleSection(child.name)
                                    }}
                                    className={cn(
                                      "p-1 rounded hover:bg-gray-100 transition-colors mr-1",
                                      isChildCurrent || hasActiveGrandchild ? "text-gray-600" : "text-gray-400",
                                    )}
                                  >
                                    {isChildExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                )}
                              </div>

                              {hasGrandchildren && isChildExpanded && (
                                <ul className="mt-1 space-y-1">
                                  {child.children!.map((grandchild: any) => {
                                    const isGrandchildCurrent =
                                      pathname === grandchild.href || pathname.startsWith(grandchild.href + "/")

                                    return (
                                      <li key={grandchild.name}>
                                        <a
                                          href={grandchild.href}
                                          className={cn(
                                            isGrandchildCurrent
                                              ? "text-white border-r-2"
                                              : "text-gray-700 hover:text-white hover:bg-opacity-80",
                                            "pl-12 text-sm group flex gap-x-3 rounded-l-md py-2 pr-3 leading-6 font-medium transition-colors relative",
                                          )}
                                          style={{
                                            backgroundColor: isGrandchildCurrent ? "#6B745D" : "transparent",
                                            borderColor: isGrandchildCurrent ? "#333333" : "transparent",
                                          }}
                                          onMouseEnter={(e) => {
                                            if (!isGrandchildCurrent) {
                                              e.currentTarget.style.backgroundColor = "#8E9B79"
                                            }
                                          }}
                                          onMouseLeave={(e) => {
                                            if (!isGrandchildCurrent) {
                                              e.currentTarget.style.backgroundColor = "transparent"
                                            }
                                          }}
                                        >
                                          <grandchild.icon
                                            className={cn(
                                              isGrandchildCurrent
                                                ? "text-white"
                                                : "text-gray-400 group-hover:text-white",
                                              "h-4 w-4 shrink-0",
                                            )}
                                            aria-hidden="true"
                                          />
                                          <span className="flex-1">{grandchild.name}</span>
                                        </a>
                                      </li>
                                    )
                                  })}
                                </ul>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </li>
        </ul>
      </nav>

      <a
        href="https://alfred.motta.cpa"
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-xl p-4 transition-all hover:shadow-lg bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 mb-2"
      >
        <div className="flex items-center justify-center gap-3">
          <div className="relative">
            <img src="/images/alfred-logo.png" alt="ALFRED AI" className="h-10 w-auto" />
            <div className="absolute -top-1 -right-1 h-3 w-3 bg-green-400 rounded-full border-2 border-white animate-pulse" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-gray-900 text-sm">ALFRED AI</p>
            <p className="text-xs text-gray-500">Your AI Assistant</p>
          </div>
        </div>
      </a>

      <div className="pt-2">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span>ALFRED AI Online</span>
        </div>
      </div>
    </div>
  )
}

export default DashboardLayout
