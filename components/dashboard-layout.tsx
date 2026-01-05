"use client"

import type React from "react"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { DemoModeBanner } from "@/components/demo-mode-banner"
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
  Calculator,
  FileText,
  Sparkles,
  Flame,
  DollarSign,
  ClipboardList,
  Lightbulb,
  Mail,
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
} from "lucide-react"

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard, alfredSuggestions: 3 },
  { name: "Triage", href: "/triage", icon: Inbox, alfredSuggestions: 12 },
  { name: "Work Items", href: "/work-items", icon: CheckSquare, alfredSuggestions: 7 },
  { name: "Clients", href: "/clients", icon: Users, alfredSuggestions: 5 },
  { name: "Debriefs", href: "/debriefs/new", icon: MessageSquare },
  { name: "Payments", href: "/payments", icon: CreditCard }, // Added Payments navigation
  { name: "Teammates", href: "/teammates", icon: UserCircle },
  { name: "Tommy Awards", href: "/tommy-awards", icon: Trophy },
  {
    name: "Client Services",
    href: "/client-services",
    icon: Headphones,
    children: [{ name: "Service Pipelines", href: "/pipelines", icon: GitBranch, alfredSuggestions: 15 }],
  },
  { name: "Accounting", href: "/accounting", icon: Calculator },
  {
    name: "Tax",
    href: "/tax",
    icon: FileText,
    children: [
      { name: "Tax Estimates", href: "/tax/estimates", icon: DollarSign, alfredSuggestions: 4 },
      { name: "Planning", href: "/tax/planning", icon: ClipboardList, alfredSuggestions: 6 },
      { name: "Busy Season", href: "/tax/busy-season", icon: Flame, alfredSuggestions: 8 },
      { name: "Advisory", href: "/tax/advisory", icon: Lightbulb, alfredSuggestions: 5 },
      { name: "IRS Notices", href: "/tax/irs-notices", icon: Mail, alfredSuggestions: 3 },
    ],
  },
  { name: "Special Teams", href: "/special-teams", icon: Sparkles },
  { name: "Calendar", href: "/calendar", icon: Calendar, alfredSuggestions: 2 },
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
      <div className="fixed top-0 left-0 right-0 z-50">
        <DemoModeBanner />
      </div>

      {/* Mobile sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="fixed top-14 left-4 z-40 md:hidden">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 pt-10">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar - adjusted for banner */}
      <div className="hidden md:fixed md:top-10 md:bottom-0 md:flex md:w-64 md:flex-col">
        <Sidebar />
      </div>

      {/* Main content - adjusted for banner */}
      <div className="md:pl-64 pt-10">
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}

function Sidebar() {
  const pathname = usePathname()
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

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

  return (
    <div
      className="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4 shadow-sm border-r"
      style={{ borderColor: "#8E9B79" }}
    >
      <div className="flex h-20 shrink-0 items-center">
        <img
          src="/images/motta-logo-tagline-web-color.png"
          alt="Motta - Tax | Accounting | Advisory"
          className="h-14 w-auto"
        />
      </div>

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
                        {item.alfredSuggestions && (
                          <Badge
                            variant="secondary"
                            className="ml-auto text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 hover:bg-orange-200"
                          >
                            {item.alfredSuggestions}
                          </Badge>
                        )}
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

                          return (
                            <li key={child.name}>
                              <a
                                href={child.href}
                                className={cn(
                                  isChildCurrent
                                    ? "text-white border-r-2"
                                    : "text-gray-700 hover:text-white hover:bg-opacity-80",
                                  "pl-8 text-sm group flex gap-x-3 rounded-l-md py-2 pr-3 leading-6 font-medium transition-colors relative",
                                )}
                                style={{
                                  backgroundColor: isChildCurrent ? "#6B745D" : "transparent",
                                  borderColor: isChildCurrent ? "#333333" : "transparent",
                                }}
                                onMouseEnter={(e) => {
                                  if (!isChildCurrent) {
                                    e.currentTarget.style.backgroundColor = "#8E9B79"
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!isChildCurrent) {
                                    e.currentTarget.style.backgroundColor = "transparent"
                                  }
                                }}
                              >
                                <child.icon
                                  className={cn(
                                    isChildCurrent ? "text-white" : "text-gray-400 group-hover:text-white",
                                    "h-4 w-4 shrink-0",
                                  )}
                                  aria-hidden="true"
                                />
                                <span className="flex-1">{child.name}</span>
                                {child.alfredSuggestions && (
                                  <Badge
                                    variant="secondary"
                                    className="ml-auto text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 hover:bg-orange-200"
                                  >
                                    {child.alfredSuggestions}
                                  </Badge>
                                )}
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
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shadow-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
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
