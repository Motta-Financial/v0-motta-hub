"use client"

import type React from "react"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
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
} from "lucide-react"
import Image from "next/image"

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard, alfredSuggestions: 3 },
  { name: "Triage", href: "/triage", icon: Inbox, alfredSuggestions: 12 },
  { name: "Work Items", href: "/work-items", icon: CheckSquare, alfredSuggestions: 7 },
  { name: "Clients", href: "/clients", icon: Users, alfredSuggestions: 5 },
  { name: "Teammates", href: "/teammates", icon: UserCircle },
  { name: "Service Pipelines", href: "/pipelines", icon: GitBranch, alfredSuggestions: 15 },
  { name: "Calendar", href: "/calendar", icon: Calendar, alfredSuggestions: 2 },
  { name: "Settings", href: "/settings", icon: Settings },
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
          <Button variant="ghost" size="icon" className="fixed top-4 left-4 z-50 md:hidden">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <div className="hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col">
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

  return (
    <div
      className="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4 shadow-sm border-r"
      style={{ borderColor: "#8E9B79" }}
    >
      <div className="flex h-20 shrink-0 items-center">
        <Image
          src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Motta_Logo_Tagline_Web_Color-COVqAa1Ft4stCCzr1ZvQcADNqm1109.png"
          alt="Motta Financial"
          width={180}
          height={60}
          className="h-12 w-auto"
        />
      </div>

      <nav className="flex flex-1 flex-col">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          <li>
            <ul role="list" className="-mx-2 space-y-1">
              {navigation.map((item) => {
                const isCurrent = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))

                return (
                  <li key={item.name}>
                    <a
                      href={item.href}
                      className={cn(
                        isCurrent ? "text-white border-r-2" : "text-gray-700 hover:text-white hover:bg-opacity-80",
                        "group flex gap-x-3 rounded-l-md py-2 pl-2 pr-3 text-sm leading-6 font-medium transition-colors relative",
                      )}
                      style={{
                        backgroundColor: isCurrent ? "#6B745D" : "transparent",
                        borderColor: isCurrent ? "#333333" : "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrent) {
                          e.currentTarget.style.backgroundColor = "#8E9B79"
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrent) {
                          e.currentTarget.style.backgroundColor = "transparent"
                        }
                      }}
                    >
                      <item.icon
                        className={cn(
                          isCurrent ? "text-white" : "text-gray-400 group-hover:text-white",
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
        className="block rounded-xl p-4 transition-all hover:shadow-lg bg-white mb-4"
      >
        <div className="flex items-center justify-center">
          <div className="relative animate-pulse">
            <Image
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ALFRED%20Ai_Logo_Icon%20%28No%20Back%29-wHHQbf3QCCdxOyaDuy8TUXXYerulGR.png"
              alt="ALFRED AI"
              width={48}
              height={48}
              className="h-12 w-12"
            />
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
