"use client"

import type React from "react"
import { useState } from "react"
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
  GitBranch,
  Calendar,
  Settings,
  Menu,
  Inbox,
  CheckSquare,
  UserCircle,
  Database,
  ArrowRightLeft,
  Trophy,
  Headphones,
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

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Triage", href: "/triage", icon: Inbox },
  { name: "Work Items", href: "/work-items", icon: CheckSquare },
  { name: "Clients", href: "/clients", icon: Users },
  { name: "Debriefs", href: "/debriefs/new", icon: MessageSquare },
  { name: "Teammates", href: "/teammates", icon: UserCircle },
  { name: "Tommy Awards", href: "/tommy-awards", icon: Trophy },
  {
    name: "Service Pipelines",
    href: "/pipelines",
    icon: ClipboardList,
    children: [
      {
        name: "Accounting",
        href: "/accounting",
        icon: Calculator,
        children: [
          { name: "Bookkeeping", href: "/accounting/bookkeeping", icon: DollarSign },
        ],
      },
      {
        name: "Tax",
        href: "/tax",
        icon: FileText,
        children: [
          { name: "Busy Season", href: "/tax/busy-season", icon: FileText },
        ],
      },
      { name: "Special Teams", href: "/special-teams", icon: Flame },
    ],
  },
  {
    name: "Client Services",
    href: "/client-services",
    icon: Headphones,
    children: [
      { name: "Payments", href: "/payments", icon: CreditCard },
    ],
  },
  { name: "Calendar", href: "/calendar", icon: Calendar },
  { name: "Karbon Data", href: "/karbon-data", icon: Database },
  {
    name: "Settings",
    href: "/settings",
    icon: Settings,
    children: [
      { name: "Users", href: "/settings/users", icon: ShieldCheck },
      { name: "Work Statuses", href: "/settings/work-statuses", icon: ListChecks },
      { name: "Migration", href: "/settings/migration", icon: ArrowRightLeft },
      { name: "Webhooks", href: "/settings/webhooks", icon: ArrowRightLeft },
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
      {/* Mobile sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="fixed top-4 left-4 z-40 md:hidden">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <div className="hidden md:fixed md:top-0 md:bottom-0 md:flex md:w-64 md:flex-col">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="md:pl-64">
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}

function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const { teamMember, user } = useUser()
  const displayName = useDisplayName()
  const initials = useUserInitials()

  const toggleSection = (name: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [name]: !prev[name],
    }))
  }

  const hasActiveChild = (children?: (typeof navigation)[0]["children"]) => {
    if (!children) return false
    return children.some((child) => pathname === child.href || pathname.startsWith(child.href + "/"))
  }

  const handleLogout = async () => {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
    })
    if (response.ok) {
      router.push("/login")
    }
  }

  return (
    <div
      className="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4 shadow-sm border-r"
      style={{ borderColor: "#8E9B79" }}
    >
      <div className="flex h-20 shrink-0 items-center gap-3">
        <img src="/images/alfred-logo.png" alt="ALFRED AI" className="h-14 w-auto" />
        <div className="flex flex-col">
          <span className="text-lg font-bold text-gray-900">ALFRED AI</span>
          <span className="text-xs text-gray-500">Motta Hub</span>
        </div>
      </div>

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
              <Avatar className="h-10 w-10">
                <AvatarImage src={teamMember?.avatar_url || undefined} alt={displayName} />
                <AvatarFallback className="bg-[#6B745D] text-white">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
                <p className="text-xs text-gray-500 truncate">
                  {teamMember?.title || teamMember?.role || "Team Member"}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
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
      )}

      <nav className="flex flex-1 flex-col">
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
                          const hasActiveGrandchild = hasGrandchildren && child.children!.some(
                            (gc: any) => pathname === gc.href || pathname.startsWith(gc.href + "/")
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
                                      isChildCurrent || hasActiveGrandchild ? "text-white" : "text-gray-400 group-hover:text-white",
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
                                    {isChildExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </button>
                                )}
                              </div>

                              {hasGrandchildren && isChildExpanded && (
                                <ul className="mt-1 space-y-1">
                                  {child.children!.map((grandchild: any) => {
                                    const isGrandchildCurrent = pathname === grandchild.href || pathname.startsWith(grandchild.href + "/")

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
                                              isGrandchildCurrent ? "text-white" : "text-gray-400 group-hover:text-white",
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
        className="block rounded-xl p-4 transition-all hover:shadow-lg bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 mb-4"
      >
        <div className="flex items-center justify-center gap-3">
          <div className="relative">
            <img src="/images/alfred-logo.png" alt="ALFRED AI" className="h-12 w-auto" />
            <div className="absolute -top-1 -right-1 h-3 w-3 bg-green-400 rounded-full border-2 border-white animate-pulse" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-gray-900">ALFRED AI</p>
            <p className="text-xs text-gray-500">Your AI Assistant</p>
          </div>
        </div>
      </a>

      <div className="pt-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span>ALFRED AI Online</span>
        </div>
      </div>
    </div>
  )
}

export default DashboardLayout
